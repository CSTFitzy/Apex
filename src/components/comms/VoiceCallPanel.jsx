import React, { useEffect, useRef, useState } from 'react';
import CallManager, { CALL_STATE } from '../../utils/callManager.js';

const STATUS_LABELS = {
  [CALL_STATE.IDLE]: 'Idle',
  [CALL_STATE.CALLING]: 'Calling...',
  [CALL_STATE.RINGING]: 'Incoming call',
  [CALL_STATE.CONNECTING]: 'Connecting...',
  [CALL_STATE.CONNECTED]: 'Connected',
  [CALL_STATE.ENDED]: 'Call ended',
};

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const secs = (seconds % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
}

/**
 * WebRTC voice call UI: incoming call accept/reject, in-call controls
 * (duration timer, hang up), and microphone/speaker device selection.
 */
export default function VoiceCallPanel({
  callState,
  incomingCall,
  remoteStream,
  onAccept,
  onReject,
  onHangUp,
}) {
  const [micDevices, setMicDevices] = useState([]);
  const [speakerDevices, setSpeakerDevices] = useState([]);
  const [selectedMic, setSelectedMic] = useState('');
  const [selectedSpeaker, setSelectedSpeaker] = useState('');
  const [duration, setDuration] = useState(0);
  const audioRef = useRef(null);

  useEffect(() => {
    CallManager.listAudioInputDevices().then(setMicDevices).catch(() => setMicDevices([]));
    CallManager.listAudioOutputDevices().then(setSpeakerDevices).catch(() => setSpeakerDevices([]));
  }, []);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.srcObject = remoteStream || null;
    }
  }, [remoteStream]);

  useEffect(() => {
    if (callState !== CALL_STATE.CONNECTED) {
      setDuration(0);
      return undefined;
    }
    const interval = setInterval(() => setDuration((prev) => prev + 1), 1000);
    return () => clearInterval(interval);
  }, [callState]);

  const handleSpeakerChange = async (event) => {
    const deviceId = event.target.value;
    setSelectedSpeaker(deviceId);
    if (audioRef.current && typeof audioRef.current.setSinkId === 'function') {
      try {
        await audioRef.current.setSinkId(deviceId);
      } catch {
        // Some browsers don't support setSinkId; ignore silently.
      }
    }
  };

  return (
    <div className="voice-call-panel">
      <h3>Voice Call</h3>
      <p className={`call-status call-status-${callState}`}>{STATUS_LABELS[callState] || callState}</p>

      <audio ref={audioRef} autoPlay />

      {callState === CALL_STATE.RINGING && incomingCall && (
        <div className="call-incoming">
          <p>Incoming call from {incomingCall.fromUsername}</p>
          <button type="button" onClick={() => onAccept(selectedMic)}>
            Accept
          </button>
          <button type="button" className="call-reject" onClick={onReject}>
            Decline
          </button>
        </div>
      )}

      {(callState === CALL_STATE.CALLING ||
        callState === CALL_STATE.CONNECTING ||
        callState === CALL_STATE.CONNECTED) && (
        <div className="call-active">
          {callState === CALL_STATE.CONNECTED && (
            <p className="call-duration">{formatDuration(duration)}</p>
          )}
          <button type="button" className="call-hangup" onClick={onHangUp}>
            Hang Up
          </button>
        </div>
      )}

      <div className="call-devices">
        <label>
          Microphone
          <select value={selectedMic} onChange={(event) => setSelectedMic(event.target.value)}>
            <option value="">Default</option>
            {micDevices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Microphone ${device.deviceId.slice(0, 6)}`}
              </option>
            ))}
          </select>
        </label>
        <label>
          Speaker
          <select value={selectedSpeaker} onChange={handleSpeakerChange}>
            <option value="">Default</option>
            {speakerDevices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Speaker ${device.deviceId.slice(0, 6)}`}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
