/**
 * WebRTC peer connection manager for voice calls.
 *
 * Manages one RTCPeerConnection per remote peer in a voice room, wiring up
 * local microphone audio, ICE candidate exchange (via the supplied signaling
 * callbacks), and exposing remote audio streams as they arrive.
 */

const DEFAULT_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

export class VoiceCallManager {
  /**
   * @param {object} options
   * @param {Array} [options.iceServers]
   * @param {(targetSocketId: string, sdp: string) => void} options.onOffer - called with a local SDP offer to send to a peer
   * @param {(targetSocketId: string, sdp: string) => void} options.onAnswer - called with a local SDP answer to send to a peer
   * @param {(targetSocketId: string, candidate: RTCIceCandidateInit) => void} options.onIceCandidate
   * @param {(socketId: string, stream: MediaStream) => void} [options.onRemoteStream]
   * @param {(socketId: string) => void} [options.onPeerDisconnected]
   */
  constructor({ iceServers = DEFAULT_ICE_SERVERS, onOffer, onAnswer, onIceCandidate, onRemoteStream, onPeerDisconnected } = {}) {
    this.iceServers = iceServers;
    this.onOffer = onOffer;
    this.onAnswer = onAnswer;
    this.onIceCandidate = onIceCandidate;
    this.onRemoteStream = onRemoteStream;
    this.onPeerDisconnected = onPeerDisconnected;

    /** @type {Map<string, RTCPeerConnection>} */
    this.peers = new Map();
    this.localStream = null;
  }

  /** Acquire the local microphone stream. Must be called before initiating/answering calls. */
  async acquireLocalStream(constraints = { audio: true, video: false }) {
    this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
    return this.localStream;
  }

  /** Mute/unmute the local microphone without tearing down connections. */
  setMuted(muted) {
    this.localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }

  _createPeerConnection(remoteSocketId) {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });

    this.localStream?.getTracks().forEach((track) => {
      pc.addTrack(track, this.localStream);
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.onIceCandidate?.(remoteSocketId, event.candidate.toJSON());
      }
    };

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      this.onRemoteStream?.(remoteSocketId, stream);
    };

    pc.onconnectionstatechange = () => {
      if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
        this.closePeer(remoteSocketId);
        this.onPeerDisconnected?.(remoteSocketId);
      }
    };

    this.peers.set(remoteSocketId, pc);
    return pc;
  }

  /** Initiate a call to a newly-discovered peer by sending it an SDP offer. */
  async callPeer(remoteSocketId) {
    const pc = this._createPeerConnection(remoteSocketId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.onOffer?.(remoteSocketId, pc.localDescription.sdp);
  }

  /** Handle an incoming SDP offer from a peer and reply with an answer. */
  async handleOffer(remoteSocketId, sdp) {
    const pc = this.peers.get(remoteSocketId) || this._createPeerConnection(remoteSocketId);
    await pc.setRemoteDescription({ type: 'offer', sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.onAnswer?.(remoteSocketId, pc.localDescription.sdp);
  }

  /** Handle an incoming SDP answer to a previously sent offer. */
  async handleAnswer(remoteSocketId, sdp) {
    const pc = this.peers.get(remoteSocketId);
    if (!pc) return;
    await pc.setRemoteDescription({ type: 'answer', sdp });
  }

  /** Handle an incoming ICE candidate from a peer. */
  async handleIceCandidate(remoteSocketId, candidate) {
    const pc = this.peers.get(remoteSocketId);
    if (!pc) return;
    try {
      await pc.addIceCandidate(candidate);
    } catch {
      // Candidates that arrive before the remote description is set (or
      // that are otherwise stale) are safe to ignore.
    }
  }

  /** Tear down and remove the peer connection for a given remote socket. */
  closePeer(remoteSocketId) {
    const pc = this.peers.get(remoteSocketId);
    if (pc) {
      pc.close();
      this.peers.delete(remoteSocketId);
    }
  }

  /** Tear down all peer connections and stop the local stream. */
  closeAll() {
    this.peers.forEach((pc) => pc.close());
    this.peers.clear();
    this.localStream?.getTracks().forEach((track) => track.stop());
    this.localStream = null;
  }
}

export default VoiceCallManager;
