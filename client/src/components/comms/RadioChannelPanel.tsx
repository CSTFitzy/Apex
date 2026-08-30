import SignalStrength from './SignalStrength';
import type { LinkQuality, RadioChannel } from '../../types';

interface Props {
  channels: RadioChannel[];
  currentChannelId: string | null;
  link: LinkQuality | null;
  selfUnitId: string | null;
  activeSpeaker: { channelId: string; unitId: string; callsign: string } | null;
  onJoin: (channelId: string) => void;
  onLeave: () => void;
}

const STATUS_LABEL: Record<RadioChannel['status'], string> = {
  IDLE: 'Idle',
  BUSY: 'Busy',
  COMPROMISED: 'Compromised',
};

/**
 * Channel directory: every simulated radio net with its frequency, membership,
 * current status, active speaker and (for the joined net) signal strength.
 */
export default function RadioChannelPanel({
  channels,
  currentChannelId,
  link,
  selfUnitId,
  activeSpeaker,
  onJoin,
  onLeave,
}: Props) {
  return (
    <div className="radio-channel-panel">
      <h3>Active Channels</h3>
      {channels.length === 0 && <p className="hint-text">Channel directory unavailable - check the comms server.</p>}
      <ul className="channel-list">
        {channels.map((channel) => {
          const joined = channel.id === currentChannelId;
          const speaker =
            activeSpeaker && activeSpeaker.channelId === channel.id ? activeSpeaker.callsign : null;
          const onNet = channel.members.some((m) => m.unitId === selfUnitId);
          return (
            <li key={channel.id} className={`channel-item status-${channel.status.toLowerCase()} ${joined ? 'joined' : ''}`}>
              <div className="channel-head">
                <span className="channel-name">
                  {channel.name} {channel.encrypted ? '🔒' : '🔓'}
                </span>
                <span className="channel-freq">{channel.frequencyMHz.toFixed(3)} MHz</span>
              </div>
              <div className="channel-meta">
                <span>{channel.members.length} station(s)</span>
                <span className={`channel-status status-${channel.status.toLowerCase()}`}>
                  {STATUS_LABEL[channel.status]}
                </span>
                {joined && <SignalStrength link={link} compact />}
              </div>
              {speaker && <div className="active-speaker">🔊 {speaker} transmitting…</div>}
              {channel.members.length > 0 && (
                <div className="channel-members">
                  {channel.members.map((m) => m.callsign).join(', ')}
                </div>
              )}
              <div className="channel-actions">
                {joined || onNet ? (
                  <button type="button" className="action-btn danger" onClick={onLeave}>
                    Leave Net
                  </button>
                ) : (
                  <button type="button" className="action-btn" onClick={() => onJoin(channel.id)}>
                    Join Net
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
