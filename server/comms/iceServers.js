/**
 * ICE server configuration for WebRTC peer connections.
 *
 * Reads STUN/TURN configuration from the environment so deployments can
 * point clients at their own TURN infrastructure (required for peers behind
 * symmetric NATs) without code changes.
 */

const DEFAULT_STUN_SERVERS = ['stun:stun.l.google.com:19302'];

/**
 * Build the list of RTCIceServer entries clients should use.
 * @returns {Array<{ urls: string|string[], username?: string, credential?: string }>}
 */
export function getIceServers() {
  const stunUrls = (process.env.STUN_URLS || DEFAULT_STUN_SERVERS.join(','))
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);

  const iceServers = [{ urls: stunUrls }];

  const turnUrls = (process.env.TURN_URLS || '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);

  if (turnUrls.length > 0) {
    iceServers.push({
      urls: turnUrls,
      username: process.env.TURN_USERNAME || undefined,
      credential: process.env.TURN_CREDENTIAL || undefined,
    });
  }

  return iceServers;
}
