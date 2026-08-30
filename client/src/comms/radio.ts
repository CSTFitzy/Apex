import type { Socket } from 'socket.io-client';
import { emitWithAck, getSocket } from './socket';
import type { RadioPeer } from '../types';

/**
 * WebRTC tactical radio transport.
 *
 * Establishes a mesh of peer-to-peer Opus audio connections between every
 * station on a radio net, enforces half-duplex push-to-talk behaviour, mixes
 * realistic squelch/static into the received audio based on link quality, and
 * records each transmission for the voice log.
 */

export interface RadioConfig {
  iceServers: RTCIceServer[];
  audio: {
    codec: string;
    maxAverageBitrate: number;
    channelCount: number;
    echoCancellation: boolean;
    noiseSuppression: boolean;
    autoGainControl: boolean;
    targetLatencyMs: number;
  };
}

export interface RadioHandlers {
  onPeersChanged?: (peers: RadioPeer[]) => void;
  onError?: (message: string) => void;
  onTransmissionRecorded?: (payload: { audio: string; durationMs: number }) => void;
  onReceiveLevel?: (level: number) => void;
  onLatency?: (roundTripMs: number | null) => void;
}

interface PeerEntry {
  socketId: string;
  unitId: string;
  callsign: string;
  connection: RTCPeerConnection;
  audio: HTMLAudioElement;
  pendingCandidates: RTCIceCandidateInit[];
}

const DEFAULT_CONFIG: RadioConfig = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }],
  audio: {
    codec: 'opus',
    maxAverageBitrate: 24000,
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: false,
    targetLatencyMs: 200,
  },
};

export function isRadioSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof RTCPeerConnection !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

export class RadioTransport {
  private readonly socket: Socket;
  private readonly handlers: RadioHandlers;
  private config: RadioConfig = DEFAULT_CONFIG;
  private readonly peers = new Map<string, PeerEntry>();

  private localStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private noiseSource: AudioBufferSourceNode | null = null;
  private noiseGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private levelTimer: number | null = null;
  private recorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private recordingStartedAt = 0;

  channelId: string | null = null;
  transmitting = false;
  muted = false;

  constructor(handlers: RadioHandlers = {}) {
    this.socket = getSocket();
    this.handlers = handlers;
    this.bindSignalling();
  }

  // ---------------------------------------------------------------- lifecycle

  /** Loads ICE/audio configuration from the signalling server. */
  async loadConfig(): Promise<RadioConfig> {
    try {
      const response = await fetch('/api/webrtc/config');
      if (response.ok) this.config = (await response.json()) as RadioConfig;
    } catch {
      this.config = DEFAULT_CONFIG;
    }
    return this.config;
  }

  /** Joins a radio net and opens a peer connection to every station already on it. */
  async join(channelId: string): Promise<void> {
    if (this.channelId === channelId) return;
    if (this.channelId) await this.leave();
    await this.loadConfig();

    const response = await emitWithAck<{
      ok: boolean;
      error?: string;
      peers?: Array<{ socketId: string; unitId: string; callsign: string }>;
    }>('channel:join', { channelId });
    if (!response.ok) throw new Error(response.error || 'Unable to join channel');

    this.channelId = channelId;
    await this.ensureLocalStream();
    this.startSquelch();

    for (const peer of response.peers ?? []) {
      await this.createOffer(peer.socketId, peer.unitId, peer.callsign);
    }
    this.emitPeers();
  }

  async leave(): Promise<void> {
    const channelId = this.channelId;
    this.channelId = null;
    this.setTransmitting(false);
    for (const peer of this.peers.values()) this.closePeer(peer.socketId);
    this.stopSquelch();
    if (channelId) {
      await emitWithAck('channel:leave', { channelId }).catch(() => undefined);
    }
    this.emitPeers();
  }

  dispose(): void {
    void this.leave();
    this.localStream?.getTracks().forEach((track) => track.stop());
    this.localStream = null;
    void this.audioContext?.close().catch(() => undefined);
    this.audioContext = null;
  }

  // ------------------------------------------------------------ push to talk

  /**
   * Push-to-talk. The net is half-duplex, so the microphone track is only
   * enabled while the key is held and the server has granted the channel.
   */
  async setTransmitting(transmitting: boolean): Promise<boolean> {
    if (!this.channelId) return false;
    if (transmitting) {
      await this.ensureLocalStream();
      const response = await emitWithAck<{ ok: boolean; granted?: boolean; error?: string }>(
        'channel:ptt',
        { channelId: this.channelId, transmitting: true }
      ).catch(() => ({ ok: false, granted: false, error: 'Signalling unavailable' }));
      if (!response.ok || !response.granted) {
        this.handlers.onError?.(response.error || 'Channel busy - another station is transmitting');
        return false;
      }
      this.transmitting = true;
      this.setMicEnabled(true);
      this.startRecording();
      return true;
    }

    this.transmitting = false;
    this.setMicEnabled(false);
    this.stopRecording();
    await emitWithAck('channel:ptt', { channelId: this.channelId, transmitting: false }).catch(
      () => undefined
    );
    return false;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    for (const peer of this.peers.values()) peer.audio.muted = muted;
  }

  /** Sets the amount of synthetic radio static mixed into received audio (0-1). */
  setStaticLevel(level: number): void {
    if (this.noiseGain && this.audioContext) {
      const target = Math.max(0, Math.min(1, level)) * 0.12;
      this.noiseGain.gain.setTargetAtTime(target, this.audioContext.currentTime, 0.2);
    }
  }

  /** Measures signalling round-trip time as a proxy for one-way voice latency. */
  async measureLatency(): Promise<number | null> {
    const started = performance.now();
    try {
      await emitWithAck('comms:heartbeat', {}, 4000);
      const rtt = Math.round(performance.now() - started);
      this.handlers.onLatency?.(rtt);
      return rtt;
    } catch {
      this.handlers.onLatency?.(null);
      return null;
    }
  }

  // ------------------------------------------------------------- media setup

  private async ensureLocalStream(): Promise<MediaStream | null> {
    if (this.localStream) return this.localStream;
    if (!isRadioSupported()) {
      this.handlers.onError?.('This browser does not support WebRTC voice communications.');
      return null;
    }
    try {
      const { echoCancellation, noiseSuppression, autoGainControl, channelCount } = this.config.audio;
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation, noiseSuppression, autoGainControl, channelCount },
        video: false,
      });
      this.setMicEnabled(false);
      return this.localStream;
    } catch {
      this.handlers.onError?.('Microphone access denied - voice transmission is unavailable.');
      return null;
    }
  }

  private setMicEnabled(enabled: boolean): void {
    this.localStream?.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
  }

  /** Continuous low-level static so an idle net still "hisses" like a real radio. */
  private startSquelch(): void {
    if (this.noiseSource || typeof AudioContext === 'undefined') return;
    const context = this.audioContext ?? new AudioContext();
    this.audioContext = context;

    const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    // Band-pass the white noise so it sounds like VHF hiss rather than surf.
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1800;
    filter.Q.value = 0.7;

    const gain = context.createGain();
    gain.gain.value = 0.02;

    source.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);
    source.start();

    this.noiseSource = source;
    this.noiseGain = gain;
  }

  private stopSquelch(): void {
    try {
      this.noiseSource?.stop();
    } catch {
      /* already stopped */
    }
    this.noiseSource = null;
    this.noiseGain = null;
    if (this.levelTimer !== null) {
      window.clearInterval(this.levelTimer);
      this.levelTimer = null;
    }
  }

  /** Feeds a received stream into an analyser so the UI can draw a waveform. */
  private attachAnalyser(stream: MediaStream): void {
    if (typeof AudioContext === 'undefined' || !this.handlers.onReceiveLevel) return;
    const context = this.audioContext ?? new AudioContext();
    this.audioContext = context;
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    context.createMediaStreamSource(stream).connect(analyser);
    this.analyser = analyser;

    if (this.levelTimer === null) {
      const data = new Uint8Array(analyser.frequencyBinCount);
      this.levelTimer = window.setInterval(() => {
        if (!this.analyser) return;
        this.analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const sample of data) peak = Math.max(peak, Math.abs(sample - 128) / 128);
        this.handlers.onReceiveLevel?.(peak);
      }, 100);
    }
  }

  // -------------------------------------------------------------- recording

  private startRecording(): void {
    if (!this.localStream || typeof MediaRecorder === 'undefined') return;
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : undefined;
    try {
      this.recordedChunks = [];
      this.recordingStartedAt = Date.now();
      this.recorder = new MediaRecorder(this.localStream, mimeType ? { mimeType } : undefined);
      this.recorder.ondataavailable = (event) => {
        if (event.data.size > 0) this.recordedChunks.push(event.data);
      };
      this.recorder.onstop = () => {
        const durationMs = Date.now() - this.recordingStartedAt;
        const blob = new Blob(this.recordedChunks, { type: mimeType || 'audio/webm' });
        this.recordedChunks = [];
        if (blob.size === 0) return;
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = String(reader.result ?? '');
          const audio = result.slice(result.indexOf(',') + 1);
          if (audio) this.handlers.onTransmissionRecorded?.({ audio, durationMs });
        };
        reader.readAsDataURL(blob);
      };
      this.recorder.start();
    } catch {
      this.recorder = null;
    }
  }

  private stopRecording(): void {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.recorder = null;
  }

  // ------------------------------------------------------------- signalling

  private bindSignalling(): void {
    this.socket.on('webrtc:peer-joined', (payload: { socketId: string; unitId: string; callsign: string; channelId: string }) => {
      // The joining station initiates the offer, so we only note the arrival.
      if (payload.channelId !== this.channelId) return;
      this.emitPeers();
    });

    this.socket.on('webrtc:peer-left', (payload: { socketId: string; channelId: string }) => {
      if (payload.channelId !== this.channelId) return;
      this.closePeer(payload.socketId);
      this.emitPeers();
    });

    this.socket.on(
      'webrtc:offer',
      async (payload: { fromSocketId: string; fromUnitId: string; fromCallsign: string; sdp: RTCSessionDescriptionInit }) => {
        if (!this.channelId) return;
        const peer = await this.createPeer(payload.fromSocketId, payload.fromUnitId, payload.fromCallsign);
        if (!peer) return;
        await peer.connection.setRemoteDescription(payload.sdp);
        await this.flushCandidates(peer);
        const answer = await peer.connection.createAnswer();
        await peer.connection.setLocalDescription(answer);
        this.socket.emit('webrtc:answer', { targetSocketId: payload.fromSocketId, sdp: answer });
        this.emitPeers();
      }
    );

    this.socket.on('webrtc:answer', async (payload: { fromSocketId: string; sdp: RTCSessionDescriptionInit }) => {
      const peer = this.peers.get(payload.fromSocketId);
      if (!peer) return;
      await peer.connection.setRemoteDescription(payload.sdp);
      await this.flushCandidates(peer);
    });

    this.socket.on(
      'webrtc:ice-candidate',
      async (payload: { fromSocketId: string; candidate: RTCIceCandidateInit }) => {
        const peer = this.peers.get(payload.fromSocketId);
        if (!peer || !payload.candidate) return;
        if (peer.connection.remoteDescription) {
          await peer.connection.addIceCandidate(payload.candidate).catch(() => undefined);
        } else {
          peer.pendingCandidates.push(payload.candidate);
        }
      }
    );
  }

  private async flushCandidates(peer: PeerEntry): Promise<void> {
    const pending = peer.pendingCandidates.splice(0);
    for (const candidate of pending) {
      await peer.connection.addIceCandidate(candidate).catch(() => undefined);
    }
  }

  private async createPeer(socketId: string, unitId: string, callsign: string): Promise<PeerEntry | null> {
    const existing = this.peers.get(socketId);
    if (existing) return existing;
    if (!isRadioSupported()) return null;

    const connection = new RTCPeerConnection({ iceServers: this.config.iceServers });
    const audio = new Audio();
    audio.autoplay = true;
    audio.muted = this.muted;

    const stream = await this.ensureLocalStream();
    stream?.getAudioTracks().forEach((track) => connection.addTrack(track, stream));

    connection.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('webrtc:ice-candidate', { targetSocketId: socketId, candidate: event.candidate.toJSON() });
      }
    };
    connection.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (!remoteStream) return;
      audio.srcObject = remoteStream;
      void audio.play().catch(() => undefined);
      this.attachAnalyser(remoteStream);
    };
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === 'failed') {
        // Attempt an ICE restart before giving up on the peer.
        connection.restartIce?.();
      }
      this.emitPeers();
    };

    const peer: PeerEntry = { socketId, unitId, callsign, connection, audio, pendingCandidates: [] };
    this.peers.set(socketId, peer);
    return peer;
  }

  private async createOffer(socketId: string, unitId: string, callsign: string): Promise<void> {
    const peer = await this.createPeer(socketId, unitId, callsign);
    if (!peer) return;
    const offer = await peer.connection.createOffer({ offerToReceiveAudio: true });
    await peer.connection.setLocalDescription(offer);
    this.socket.emit('webrtc:offer', { targetSocketId: socketId, sdp: offer });
  }

  private closePeer(socketId: string): void {
    const peer = this.peers.get(socketId);
    if (!peer) return;
    peer.connection.close();
    peer.audio.srcObject = null;
    this.peers.delete(socketId);
  }

  private emitPeers(): void {
    const peers: RadioPeer[] = Array.from(this.peers.values()).map((peer) => ({
      socketId: peer.socketId,
      unitId: peer.unitId,
      callsign: peer.callsign,
      connectionState: peer.connection.connectionState,
      speaking: false,
    }));
    this.handlers.onPeersChanged?.(peers);
  }
}
