import { useEffect, useMemo, useRef, useState } from 'react';
import RadioChannelPanel from './RadioChannelPanel';
import ActiveCallDisplay from './ActiveCallDisplay';
import MessageLog from './MessageLog';
import MessageComposer from './MessageComposer';
import UnitRoster from './UnitRoster';
import VoiceLogPlayer from './VoiceLogPlayer';
import { useCommsStore, type ComposeInput } from '../../store/commsStore';
import { isRadioSupported } from '../../comms/radio';
import { URGENCY_COLORS } from '../../utils/comms';
import api from '../../api/client';
import type { CommsRole, LinkQuality, TacticalUnit, WeatherData } from '../../types';

interface Props {
  units: TacticalUnit[];
  weather?: WeatherData | null;
}

const ROLES: CommsRole[] = ['COMMANDER', 'OFFICER', 'OPERATOR'];
const LINK_REFRESH_MS = 5000;

/**
 * Communications dashboard: radio net management with push-to-talk on one side
 * and the tactical message log / composer on the other.
 */
export default function CommunicationsPanel({ units, weather = null }: Props) {
  const store = useCommsStore();
  const [section, setSection] = useState<'channels' | 'messages'>('channels');
  const [callsign, setCallsign] = useState('BRAVO-1');
  const [role, setRole] = useState<CommsRole>('COMMANDER');
  const [unitId, setUnitId] = useState('');
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const alertAudioRef = useRef<HTMLAudioElement | null>(null);

  const currentChannel = useMemo(
    () => store.channels.find((c) => c.id === store.currentChannelId) ?? null,
    [store.channels, store.currentChannelId]
  );

  /**
   * Periodically re-evaluates radio link quality for the joined net using the
   * live unit positions, terrain masking proxy and current weather.
   */
  useEffect(() => {
    if (!store.currentChannelId || !currentChannel) return;
    const selfUnit = units.find((u) => u.id === store.identity?.unitId) ?? units[0];
    if (!selfUnit) return;

    const peers = currentChannel.members
      .filter((m) => m.unitId !== store.identity?.unitId)
      .map((m) => units.find((u) => u.id === m.unitId))
      .filter((u): u is TacticalUnit => Boolean(u))
      .map((u) => ({ unitId: u.id, position: u.position }));

    const overlapping = store.channels.filter(
      (c) => c.id !== currentChannel.id && c.status === 'BUSY' && Math.abs(c.frequencyMHz - currentChannel.frequencyMHz) < 5
    ).length;

    const refresh = async () => {
      try {
        const { data } = await api.post<{ link: LinkQuality }>('/comms/signal', {
          from: selfUnit.position,
          peers,
          frequencyMHz: currentChannel.frequencyMHz,
          overlappingChannels: overlapping,
          weather: {
            precipitationMm: Number(weather?.current?.precipitation ?? 0),
            windSpeedKph: Number(weather?.current?.wind_speed_10m ?? 0),
            humidityPct: Number(weather?.current?.relative_humidity_2m ?? 0),
          },
        });
        store.updateLink(data.link);
      } catch {
        /* keep the last known link quality if the server is unreachable */
      }
    };

    void refresh();
    const timer = setInterval(refresh, LINK_REFRESH_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.currentChannelId, currentChannel, units, weather, store.channels]);

  // Audible alert for IMMEDIATE/FLASH traffic.
  useEffect(() => {
    if (!store.alert) return;
    alertAudioRef.current?.play().catch(() => undefined);
  }, [store.alert]);

  const handleSend = async (input: ComposeInput) => {
    setSending(true);
    await store.sendMessage(input);
    setSending(false);
  };

  if (!store.identity) {
    return (
      <div className="comms-panel">
        <h2>Tactical Communications</h2>
        <p className="panel-subtitle">WebRTC radio nets and encrypted real-time messaging.</p>
        <form
          className="comms-signin"
          onSubmit={(event) => {
            event.preventDefault();
            void store.signIn(unitId || `unit-${callsign.toLowerCase()}`, callsign, role);
          }}
        >
          <label>
            Callsign
            <input value={callsign} onChange={(e) => setCallsign(e.target.value)} required />
          </label>
          <label>
            Unit ID (optional — links this station to a simulated unit)
            <select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
              <option value="">Not linked</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Role
            <select value={role} onChange={(e) => setRole(e.target.value as CommsRole)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="action-btn">
            Sign On to Net
          </button>
        </form>
        {store.error && <p className="error-text">{store.error}</p>}
      </div>
    );
  }

  return (
    <div className="comms-panel">
      <h2>Tactical Communications</h2>
      <div className="comms-identity">
        <span className={`presence-dot ${store.connected ? 'online' : 'offline'}`} />
        {store.identity.callsign} · {store.identity.role}
        <button type="button" className="link-btn" onClick={store.signOut}>
          Sign off
        </button>
      </div>
      {!isRadioSupported() && (
        <p className="hint-text">Voice transmission is unavailable in this browser; messaging still works.</p>
      )}
      {store.error && <p className="error-text">{store.error}</p>}

      {store.alert && (
        <div className="comms-alert" style={{ borderColor: URGENCY_COLORS[store.alert.urgency] }}>
          <strong>{store.alert.urgency}</strong> from {store.alert.senderCallsign}: {store.alert.subject}
          <button type="button" className="link-btn" onClick={store.dismissAlert}>
            Dismiss
          </button>
        </div>
      )}

      <div className="comms-tabs">
        <button
          type="button"
          className={`nav-btn ${section === 'channels' ? 'active' : ''}`}
          onClick={() => setSection('channels')}
        >
          Radio Nets
        </button>
        <button
          type="button"
          className={`nav-btn ${section === 'messages' ? 'active' : ''}`}
          onClick={() => setSection('messages')}
        >
          Messages
          {Object.values(store.unread).reduce((sum, n) => sum + n, 0) > 0 && (
            <span className="unread-badge">{Object.values(store.unread).reduce((sum, n) => sum + n, 0)}</span>
          )}
        </button>
      </div>

      {section === 'channels' ? (
        <>
          <ActiveCallDisplay
            channel={currentChannel}
            link={store.link}
            peers={store.peers}
            transmitting={store.transmitting}
            muted={store.muted}
            receiveLevel={store.receiveLevel}
            latencyMs={store.latencyMs}
            activeSpeaker={store.activeSpeaker}
            onPttDown={() => void store.setTransmitting(true)}
            onPttUp={() => void store.setTransmitting(false)}
            onToggleMute={() => store.setMuted(!store.muted)}
            onLeave={() => void store.leaveChannel()}
          />
          <RadioChannelPanel
            channels={store.channels}
            currentChannelId={store.currentChannelId}
            link={store.link}
            selfUnitId={store.identity.unitId}
            activeSpeaker={store.activeSpeaker}
            onJoin={(id) => void store.joinChannel(id)}
            onLeave={() => void store.leaveChannel()}
          />
          <VoiceLogPlayer logs={store.voiceLogs} channelId={store.currentChannelId} />
        </>
      ) : (
        <>
          <MessageComposer
            roster={store.roster}
            selfCallsign={store.identity.callsign}
            currentChannelId={store.currentChannelId}
            selectedUnitIds={selectedUnitIds}
            onSelectedUnitsChange={setSelectedUnitIds}
            onSend={handleSend}
            onTyping={(typing) =>
              store.setTyping(typing, { channelId: store.currentChannelId, recipientIds: selectedUnitIds })
            }
            sending={sending}
          />
          {store.typing.filter((t) => t.unitId !== store.identity?.unitId).length > 0 && (
            <p className="typing-indicator">
              {store.typing
                .filter((t) => t.unitId !== store.identity?.unitId)
                .map((t) => t.callsign)
                .join(', ')}{' '}
              is composing…
            </p>
          )}
          <MessageLog
            messages={store.messages}
            filters={store.filters}
            onFiltersChange={store.setFilters}
            selectedMessageId={store.selectedMessageId}
            onSelect={store.selectMessage}
            onAcknowledge={(id) => void store.acknowledge(id)}
            roster={store.roster}
            selfUnitId={store.identity.unitId}
          />
          <UnitRoster
            roster={store.roster}
            unread={store.unread}
            selfUnitId={store.identity.unitId}
            selectedUnitIds={selectedUnitIds}
            onToggleUnit={(id) =>
              setSelectedUnitIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]))
            }
          />
        </>
      )}

      {/* Short synthesised beep used for priority traffic alerts. */}
      <audio
        ref={alertAudioRef}
        preload="auto"
        src="data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA="
      />
    </div>
  );
}
