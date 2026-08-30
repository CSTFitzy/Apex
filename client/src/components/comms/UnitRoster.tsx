import type { PresenceRecord } from '../../types';

interface Props {
  roster: PresenceRecord[];
  unread: Record<string, number>;
  selfUnitId: string | null;
  selectedUnitIds: string[];
  onToggleUnit: (unitId: string) => void;
}

/**
 * Unit roster showing which stations are online, which net they are on, and how
 * many unread messages are waiting for each of them.
 */
export default function UnitRoster({ roster, unread, selfUnitId, selectedUnitIds, onToggleUnit }: Props) {
  return (
    <div className="unit-roster">
      <h3>Unit Roster</h3>
      {roster.length === 0 && <p className="hint-text">No stations have checked in yet.</p>}
      <ul>
        {roster.map((unit) => {
          const count = unread[unit.unitId] ?? 0;
          const isSelf = unit.unitId === selfUnitId;
          return (
            <li
              key={unit.unitId}
              className={`roster-item ${selectedUnitIds.includes(unit.unitId) ? 'selected' : ''}`}
            >
              <button
                type="button"
                className="roster-btn"
                onClick={() => onToggleUnit(unit.unitId)}
                disabled={isSelf}
                title={isSelf ? 'This station' : `Address a direct message to ${unit.callsign}`}
              >
                <span className={`presence-dot ${unit.online ? 'online' : 'offline'}`} />
                <span className="roster-callsign">
                  {unit.callsign}
                  {isSelf && ' (you)'}
                </span>
                <span className="roster-net">{unit.channelId ?? 'off net'}</span>
                {count > 0 && <span className="unread-badge">{count}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
