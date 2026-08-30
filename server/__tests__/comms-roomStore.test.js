import { describe, it, expect, beforeEach } from 'vitest';
import { joinRoom, leaveRoom, leaveAllRooms, listParticipants, _resetRoomsForTests } from '../comms/roomStore.js';

describe('comms/roomStore', () => {
  beforeEach(() => {
    _resetRoomsForTests();
  });

  it('returns no existing peers when the first participant joins', () => {
    const others = joinRoom('room-1', 'socket-a', { id: 1, username: 'alice' });
    expect(others).toEqual([]);
    expect(listParticipants('room-1')).toEqual([{ socketId: 'socket-a', user: { id: 1, username: 'alice' } }]);
  });

  it('returns existing participants to a newly joining socket', () => {
    joinRoom('room-1', 'socket-a', { id: 1, username: 'alice' });
    const others = joinRoom('room-1', 'socket-b', { id: 2, username: 'bob' });
    expect(others).toEqual([{ socketId: 'socket-a', user: { id: 1, username: 'alice' } }]);
  });

  it('removes a participant on leaveRoom and cleans up empty rooms', () => {
    joinRoom('room-1', 'socket-a', { id: 1, username: 'alice' });
    leaveRoom('room-1', 'socket-a');
    expect(listParticipants('room-1')).toEqual([]);
  });

  it('removes a socket from every room via leaveAllRooms', () => {
    joinRoom('room-1', 'socket-a', { id: 1, username: 'alice' });
    joinRoom('room-2', 'socket-a', { id: 1, username: 'alice' });
    const left = leaveAllRooms('socket-a');
    expect(left.sort()).toEqual(['room-1', 'room-2']);
    expect(listParticipants('room-1')).toEqual([]);
    expect(listParticipants('room-2')).toEqual([]);
  });
});
