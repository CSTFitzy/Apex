import { Router, Request, Response } from 'express';
import { verifyToken } from '../comms/auth.js';
import { getCommsIo } from '../comms/gateway.js';

const router = Router();

/**
 * STUN/TURN configuration for NAT traversal. Public Google STUN servers are
 * used by default; a TURN relay (required to punch through restrictive
 * firewalls) can be supplied via TURN_URL / TURN_USERNAME / TURN_CREDENTIAL.
 */
function iceServers(): RTCIceServerConfig[] {
  const servers: RTCIceServerConfig[] = [
    { urls: (process.env.STUN_URLS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302').split(',') },
  ];
  if (process.env.TURN_URL) {
    servers.push({
      urls: process.env.TURN_URL.split(','),
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    });
  }
  return servers;
}

interface RTCIceServerConfig {
  urls: string[];
  username?: string;
  credential?: string;
}

/**
 * GET /api/webrtc/config
 * ICE servers plus the audio constraints used for tactical radio quality
 * (Opus, mono, low latency).
 */
router.get('/config', (_req: Request, res: Response) => {
  res.json({
    iceServers: iceServers(),
    audio: {
      codec: 'opus',
      // Opus at 24 kbit/s mono is ample for voice and keeps latency low.
      maxAverageBitrate: Number(process.env.VOICE_BITRATE || 24000),
      channelCount: 1,
      // Tactical radio: keep processing on so background noise is suppressed,
      // but disable auto gain jumps that mask a weak signal.
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false,
      /** Target one-way latency budget (ms) used by the UI health indicator. */
      targetLatencyMs: 200,
    },
  });
});

/**
 * POST /api/webrtc/signal
 * HTTP fallback for WebRTC signalling when a WebSocket cannot be established.
 * Body: { type: 'offer' | 'answer' | 'ice-candidate', targetSocketId, payload }
 */
router.post('/signal', (req: Request, res: Response) => {
  const identity = verifyToken(req.header('authorization') || req.body?.token);
  if (!identity) return res.status(401).json({ error: 'Authentication required' });

  const { type, targetSocketId, payload } = req.body ?? {};
  if (!['offer', 'answer', 'ice-candidate'].includes(type)) {
    return res.status(400).json({ error: "type must be 'offer', 'answer' or 'ice-candidate'" });
  }
  if (!targetSocketId) return res.status(400).json({ error: 'targetSocketId is required' });

  const io = getCommsIo();
  if (!io) return res.status(503).json({ error: 'Signalling server is not ready' });

  io.to(targetSocketId).emit(`webrtc:${type}`, {
    ...payload,
    targetSocketId,
    fromUnitId: identity.unitId,
    fromCallsign: identity.callsign,
  });
  res.json({ ok: true });
});

export default router;
