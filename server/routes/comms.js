/**
 * Comms configuration routes: exposes WebRTC ICE server config to
 * authenticated clients so voice calls can be established.
 */
import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { getIceServers } from '../comms/iceServers.js';

const router = Router();

/**
 * GET /api/comms/ice-servers
 * Returns the STUN/TURN server list clients should use for WebRTC calls.
 */
router.get('/ice-servers', requireAuth, (req, res) => {
  return res.json({ iceServers: getIceServers() });
});

export default router;
