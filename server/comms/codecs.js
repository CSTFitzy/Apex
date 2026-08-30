/**
 * Voice codec negotiation helpers.
 *
 * WebRTC media itself flows peer-to-peer, but the signaling server is
 * responsible for enforcing a consistent codec policy across peers (e.g.
 * preferring Opus for voice) and validating that SDP offers/answers
 * exchanged through the server look sane before relaying them.
 */

/** Preferred audio codec order (case-insensitive match against SDP rtpmap). */
export const PREFERRED_AUDIO_CODECS = ['opus', 'g722', 'pcmu', 'pcma'];

const MAX_SDP_LENGTH = 20000;

/**
 * Basic structural validation of an SDP blob before it is relayed to a peer.
 * This is not a full SDP parser - it just guards against obviously invalid
 * or oversized payloads being forwarded blindly between clients.
 * @param {unknown} sdp
 * @returns {boolean}
 */
export function isValidSdp(sdp) {
  if (typeof sdp !== 'string') return false;
  if (sdp.length === 0 || sdp.length > MAX_SDP_LENGTH) return false;
  return sdp.startsWith('v=0');
}

/**
 * Parse the `m=audio` section of an SDP blob and return the advertised
 * codec names (lowercased), in the order they appear.
 * @param {string} sdp
 * @returns {string[]}
 */
export function parseAudioCodecs(sdp) {
  if (typeof sdp !== 'string') return [];

  const codecs = [];
  const rtpmapRegex = /^a=rtpmap:\d+\s+([\w-]+)\/\d+/gim;
  let match;
  while ((match = rtpmapRegex.exec(sdp)) !== null) {
    codecs.push(match[1].toLowerCase());
  }
  return codecs;
}

/**
 * Reorder the payload types on the `m=audio` line of an SDP blob so that
 * preferred codecs (Opus first) are negotiated when supported by both
 * peers, without dropping any codecs the browser already offered.
 * @param {string} sdp
 * @param {string[]} [preference] - Preferred codec names, most preferred first.
 * @returns {string} the rewritten SDP (or the original SDP if no `m=audio` line is found)
 */
export function preferAudioCodecs(sdp, preference = PREFERRED_AUDIO_CODECS) {
  if (typeof sdp !== 'string') return sdp;

  const lines = sdp.split(/\r\n|\n/);
  const audioLineIndex = lines.findIndex((line) => line.startsWith('m=audio'));
  if (audioLineIndex === -1) return sdp;

  // Map payload type -> codec name from a=rtpmap lines.
  const payloadToCodec = new Map();
  for (const line of lines) {
    const rtpmapMatch = /^a=rtpmap:(\d+)\s+([\w-]+)\/\d+/i.exec(line);
    if (rtpmapMatch) {
      payloadToCodec.set(rtpmapMatch[1], rtpmapMatch[2].toLowerCase());
    }
  }

  const audioLineParts = lines[audioLineIndex].split(' ');
  const header = audioLineParts.slice(0, 3); // "m=audio <port> <proto>"
  const payloadTypes = audioLineParts.slice(3);

  const rank = (pt) => {
    const codec = payloadToCodec.get(pt);
    const idx = codec ? preference.indexOf(codec) : -1;
    return idx === -1 ? preference.length : idx;
  };

  const reordered = [...payloadTypes].sort((a, b) => rank(a) - rank(b));
  lines[audioLineIndex] = [...header, ...reordered].join(' ');

  return lines.join('\r\n');
}
