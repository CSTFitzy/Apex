/**
 * WebRTC peer connection lifecycle manager for voice calls.
 *
 * Wraps a single `RTCPeerConnection` and drives call signaling (offer /
 * answer / ICE candidate exchange / hangup) over an existing
 * `ApexSocket` connection. Emits high-level events
 * ('incomingCall', 'stateChange', 'remoteStream', 'ended', 'error') that
 * UI components can subscribe to, mirroring the pub/sub style of
 * `ApexSocket`.
 */

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

export const CALL_STATE = {
  IDLE: 'idle',
  CALLING: 'calling',
  RINGING: 'ringing',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  ENDED: 'ended',
};

export class CallManager {
  /** @param {import('./websocket.js').ApexSocket} socket - an already-connected, authenticated socket */
  constructor(socket) {
    this.socket = socket;
    this.peerConnection = null;
    this.localStream = null;
    this.remoteStream = null;
    this.targetUserId = null;
    this.pendingOffer = null;
    this.listeners = new Map();

    this._unsubscribers = [
      socket.on('CALL_OFFER', (payload) => this._handleIncomingOffer(payload)),
      socket.on('CALL_ANSWER', (payload) => this._handleAnswer(payload)),
      socket.on('CALL_ICE_CANDIDATE', (payload) => this._handleRemoteIceCandidate(payload)),
      socket.on('CALL_END', (payload) => this._handleRemoteEnd(payload)),
    ];
  }

  /** Register a listener for a call event. */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.listeners.get(event)?.delete(callback);
  }

  emit(event, payload) {
    this.listeners.get(event)?.forEach((callback) => callback(payload));
  }

  /** List available microphone (audioinput) devices. */
  static async listAudioInputDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === 'audioinput');
  }

  /** List available speaker (audiooutput) devices. */
  static async listAudioOutputDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === 'audiooutput');
  }

  async _ensureLocalStream(audioDeviceId) {
    if (this.localStream) return this.localStream;
    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: audioDeviceId ? { deviceId: { exact: audioDeviceId } } : true,
    });
    return this.localStream;
  }

  _createPeerConnection() {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = (event) => {
      if (event.candidate && this.targetUserId != null) {
        this.socket.send('CALL_ICE_CANDIDATE', {
          targetUserId: this.targetUserId,
          candidate: event.candidate,
        });
      }
    };

    pc.ontrack = (event) => {
      [this.remoteStream] = event.streams;
      this.emit('remoteStream', this.remoteStream);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        this.emit('stateChange', CALL_STATE.CONNECTED);
      } else if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
        this._cleanup();
        this.emit('stateChange', CALL_STATE.ENDED);
        this.emit('ended', { reason: pc.connectionState });
      }
    };

    this.peerConnection = pc;
    return pc;
  }

  /** Initiate an outgoing call to another user. */
  async startCall(targetUserId, { audioDeviceId } = {}) {
    this.targetUserId = targetUserId;
    this.emit('stateChange', CALL_STATE.CALLING);

    const stream = await this._ensureLocalStream(audioDeviceId);
    const pc = this._createPeerConnection();
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.socket.send('CALL_OFFER', { targetUserId, offer });
  }

  _handleIncomingOffer(payload) {
    // Ignore offers while already in a call.
    if (this.peerConnection) return;
    this.targetUserId = payload.fromUserId;
    this.pendingOffer = payload.offer;
    this.emit('stateChange', CALL_STATE.RINGING);
    this.emit('incomingCall', payload);
  }

  /** Accept the current incoming call. */
  async acceptCall({ audioDeviceId } = {}) {
    if (!this.pendingOffer) return;
    this.emit('stateChange', CALL_STATE.CONNECTING);

    const stream = await this._ensureLocalStream(audioDeviceId);
    const pc = this._createPeerConnection();
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    await pc.setRemoteDescription(this.pendingOffer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.socket.send('CALL_ANSWER', { targetUserId: this.targetUserId, answer });
    this.pendingOffer = null;
  }

  /** Decline/reject the current incoming call. */
  rejectCall() {
    if (this.targetUserId != null) {
      this.socket.send('CALL_END', { targetUserId: this.targetUserId, reason: 'declined' });
    }
    this._cleanup();
    this.emit('stateChange', CALL_STATE.ENDED);
  }

  async _handleAnswer(payload) {
    if (!this.peerConnection) return;
    this.emit('stateChange', CALL_STATE.CONNECTING);
    await this.peerConnection.setRemoteDescription(payload.answer);
  }

  async _handleRemoteIceCandidate(payload) {
    if (!this.peerConnection || !payload.candidate) return;
    try {
      await this.peerConnection.addIceCandidate(payload.candidate);
    } catch (err) {
      this.emit('error', err);
    }
  }

  _handleRemoteEnd(payload) {
    this._cleanup();
    this.emit('stateChange', CALL_STATE.ENDED);
    this.emit('ended', { reason: payload?.reason || 'remote_hangup' });
  }

  /** End the current call (if any) and notify the remote party. */
  hangUp() {
    if (this.targetUserId != null) {
      this.socket.send('CALL_END', { targetUserId: this.targetUserId, reason: 'hangup' });
    }
    this._cleanup();
    this.emit('stateChange', CALL_STATE.ENDED);
  }

  _cleanup() {
    this.peerConnection?.close();
    this.peerConnection = null;
    this.localStream?.getTracks().forEach((track) => track.stop());
    this.localStream = null;
    this.remoteStream = null;
    this.targetUserId = null;
    this.pendingOffer = null;
  }

  /** Tear down signaling subscriptions (call on component unmount). */
  destroy() {
    this._cleanup();
    this._unsubscribers.forEach((unsubscribe) => unsubscribe());
  }
}

export default CallManager;
