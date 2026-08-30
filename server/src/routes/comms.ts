import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { issueToken, verifyToken, type CommsRole } from '../comms/auth.js';
import { commsStore } from '../comms/store.js';
import { getCommsIo } from '../comms/gateway.js';
import { evaluateChannelLink, evaluateLink } from '../comms/signal.js';
import { keyStatus, rotateKeys } from '../comms/crypto.js';

const router = Router();

// Caps authentication attempts and channel/presence polling.
router.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

const VALID_ROLES: CommsRole[] = ['COMMANDER', 'OFFICER', 'OPERATOR'];

function identityFrom(req: Request) {
  return verifyToken(req.header('authorization') || (req.body?.token as string | undefined));
}

/**
 * POST /api/comms/auth
 * Authenticates a unit for the comms subsystem and issues a signed token that
 * must accompany every channel join, message and signalling request.
 */
router.post('/auth', (req: Request, res: Response) => {
  const { unitId, callsign, role } = req.body ?? {};
  if (!unitId || !callsign) {
    return res.status(400).json({ error: 'unitId and callsign are required' });
  }
  const resolvedRole: CommsRole = VALID_ROLES.includes(role) ? role : 'OPERATOR';
  const { token, expiresIn } = issueToken({ unitId, callsign, role: resolvedRole });
  const presence = commsStore.setPresence(unitId, callsign, true);
  getCommsIo()?.emit('presence:update', presence);
  res.json({ token, expiresIn, identity: { unitId, callsign, role: resolvedRole } });
});

/** GET /api/comms/channels - channel directory with membership and status. */
router.get('/channels', (_req: Request, res: Response) => {
  res.json({ channels: commsStore.listChannels() });
});

/** POST /api/comms/channels - create an additional radio net. */
router.post('/channels', (req: Request, res: Response) => {
  const identity = identityFrom(req);
  if (!identity) return res.status(401).json({ error: 'Authentication required' });
  const { name, frequencyMHz, encrypted } = req.body ?? {};
  if (!name || typeof frequencyMHz !== 'number') {
    return res.status(400).json({ error: 'name and numeric frequencyMHz are required' });
  }
  const channel = commsStore.createChannel(name, frequencyMHz, encrypted !== false);
  getCommsIo()?.emit('channel:state', channel);
  res.status(201).json({ channel });
});

/** POST /api/comms/channels/:id/join */
router.post('/channels/:id/join', (req: Request, res: Response) => {
  const identity = identityFrom(req);
  if (!identity) return res.status(401).json({ error: 'Authentication required' });
  const channel = commsStore.joinChannel(req.params.id, identity.unitId, identity.callsign);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  getCommsIo()?.emit('channel:state', channel);
  res.json({ channel });
});

/** POST /api/comms/channels/:id/leave */
router.post('/channels/:id/leave', (req: Request, res: Response) => {
  const identity = identityFrom(req);
  if (!identity) return res.status(401).json({ error: 'Authentication required' });
  const channel = commsStore.leaveChannel(req.params.id, identity.unitId);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  getCommsIo()?.emit('channel:state', channel);
  res.json({ channel });
});

/** GET /api/comms/presence - unit roster with online/offline state. */
router.get('/presence', (_req: Request, res: Response) => {
  res.json({ presence: commsStore.listPresence(), unread: commsStore.unreadCounts() });
});

/**
 * POST /api/comms/signal
 * Evaluates radio link quality (signal bars, voice quality, static level and
 * intercept risk) for a station against one peer or a whole net.
 */
router.post('/signal', (req: Request, res: Response) => {
  const { from, to, peers, terrainObstruction, frequencyMHz, overlappingChannels, weather, fromAltitudeM } =
    req.body ?? {};
  if (!from || typeof from.lat !== 'number' || typeof from.lon !== 'number') {
    return res.status(400).json({ error: 'from {lat, lon} is required' });
  }
  const base = { terrainObstruction, frequencyMHz, overlappingChannels, weather, fromAltitudeM };
  if (Array.isArray(peers)) {
    return res.json({ link: evaluateChannelLink(from, peers, base) });
  }
  if (!to) return res.status(400).json({ error: 'either to {lat, lon} or peers[] is required' });
  res.json({ link: evaluateLink({ ...base, from, to }) });
});

/** GET /api/comms/voice-logs?channelId= - chronological radio traffic log. */
router.get('/voice-logs', (req: Request, res: Response) => {
  const channelId = req.query.channelId as string | undefined;
  res.json({ logs: commsStore.listVoiceLogs(channelId) });
});

/** POST /api/comms/voice-logs - record a completed transmission. */
router.post('/voice-logs', (req: Request, res: Response) => {
  const identity = identityFrom(req);
  if (!identity) return res.status(401).json({ error: 'Authentication required' });
  const { channelId, audio, transcript, durationMs, quality } = req.body ?? {};
  if (!channelId) return res.status(400).json({ error: 'channelId is required' });
  const entry = commsStore.addVoiceLog({
    channelId,
    speakerId: identity.unitId,
    speakerCallsign: identity.callsign,
    audio: audio ?? null,
    transcript: transcript ?? '',
    durationMs: durationMs ?? 0,
    quality: quality ?? 'GOOD',
  });
  getCommsIo()?.to(`channel:${channelId}`).emit('voice:log', entry);
  res.status(201).json({ entry });
});

/** GET /api/comms/voice-logs/export?format=csv|json - transcript export. */
router.get('/voice-logs/export', (req: Request, res: Response) => {
  const logs = commsStore.listVoiceLogs(req.query.channelId as string | undefined);
  if ((req.query.format as string) === 'csv') {
    const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const header = 'timestamp,channel,speaker,duration_ms,quality,transcript';
    const rows = logs.map((l) =>
      [l.timestamp, l.channelId, l.speakerCallsign, l.durationMs, l.quality, l.transcript].map(escape).join(',')
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="apex-radio-log.csv"');
    return res.send([header, ...rows].join('\n'));
  }
  res.setHeader('Content-Disposition', 'attachment; filename="apex-radio-log.json"');
  res.json({ exportedAt: new Date().toISOString(), logs });
});

/** GET /api/comms/audit - who sent/read/acknowledged what. */
router.get('/audit', (req: Request, res: Response) => {
  const identity = identityFrom(req);
  if (!identity) return res.status(401).json({ error: 'Authentication required' });
  res.json({ entries: commsStore.listAudit(Number(req.query.limit) || 200) });
});

/** GET /api/comms/keys - encryption key rotation status. */
router.get('/keys', (_req: Request, res: Response) => {
  res.json(keyStatus());
});

/** POST /api/comms/keys/rotate - force an immediate key rotation. */
router.post('/keys/rotate', (req: Request, res: Response) => {
  const identity = identityFrom(req);
  if (!identity || identity.role !== 'COMMANDER') {
    return res.status(403).json({ error: 'Only a COMMANDER may rotate comms keys' });
  }
  res.json(rotateKeys());
});

export default router;
