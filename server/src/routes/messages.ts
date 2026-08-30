import { Router, Request, Response } from 'express';
import { verifyToken, canSend } from '../comms/auth.js';
import { commsStore } from '../comms/store.js';
import { dispatchMessage, getCommsIo } from '../comms/gateway.js';
import {
  MESSAGE_TEMPLATES,
  MESSAGE_TYPES,
  URGENCY_ORDER,
  type MessageFilter,
  type MessageType,
  type MessageUrgency,
} from '../comms/types.js';

const router = Router();

function identityFrom(req: Request) {
  return verifyToken(req.header('authorization') || (req.body?.token as string | undefined));
}

function unauthorised(res: Response) {
  res.status(401).json({ error: 'Authentication required - obtain a token from POST /api/comms/auth' });
}

/** GET /api/messages/templates - structured templates for the composer UI. */
router.get('/templates', (_req: Request, res: Response) => {
  res.json({ templates: MESSAGE_TEMPLATES, types: MESSAGE_TYPES, urgencies: URGENCY_ORDER });
});

/**
 * GET /api/messages?type=&urgency=&senderId=&recipientId=&channelId=&search=&sort=&limit=
 * Returns the filtered/sorted message log plus per-unit unread counters.
 */
router.get('/', (req: Request, res: Response) => {
  const identity = identityFrom(req);
  if (!identity) return unauthorised(res);

  const q = req.query as Record<string, string | undefined>;
  const filter: MessageFilter = {
    senderId: q.senderId,
    recipientId: q.recipientId,
    channelId: q.channelId,
    type: q.type as MessageType | undefined,
    urgency: q.urgency as MessageUrgency | undefined,
    search: q.search,
    since: q.since,
    until: q.until,
    unreadFor: q.unreadFor,
    sort: q.sort as MessageFilter['sort'],
    limit: q.limit ? Number(q.limit) : 200,
  };

  res.json({ messages: commsStore.listMessages(filter), unread: commsStore.unreadCounts() });
});

/** GET /api/messages/export?format=csv|json - after-action review export. */
router.get('/export', (req: Request, res: Response) => {
  const identity = identityFrom(req);
  if (!identity) return unauthorised(res);

  const messages = commsStore.listMessages({ sort: 'oldest', limit: 5000 });
  if ((req.query.format as string) === 'csv') {
    const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const header = 'sent_at,sender,recipients,channel,type,urgency,subject,content,status';
    const rows = messages.map((m) =>
      [
        m.sentAt,
        m.senderCallsign,
        m.recipientIds.join('|'),
        m.channelId ?? '',
        m.type,
        m.urgency,
        m.subject,
        m.content,
        m.status,
      ]
        .map(escape)
        .join(',')
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="apex-message-log.csv"');
    return res.send([header, ...rows].join('\n'));
  }
  res.setHeader('Content-Disposition', 'attachment; filename="apex-message-log.json"');
  res.json({ exportedAt: new Date().toISOString(), messages });
});

/** GET /api/messages/:id - full message detail with an integrity check. */
router.get('/:id', (req: Request, res: Response) => {
  const identity = identityFrom(req);
  if (!identity) return unauthorised(res);
  const message = commsStore.getMessage(req.params.id);
  if (!message) return res.status(404).json({ error: 'Message not found' });
  res.json({ message, integrityValid: commsStore.verifyIntegrity(message) });
});

/** POST /api/messages - send a tactical message (direct, channel or broadcast). */
router.post('/', async (req: Request, res: Response) => {
  const identity = identityFrom(req);
  if (!identity) return unauthorised(res);

  const { type, urgency, subject, content, fields, recipientIds, channelId, e2e } = req.body ?? {};
  if (!MESSAGE_TYPES.includes(type)) {
    return res.status(400).json({ error: `type must be one of ${MESSAGE_TYPES.join(', ')}` });
  }
  if (urgency && !URGENCY_ORDER.includes(urgency)) {
    return res.status(400).json({ error: `urgency must be one of ${URGENCY_ORDER.join(', ')}` });
  }
  if (!canSend(identity.role, type)) {
    return res.status(403).json({ error: `Role ${identity.role} may not originate ${type} messages` });
  }
  if (!(await commsStore.checkRateLimit(identity.unitId))) {
    return res.status(429).json({ error: 'Rate limit exceeded - reduce transmission rate' });
  }

  const message = commsStore.createMessage({
    senderId: identity.unitId,
    senderCallsign: identity.callsign,
    recipientIds: Array.isArray(recipientIds) ? recipientIds : [],
    channelId: channelId ?? null,
    type,
    urgency,
    subject,
    content,
    fields,
    e2e,
  });

  const io = getCommsIo();
  if (io) dispatchMessage(io, message);
  res.status(201).json({ message });
});

/** PUT /api/messages/:id/read - read receipt. */
router.put('/:id/read', (req: Request, res: Response) => {
  const identity = identityFrom(req);
  if (!identity) return unauthorised(res);
  const message = commsStore.markRead(req.params.id, identity.unitId);
  if (!message) return res.status(404).json({ error: 'Message not found' });
  getCommsIo()?.emit('message:read', { id: message.id, readerId: identity.unitId, readAt: message.readAt });
  res.json({ message });
});

/** POST /api/messages/:id/ack - explicit acknowledgement (IMMEDIATE/FLASH traffic). */
router.post('/:id/ack', (req: Request, res: Response) => {
  const identity = identityFrom(req);
  if (!identity) return unauthorised(res);
  const message = commsStore.acknowledge(req.params.id, identity.unitId);
  if (!message) return res.status(404).json({ error: 'Message not found' });
  getCommsIo()?.emit('message:ack', { id: message.id, unitId: identity.unitId });
  res.json({ message });
});

export default router;
