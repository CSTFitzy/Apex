import React, { useEffect, useRef, useState, useCallback } from 'react';
import CommsSocket, { SIGNAL_EVENTS, CHAT_EVENTS } from '../comms/commsSocket.js';
import VoiceCallManager from '../comms/voiceCallManager.js';
import api from '../utils/api.js';

const DEFAULT_ROOM = 'ops-net';

/**
 * Real-time comms panel: text chat + peer-to-peer voice calls for a room.
 */
export default function CommsPanel({ roomId = DEFAULT_ROOM }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [connected, setConnected] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [muted, setMuted] = useState(false);
  const [participants, setParticipants] = useState([]);
  const [error, setError] = useState(null);

  const commsRef = useRef(null);
  const callManagerRef = useRef(null);
  const remoteAudiosRef = useRef(new Map());

  useEffect(() => {
    const token = localStorage.getItem('sharknet_token');
    const comms = new CommsSocket();
    commsRef.current = comms;
    comms.connect(token);

    const unsubscribers = [
      comms.on('connect', () => {
        setConnected(true);
        comms.joinChat(roomId);
      }),
      comms.on('disconnect', () => setConnected(false)),
      comms.on(CHAT_EVENTS.RECEIVE, (envelope) => {
        setMessages((prev) => [...prev, envelope]);
      }),
      comms.on('error', (payload) => setError(payload?.error || 'Comms error')),
    ];

    return () => {
      unsubscribers.forEach((unsub) => unsub());
      comms.leaveChat(roomId);
      comms.disconnect();
    };
  }, [roomId]);

  const attachRemoteAudio = useCallback((socketId, stream) => {
    let audioEl = remoteAudiosRef.current.get(socketId);
    if (!audioEl) {
      audioEl = new Audio();
      audioEl.autoplay = true;
      remoteAudiosRef.current.set(socketId, audioEl);
    }
    audioEl.srcObject = stream;
  }, []);

  const detachRemoteAudio = useCallback((socketId) => {
    const audioEl = remoteAudiosRef.current.get(socketId);
    if (audioEl) {
      audioEl.srcObject = null;
      remoteAudiosRef.current.delete(socketId);
    }
  }, []);

  const handleSend = (event) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !commsRef.current) return;
    commsRef.current.sendMessage(roomId, text);
    setDraft('');
  };

  const joinCall = async () => {
    const comms = commsRef.current;
    if (!comms) return;
    setError(null);

    try {
      const { iceServers } = await api.getIceServers();
      const callManager = new VoiceCallManager({
        iceServers,
        onOffer: (targetSocketId, sdp) => comms.sendOffer(targetSocketId, sdp),
        onAnswer: (targetSocketId, sdp) => comms.sendAnswer(targetSocketId, sdp),
        onIceCandidate: (targetSocketId, candidate) => comms.sendIceCandidate(targetSocketId, candidate),
        onRemoteStream: attachRemoteAudio,
        onPeerDisconnected: detachRemoteAudio,
      });
      callManagerRef.current = callManager;
      await callManager.acquireLocalStream();

      comms.on(SIGNAL_EVENTS.ROOM_PARTICIPANTS, ({ participants: existing }) => {
        setParticipants(existing.map((p) => p.user));
        existing.forEach(({ socketId }) => callManager.callPeer(socketId));
      });
      comms.on(SIGNAL_EVENTS.PEER_JOINED, ({ socketId, user }) => {
        setParticipants((prev) => [...prev, user]);
        void socketId; // the joining peer will initiate the offer
      });
      comms.on(SIGNAL_EVENTS.PEER_LEFT, ({ socketId }) => {
        callManager.closePeer(socketId);
        detachRemoteAudio(socketId);
      });
      comms.on(SIGNAL_EVENTS.OFFER, ({ fromSocketId, sdp }) => callManager.handleOffer(fromSocketId, sdp));
      comms.on(SIGNAL_EVENTS.ANSWER, ({ fromSocketId, sdp }) => callManager.handleAnswer(fromSocketId, sdp));
      comms.on(SIGNAL_EVENTS.ICE_CANDIDATE, ({ fromSocketId, candidate }) =>
        callManager.handleIceCandidate(fromSocketId, candidate)
      );

      comms.joinVoiceRoom(roomId);
      setInCall(true);
    } catch (err) {
      setError(err.message || 'Failed to join voice call');
    }
  };

  const leaveCall = () => {
    commsRef.current?.leaveVoiceRoom(roomId);
    callManagerRef.current?.closeAll();
    callManagerRef.current = null;
    remoteAudiosRef.current.forEach((audioEl) => {
      audioEl.srcObject = null;
    });
    remoteAudiosRef.current.clear();
    setParticipants([]);
    setInCall(false);
    setMuted(false);
  };

  const toggleMute = () => {
    const nextMuted = !muted;
    callManagerRef.current?.setMuted(nextMuted);
    setMuted(nextMuted);
  };

  useEffect(() => () => callManagerRef.current?.closeAll(), []);

  return (
    <div className="comms-panel">
      <header className="comms-header">
        <h3>Comms · {roomId}</h3>
        <span className={`comms-status ${connected ? 'online' : 'offline'}`}>
          {connected ? 'Connected' : 'Disconnected'}
        </span>
      </header>

      {error && <div className="comms-error">{error}</div>}

      <div className="comms-voice">
        {!inCall ? (
          <button onClick={joinCall} disabled={!connected}>
            Join Voice
          </button>
        ) : (
          <>
            <button onClick={toggleMute}>{muted ? 'Unmute' : 'Mute'}</button>
            <button onClick={leaveCall}>Leave Voice</button>
            <span className="comms-participants">{participants.length} in call</span>
          </>
        )}
      </div>

      <ul className="comms-messages">
        {messages.map((msg, idx) => (
          <li key={idx}>
            <strong>{msg.sender?.username}:</strong> {msg.text}
          </li>
        ))}
      </ul>

      <form className="comms-composer" onSubmit={handleSend}>
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Send a message..."
        />
        <button type="submit" disabled={!connected}>
          Send
        </button>
      </form>
    </div>
  );
}
