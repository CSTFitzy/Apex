import { describe, it, expect } from 'vitest';
import {
  parseRoomId,
  parseChatMessage,
  parseTypingIndicator,
  buildChatEnvelope,
  MAX_MESSAGE_LENGTH,
} from '../comms/messages.js';

describe('comms/messages', () => {
  describe('parseRoomId', () => {
    it('accepts simple alphanumeric room ids', () => {
      expect(parseRoomId('alpha-team_1')).toBe('alpha-team_1');
    });

    it('rejects non-string, empty, or overly long room ids', () => {
      expect(parseRoomId(42)).toBeNull();
      expect(parseRoomId('')).toBeNull();
      expect(parseRoomId('   ')).toBeNull();
      expect(parseRoomId('a'.repeat(200))).toBeNull();
    });

    it('rejects room ids with unsafe characters', () => {
      expect(parseRoomId('room/../etc')).toBeNull();
      expect(parseRoomId('<script>')).toBeNull();
    });
  });

  describe('parseChatMessage', () => {
    it('parses a valid message', () => {
      const result = parseChatMessage({ roomId: 'squad-1', text: 'moving to objective' });
      expect(result.ok).toBe(true);
      expect(result.message).toEqual({ roomId: 'squad-1', text: 'moving to objective' });
    });

    it('rejects payloads missing a valid roomId', () => {
      const result = parseChatMessage({ text: 'hello' });
      expect(result.ok).toBe(false);
    });

    it('rejects empty or non-string text', () => {
      expect(parseChatMessage({ roomId: 'squad-1', text: '' }).ok).toBe(false);
      expect(parseChatMessage({ roomId: 'squad-1', text: '   ' }).ok).toBe(false);
      expect(parseChatMessage({ roomId: 'squad-1', text: 42 }).ok).toBe(false);
    });

    it('rejects non-object payloads', () => {
      expect(parseChatMessage(null).ok).toBe(false);
      expect(parseChatMessage('hello').ok).toBe(false);
    });

    it('truncates overly long text', () => {
      const longText = 'a'.repeat(MAX_MESSAGE_LENGTH + 500);
      const result = parseChatMessage({ roomId: 'squad-1', text: longText });
      expect(result.ok).toBe(true);
      expect(result.message.text).toHaveLength(MAX_MESSAGE_LENGTH);
    });
  });

  describe('parseTypingIndicator', () => {
    it('parses a valid roomId', () => {
      expect(parseTypingIndicator({ roomId: 'squad-1' })).toEqual({ ok: true, roomId: 'squad-1' });
    });

    it('rejects an invalid roomId', () => {
      expect(parseTypingIndicator({}).ok).toBe(false);
    });
  });

  describe('buildChatEnvelope', () => {
    it('builds a message envelope with sender info and timestamp', () => {
      const envelope = buildChatEnvelope({ roomId: 'squad-1', text: 'hi' }, { id: 5, username: 'alice' });
      expect(envelope.roomId).toBe('squad-1');
      expect(envelope.text).toBe('hi');
      expect(envelope.sender).toEqual({ id: 5, username: 'alice' });
      expect(typeof envelope.timestamp).toBe('string');
    });

    it('falls back gracefully when sender is missing', () => {
      const envelope = buildChatEnvelope({ roomId: 'squad-1', text: 'hi' }, undefined);
      expect(envelope.sender).toEqual({ id: null, username: 'unknown' });
    });
  });
});
