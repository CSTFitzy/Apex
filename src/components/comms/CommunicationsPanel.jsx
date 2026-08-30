import React, { useEffect, useMemo, useRef, useState } from 'react';
import api, { getCurrentUser } from '../../utils/api.js';
import SharknetSocket from '../../utils/websocket.js';
import CallManager, { CALL_STATE } from '../../utils/callManager.js';
import VoiceCallPanel from './VoiceCallPanel.jsx';

const TYPING_TIMEOUT_MS = 2000;

function formatTimestamp(isoString) {
  try {
    return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

/**
 * Real-time messaging + WebRTC voice call panel ("Communications").
 * Maintains its own WebSocket connection so it keeps receiving messages,
 * presence updates, and call signaling even while another tab is active.
 */
export default function CommunicationsPanel() {
  const currentUser = useMemo(() => getCurrentUser(), []);
  const socketRef = useRef(null);
  const callManagerRef = useRef(null);

  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [onlineUserIds, setOnlineUserIds] = useState([]);
  const [typingUsers, setTypingUsers] = useState(new Map());
  const [error, setError] = useState(null);

  const [callState, setCallState] = useState(CALL_STATE.IDLE);
  const [incomingCall, setIncomingCall] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);

  const typingTimeoutRef = useRef(null);
  const messageListRef = useRef(null);

  // Load message history once on mount.
  useEffect(() => {
    let cancelled = false;
    api
      .getMessages('global')
      .then((data) => {
        if (!cancelled) setMessages(data.messages || []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Establish the WebSocket connection + WebRTC call manager once.
  useEffect(() => {
    const token = localStorage.getItem('sharknet_token');
    const socket = new SharknetSocket();
    socket.connect(token);
    socket.subscribe(['comms']);
    socketRef.current = socket;

    const callManager = new CallManager(socket);
    callManagerRef.current = callManager;

    const unsubscribers = [
      socket.on('CHAT_MESSAGE', (message) => {
        setMessages((prev) => [...prev, message]);
      }),
      socket.on('TYPING', (payload) => {
        if (payload.userId === currentUser?.id) return;
        setTypingUsers((prev) => {
          const next = new Map(prev);
          if (payload.isTyping) {
            next.set(payload.userId, payload.username);
          } else {
            next.delete(payload.userId);
          }
          return next;
        });
      }),
      socket.on('PRESENCE', (payload) => {
        if (payload.status === 'snapshot') {
          setOnlineUserIds(payload.online || []);
        } else if (payload.status === 'online') {
          setOnlineUserIds((prev) => (prev.includes(payload.userId) ? prev : [...prev, payload.userId]));
        } else if (payload.status === 'offline') {
          setOnlineUserIds((prev) => prev.filter((id) => id !== payload.userId));
        }
      }),
      socket.on('error', () => setError('Connection error')),

      callManager.on('incomingCall', (payload) => setIncomingCall(payload)),
      callManager.on('stateChange', (state) => {
        setCallState(state);
        if (state === CALL_STATE.CONNECTED || state === CALL_STATE.ENDED) {
          setIncomingCall(null);
        }
        if (state === CALL_STATE.ENDED) {
          setRemoteStream(null);
        }
      }),
      callManager.on('remoteStream', (stream) => setRemoteStream(stream)),
    ];

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      callManager.destroy();
      socket.disconnect();
    };
    // Intentionally run once: currentUser is stable for the component's lifetime.
  }, []);

  // Auto-scroll to the latest message.
  useEffect(() => {
    messageListRef.current?.scrollTo({ top: messageListRef.current.scrollHeight });
  }, [messages]);

  const handleSend = (event) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !socketRef.current) return;
    socketRef.current.send('CHAT_MESSAGE', { conversationId: 'global', text });
    socketRef.current.send('TYPING', { conversationId: 'global', isTyping: false });
    setDraft('');
  };

  const handleDraftChange = (event) => {
    setDraft(event.target.value);
    if (!socketRef.current) return;
    socketRef.current.send('TYPING', { conversationId: 'global', isTyping: true });
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socketRef.current?.send('TYPING', { conversationId: 'global', isTyping: false });
    }, TYPING_TIMEOUT_MS);
  };

  const otherOnlineUsers = onlineUserIds.filter((id) => id !== currentUser?.id);
  const typingNames = [...typingUsers.values()];

  return (
    <div className="comms-panel">
      <section className="comms-messages">
        <h3>Tactical Chat</h3>
        {error && <p className="comms-error">{error}</p>}

        <ul className="comms-message-list" ref={messageListRef}>
          {messages.map((message) => (
            <li
              key={message.id}
              className={message.senderId === currentUser?.id ? 'comms-message-own' : 'comms-message'}
            >
              <span className="comms-message-author">{message.senderUsername}</span>
              <span className="comms-message-text">{message.text}</span>
              <span className="comms-message-time">{formatTimestamp(message.createdAt)}</span>
            </li>
          ))}
          {messages.length === 0 && <li className="comms-empty">No messages yet.</li>}
        </ul>

        {typingNames.length > 0 && (
          <p className="comms-typing">{typingNames.join(', ')} typing...</p>
        )}

        <form className="comms-input-form" onSubmit={handleSend}>
          <input
            type="text"
            value={draft}
            onChange={handleDraftChange}
            placeholder="Send a message..."
            aria-label="Message"
          />
          <button type="submit" disabled={!draft.trim()}>
            Send
          </button>
        </form>
      </section>

      <aside className="comms-sidebar">
        <div className="comms-presence">
          <h3>Online</h3>
          <ul>
            {otherOnlineUsers.length === 0 && <li className="comms-empty">No one else online.</li>}
            {otherOnlineUsers.map((userId) => (
              <li key={userId} className="comms-presence-item">
                <span className="comms-presence-dot" />
                User #{userId}
                <button
                  type="button"
                  disabled={callState !== CALL_STATE.IDLE}
                  onClick={() => callManagerRef.current?.startCall(userId)}
                >
                  Call
                </button>
              </li>
            ))}
          </ul>
        </div>

        <VoiceCallPanel
          callState={callState}
          incomingCall={incomingCall}
          remoteStream={remoteStream}
          onAccept={(deviceId) => callManagerRef.current?.acceptCall({ audioDeviceId: deviceId })}
          onReject={() => callManagerRef.current?.rejectCall()}
          onHangUp={() => callManagerRef.current?.hangUp()}
        />
      </aside>
    </div>
  );
}
