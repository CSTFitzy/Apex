import SignalStrength from './SignalStrength';
import { QUALITY_COLORS } from '../../utils/comms';
import type { LinkQuality, RadioChannel, RadioPeer } from '../../types';

interface Props {
  channel: RadioChannel | null;
  link: LinkQuality | null;
  peers: RadioPeer[];
  transmitting: boolean;
  muted: boolean;
  receiveLevel: number;
  latencyMs: number | null;
  activeSpeaker: { channelId: string; unitId: string; callsign: string } | null;
  onPttDown: () => void;
  onPttUp: () => void;
  onToggleMute: () => void;
  onLeave: () => void;
}

/** Simple bar waveform driven by the measured level of the received audio. */
function Waveform({ level, color }: { level: number; color: string }) {
  const bars = Array.from({ length: 14 }, (_, i) => {
    const phase = Math.sin((i / 14) * Math.PI);
    return Math.max(2, level * 30 * phase + 2);
  });
  return (
    <div className="waveform" aria-hidden="true">
      {bars.map((height, i) => (
        <span key={i} style={{ height: `${height}px`, backgroundColor: color }} />
      ))}
    </div>
  );
}

/**
 * Voice call interface for the joined net: push-to-talk, active speaker with a
 * live waveform, signal strength, latency and mute controls.
 */
export default function ActiveCallDisplay({
  channel,
  link,
  peers,
  transmitting,
  muted,
  receiveLevel,
  latencyMs,
  activeSpeaker,
  onPttDown,
  onPttUp,
  onToggleMute,
  onLeave,
}: Props) {
  if (!channel) {
    return <p className="hint-text">Join a radio net to transmit.</p>;
  }

  const quality = link?.quality ?? 'GOOD';
  const receiving = Boolean(activeSpeaker && activeSpeaker.channelId === channel.id && !transmitting);
  const connected = peers.filter((p) => p.connectionState === 'connected').length;

  return (
    <div className="active-call">
      <div className="active-call-head">
        <span className="call-channel">{channel.name}</span>
        <span className="call-freq">{channel.frequencyMHz.toFixed(3)} MHz</span>
        <SignalStrength link={link} />
      </div>

      <button
        type="button"
        className={`ptt-button ${transmitting ? 'transmitting' : ''}`}
        onMouseDown={onPttDown}
        onMouseUp={onPttUp}
        onMouseLeave={onPttUp}
        onTouchStart={onPttDown}
        onTouchEnd={onPttUp}
      >
        {transmitting ? '● TRANSMITTING' : 'PUSH TO TALK'}
      </button>

      {receiving && (
        <div className="receiving-block">
          <span className="receiving-label" style={{ color: QUALITY_COLORS[quality] }}>
            🔊 {activeSpeaker?.callsign} — receiving
          </span>
          <Waveform level={receiveLevel} color={QUALITY_COLORS[quality]} />
        </div>
      )}
      {!receiving && !transmitting && <div className="squelch-label">Squelch open — net idle</div>}

      <div className="call-stats">
        <span>{connected}/{peers.length} peer link(s)</span>
        <span
          className={latencyMs !== null && latencyMs > 200 ? 'latency-warn' : undefined}
          title="Signalling round-trip; the military standard target is under 200 ms one-way"
        >
          {latencyMs === null ? 'latency —' : `${latencyMs} ms RTT`}
        </span>
        {link && <span title="Risk that a nearby hostile intercepts this transmission">
          intercept risk {Math.round(link.interceptRisk * 100)}%
        </span>}
      </div>

      <div className="call-actions">
        <button type="button" className="action-btn" onClick={onToggleMute}>
          {muted ? '🔇 Unmute' : '🔊 Mute'}
        </button>
        <button type="button" className="action-btn danger" onClick={onLeave}>
          End Call
        </button>
      </div>
    </div>
  );
}
