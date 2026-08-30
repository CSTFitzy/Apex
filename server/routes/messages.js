/**
 * Real-time text messaging routes: conversation history and message send.
 *
 * Sending a message via REST also broadcasts it to connected WebSocket
 * clients (the same event emitted when a message is sent over the `ws`
 * connection directly), so REST and WebSocket clients stay in sync.
 */
import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { Messages } from '../comms/store.js';
import { isNonEmptyString } from '../utils/validators.js';
import { broadcastChatMessage } from '../websocket/handlers.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * GET /api/messages?conversationId=global
 * List message history for a conversation (defaults to the 'global' channel).
 */
router.get('/', requireAuth, (req, res) => {
  const conversationId = req.query.conversationId || 'global';
  const messages = Messages.list(conversationId);
  return res.json({ messages });
});

/**
 * POST /api/messages
 * Send a new message. Broadcasts the message to WebSocket clients
 * subscribed to the 'comms' topic.
 */
router.post('/', requireAuth, (req, res) => {
  const { text, conversationId } = req.body;

  if (!isNonEmptyString(text)) {
    return res.status(400).json({ error: 'Message text is required' });
  }

  try {
    const message = Messages.create({
      conversationId: conversationId || 'global',
      senderId: req.user.id,
      senderUsername: req.user.username,
      text,
    });

    const wss = req.app.get('wss');
    if (wss) {
      broadcastChatMessage(wss, message);
    }

    return res.status(201).json({ message });
  } catch (err) {
    logger.error('Failed to send message', { error: err.message });
    return res.status(500).json({ error: 'Failed to send message' });
  }
});

export default router;
