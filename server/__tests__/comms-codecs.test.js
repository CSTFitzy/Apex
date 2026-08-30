import { describe, it, expect } from 'vitest';
import { isValidSdp, parseAudioCodecs, preferAudioCodecs, PREFERRED_AUDIO_CODECS } from '../comms/codecs.js';

const SAMPLE_SDP = [
  'v=0',
  'o=- 123456 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 9 0 8',
  'c=IN IP4 0.0.0.0',
  'a=rtpmap:111 opus/48000/2',
  'a=rtpmap:9 G722/8000',
  'a=rtpmap:0 PCMU/8000',
  'a=rtpmap:8 PCMA/8000',
].join('\r\n');

describe('comms/codecs', () => {
  describe('isValidSdp', () => {
    it('accepts a well-formed SDP blob', () => {
      expect(isValidSdp(SAMPLE_SDP)).toBe(true);
    });

    it('rejects non-string, empty, or oversized SDP', () => {
      expect(isValidSdp(null)).toBe(false);
      expect(isValidSdp('')).toBe(false);
      expect(isValidSdp('a'.repeat(20001))).toBe(false);
    });

    it('rejects SDP not starting with v=0', () => {
      expect(isValidSdp('m=audio 9 RTP/AVP 0')).toBe(false);
    });
  });

  describe('parseAudioCodecs', () => {
    it('extracts codec names from rtpmap lines in order', () => {
      expect(parseAudioCodecs(SAMPLE_SDP)).toEqual(['opus', 'g722', 'pcmu', 'pcma']);
    });

    it('returns an empty array when there are no rtpmap lines', () => {
      expect(parseAudioCodecs('v=0\r\nm=audio 9 RTP/AVP 0')).toEqual([]);
    });
  });

  describe('preferAudioCodecs', () => {
    it('reorders payload types so opus comes first', () => {
      const rewritten = preferAudioCodecs(SAMPLE_SDP);
      const mLine = rewritten.split('\r\n').find((line) => line.startsWith('m=audio'));
      expect(mLine).toBe('m=audio 9 UDP/TLS/RTP/SAVPF 111 9 0 8');
    });

    it('moves a non-preferred-first codec order so opus leads', () => {
      const sdp = [
        'v=0',
        'm=audio 9 UDP/TLS/RTP/SAVPF 0 8 111 9',
        'a=rtpmap:111 opus/48000/2',
        'a=rtpmap:9 G722/8000',
        'a=rtpmap:0 PCMU/8000',
        'a=rtpmap:8 PCMA/8000',
      ].join('\r\n');

      const rewritten = preferAudioCodecs(sdp, PREFERRED_AUDIO_CODECS);
      const mLine = rewritten.split('\r\n').find((line) => line.startsWith('m=audio'));
      expect(mLine.split(' ').slice(3)).toEqual(['111', '9', '0', '8']);
    });

    it('returns the original SDP unchanged when there is no m=audio line', () => {
      const sdp = 'v=0\r\nm=video 9 RTP/AVP 96';
      expect(preferAudioCodecs(sdp)).toBe(sdp);
    });
  });
});
