/**
 * In-memory message store for real-time text communications.
 *
 * Messages are grouped by `conversationId` (defaults to a single 'global'
 * channel). This is intentionally a lightweight, dependency-free store so
 * it can later be swapped for a database-backed implementation without
 * changing the public API (`list` / `create` / `clear`).
 */
import crypto from 'crypto';

const MAX_HISTORY_PER_CONVERSATION = 500;

/** conversationId -> array of messages, oldest first */
const conversations = new Map();

export const Messages = {
  /** List message history for a conversation (oldest first). */
  list(conversationId = 'global') {
    return conversations.get(conversationId) || [];
  },

  /**
   * Store a new message and return it.
   * @param {{conversationId?: string, senderId: number|string, senderUsername: string, text: string}} params
   */
  create({ conversationId = 'global', senderId, senderUsername, text }) {
    const message = {
      id: crypto.randomUUID(),
      conversationId,
      senderId,
      senderUsername,
      text,
      createdAt: new Date().toISOString(),
    };

    const history = conversations.get(conversationId) || [];
    history.push(message);
    if (history.length > MAX_HISTORY_PER_CONVERSATION) {
      history.shift();
    }
    conversations.set(conversationId, history);

    return message;
  },

  /** Remove all history for a conversation (mainly for tests). */
  clear(conversationId = 'global') {
    conversations.delete(conversationId);
  },

  /** Remove all stored conversations (mainly for tests). */
  clearAll() {
    conversations.clear();
  },
};

export default Messages;
