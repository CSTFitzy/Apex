import { useMemo } from 'react';
import {
  FIELD_LABELS,
  MESSAGE_TYPE_LABELS,
  TYPE_COLORS,
  URGENCY_COLORS,
  formatTime,
} from '../../utils/comms';
import type { MessageFilters } from '../../store/commsStore';
import type { MessageType, MessageUrgency, PresenceRecord, TacticalMessage } from '../../types';

interface Props {
  messages: TacticalMessage[];
  filters: MessageFilters;
  onFiltersChange: (filters: Partial<MessageFilters>) => void;
  selectedMessageId: string | null;
  onSelect: (id: string | null) => void;
  onAcknowledge: (id: string) => void;
  roster: PresenceRecord[];
  selfUnitId: string | null;
}

const FILTER_TYPES: Array<MessageType | 'ALL'> = ['ALL', 'INTEL', 'ORDER', 'CASREP', 'SUPPORT', 'SITREP', 'CUSTOM'];
const FILTER_URGENCIES: Array<MessageUrgency | 'ALL'> = ['ALL', 'ROUTINE', 'PRIORITY', 'IMMEDIATE', 'FLASH'];

function statusLabel(message: TacticalMessage): string {
  if (message.status === 'READ') return `Read ${message.readAt ? formatTime(message.readAt) : ''}`.trim();
  if (message.status === 'DELIVERED') return 'Delivered';
  if (message.status === 'QUEUED') return 'Queued (recipient offline)';
  return 'Sent';
}

/**
 * Chronological message log with type/urgency filters, keyword search, sorting
 * and an expandable detail view including delivery status and ACK controls.
 */
export default function MessageLog({
  messages,
  filters,
  onFiltersChange,
  selectedMessageId,
  onSelect,
  onAcknowledge,
  roster,
  selfUnitId,
}: Props) {
  const visible = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    const filtered = messages.filter((message) => {
      if (filters.type !== 'ALL' && message.type !== filters.type) return false;
      if (filters.urgency !== 'ALL' && message.urgency !== filters.urgency) return false;
      if (!search) return true;
      return [message.subject, message.content, message.senderCallsign, ...Object.values(message.fields)]
        .join(' ')
        .toLowerCase()
        .includes(search);
    });

    const order: MessageUrgency[] = ['ROUTINE', 'PRIORITY', 'IMMEDIATE', 'FLASH'];
    const sorted = [...filtered];
    switch (filters.sort) {
      case 'oldest':
        sorted.sort((a, b) => a.sentAt.localeCompare(b.sentAt));
        break;
      case 'sender':
        sorted.sort((a, b) => a.senderCallsign.localeCompare(b.senderCallsign));
        break;
      case 'type':
        sorted.sort((a, b) => a.type.localeCompare(b.type));
        break;
      case 'urgency':
        sorted.sort((a, b) => order.indexOf(b.urgency) - order.indexOf(a.urgency));
        break;
      default:
        sorted.sort((a, b) => b.sentAt.localeCompare(a.sentAt));
    }
    return sorted;
  }, [messages, filters]);

  const callsignFor = (unitId: string) =>
    roster.find((r) => r.unitId === unitId)?.callsign ?? unitId;

  return (
    <div className="message-log">
      <h3>Message Log</h3>

      <input
        className="message-search"
        type="search"
        placeholder="Search messages…"
        value={filters.search}
        onChange={(e) => onFiltersChange({ search: e.target.value })}
      />

      <div className="message-filters">
        {FILTER_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            className={`filter-btn ${filters.type === type ? 'active' : ''}`}
            onClick={() => onFiltersChange({ type })}
          >
            {type === 'ALL' ? 'All' : MESSAGE_TYPE_LABELS[type]}
          </button>
        ))}
      </div>

      <div className="message-filters">
        <select value={filters.urgency} onChange={(e) => onFiltersChange({ urgency: e.target.value as MessageUrgency | 'ALL' })}>
          {FILTER_URGENCIES.map((u) => (
            <option key={u} value={u}>
              {u === 'ALL' ? 'Any precedence' : u}
            </option>
          ))}
        </select>
        <select value={filters.sort} onChange={(e) => onFiltersChange({ sort: e.target.value as MessageFilters['sort'] })}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="sender">By sender</option>
          <option value="type">By type</option>
          <option value="urgency">By precedence</option>
        </select>
      </div>

      {visible.length === 0 && <p className="hint-text">No messages match the current filters.</p>}

      <ul className="message-list">
        {visible.map((message) => {
          const expanded = message.id === selectedMessageId;
          const unread = selfUnitId !== null && !message.readBy.includes(selfUnitId);
          const needsAck =
            message.requiresAck && selfUnitId !== null && !message.acknowledgedBy.includes(selfUnitId);
          return (
            <li
              key={message.id}
              className={`message-item ${expanded ? 'expanded' : ''} ${unread ? 'unread' : ''}`}
              style={{ borderLeftColor: URGENCY_COLORS[message.urgency] }}
            >
              <button type="button" className="message-head" onClick={() => onSelect(expanded ? null : message.id)}>
                <span className="message-type" style={{ backgroundColor: TYPE_COLORS[message.type] }}>
                  {message.type}
                </span>
                <span className="message-subject">{message.subject || MESSAGE_TYPE_LABELS[message.type]}</span>
                <span className="message-urgency" style={{ color: URGENCY_COLORS[message.urgency] }}>
                  {message.urgency}
                </span>
                <span className="message-time">{formatTime(message.sentAt)}</span>
              </button>

              <div className="message-sender">
                From {message.senderCallsign}
                {message.recipientIds.length > 0
                  ? ` → ${message.recipientIds.map(callsignFor).join(', ')}`
                  : message.channelId
                    ? ` → ${message.channelId}`
                    : ' → ALL STATIONS'}
              </div>

              {expanded && (
                <div className="message-detail">
                  <p className="message-content">{message.content || '[encrypted end-to-end]'}</p>
                  {Object.entries(message.fields).filter(([, v]) => v).length > 0 && (
                    <dl className="message-fields">
                      {Object.entries(message.fields)
                        .filter(([, value]) => value)
                        .map(([key, value]) => (
                          <div key={key}>
                            <dt>{FIELD_LABELS[key] ?? key}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                    </dl>
                  )}
                  <div className="message-meta">
                    <span>{statusLabel(message)}</span>
                    {message.acknowledgedBy.length > 0 && (
                      <span>ACK: {message.acknowledgedBy.map(callsignFor).join(', ')}</span>
                    )}
                    {message.e2e && <span title="Encrypted end-to-end">🔒 E2E</span>}
                  </div>
                  {needsAck && (
                    <button type="button" className="action-btn" onClick={() => onAcknowledge(message.id)}>
                      Acknowledge
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
