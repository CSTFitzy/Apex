import { describe, it, expect, beforeEach } from 'vitest';
import { Messages } from '../comms/store.js';

describe('comms Messages store', () => {
  beforeEach(() => {
    Messages.clearAll();
  });

  it('starts empty for a new conversation', () => {
    expect(Messages.list('global')).toEqual([]);
  });

  it('creates a message with a generated id and timestamp', () => {
    const message = Messages.create({
      conversationId: 'global',
      senderId: 1,
      senderUsername: 'alice',
      text: 'Contact at grid 12345',
    });

    expect(typeof message.id).toBe('string');
    expect(message.id.length).toBeGreaterThan(0);
    expect(message.senderUsername).toBe('alice');
    expect(message.text).toBe('Contact at grid 12345');
    expect(typeof message.createdAt).toBe('string');
  });

  it('appends messages to history in order', () => {
    Messages.create({ conversationId: 'ops', senderId: 1, senderUsername: 'alice', text: 'first' });
    Messages.create({ conversationId: 'ops', senderId: 2, senderUsername: 'bob', text: 'second' });

    const history = Messages.list('ops');
    expect(history).toHaveLength(2);
    expect(history[0].text).toBe('first');
    expect(history[1].text).toBe('second');
  });

  it('keeps conversations isolated from each other', () => {
    Messages.create({ conversationId: 'a', senderId: 1, senderUsername: 'alice', text: 'hi a' });
    Messages.create({ conversationId: 'b', senderId: 1, senderUsername: 'alice', text: 'hi b' });

    expect(Messages.list('a')).toHaveLength(1);
    expect(Messages.list('b')).toHaveLength(1);
  });

  it('defaults to the global conversation when none is specified', () => {
    Messages.create({ senderId: 1, senderUsername: 'alice', text: 'default channel' });
    expect(Messages.list('global')).toHaveLength(1);
    expect(Messages.list()).toHaveLength(1);
  });

  it('clears a single conversation', () => {
    Messages.create({ conversationId: 'ops', senderId: 1, senderUsername: 'alice', text: 'hi' });
    Messages.clear('ops');
    expect(Messages.list('ops')).toEqual([]);
  });
});
