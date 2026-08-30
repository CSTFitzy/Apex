import { useEffect, useMemo, useState } from 'react';
import {
  FIELD_LABELS,
  MESSAGE_TEMPLATE_FIELDS,
  MESSAGE_TYPE_LABELS,
  buildProtocolText,
} from '../../utils/comms';
import type { ComposeInput } from '../../store/commsStore';
import type { MessageType, MessageUrgency, PresenceRecord } from '../../types';

interface Props {
  roster: PresenceRecord[];
  selfCallsign: string;
  currentChannelId: string | null;
  selectedUnitIds: string[];
  onSelectedUnitsChange: (ids: string[]) => void;
  onSend: (input: ComposeInput) => Promise<void>;
  onTyping: (typing: boolean) => void;
  sending: boolean;
}

const TYPES: MessageType[] = ['INTEL', 'ORDER', 'CASREP', 'SUPPORT', 'SITREP', 'CUSTOM'];
const URGENCIES: MessageUrgency[] = ['ROUTINE', 'PRIORITY', 'IMMEDIATE', 'FLASH'];

/**
 * Message composition form: template selection, structured fields, urgency,
 * and routing (direct / channel group / broadcast) with callsign autocomplete.
 */
export default function MessageComposer({
  roster,
  selfCallsign,
  currentChannelId,
  selectedUnitIds,
  onSelectedUnitsChange,
  onSend,
  onTyping,
  sending,
}: Props) {
  const [type, setType] = useState<MessageType>('INTEL');
  const [urgency, setUrgency] = useState<MessageUrgency>('ROUTINE');
  const [subject, setSubject] = useState('');
  const [freeText, setFreeText] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [routing, setRouting] = useState<'direct' | 'channel' | 'broadcast'>('channel');

  const templateFields = MESSAGE_TEMPLATE_FIELDS[type];

  const recipientCallsign = useMemo(() => {
    if (routing === 'broadcast') return 'ALL STATIONS';
    if (routing === 'channel') return 'ALL STATIONS THIS NET';
    const names = selectedUnitIds
      .map((id) => roster.find((r) => r.unitId === id)?.callsign)
      .filter(Boolean);
    return names.length > 0 ? names.join(' AND ') : 'ANY STATION';
  }, [routing, selectedUnitIds, roster]);

  const preview = buildProtocolText(type, fields, freeText, selfCallsign, recipientCallsign);

  // A typing indicator is only meaningful while the operator is still composing.
  useEffect(() => {
    if (!freeText && Object.keys(fields).length === 0) return;
    onTyping(true);
    const timer = setTimeout(() => onTyping(false), 1500);
    return () => clearTimeout(timer);
  }, [freeText, fields, onTyping]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await onSend({
      type,
      urgency,
      subject: subject || MESSAGE_TYPE_LABELS[type],
      content: preview,
      fields,
      recipientIds: routing === 'direct' ? selectedUnitIds : [],
      channelId: routing === 'channel' ? currentChannelId : null,
    });
    setSubject('');
    setFreeText('');
    setFields({});
    onTyping(false);
  };

  return (
    <form className="message-composer" onSubmit={submit}>
      <h3>Compose Message</h3>

      <label>
        Template
        <select value={type} onChange={(e) => { setType(e.target.value as MessageType); setFields({}); }}>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {MESSAGE_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>

      <label>
        Precedence
        <select value={urgency} onChange={(e) => setUrgency(e.target.value as MessageUrgency)}>
          {URGENCIES.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </label>

      <label>
        Routing
        <select value={routing} onChange={(e) => setRouting(e.target.value as typeof routing)}>
          <option value="channel" disabled={!currentChannelId}>
            This net (group)
          </option>
          <option value="direct">Direct to selected unit(s)</option>
          <option value="broadcast">Broadcast to all stations</option>
        </select>
      </label>

      {routing === 'direct' && (
        <label>
          Addressees
          <input
            list="comms-callsigns"
            placeholder="Type a callsign and press Enter"
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              const value = (event.target as HTMLInputElement).value.trim();
              const match = roster.find((r) => r.callsign.toLowerCase() === value.toLowerCase());
              if (match && !selectedUnitIds.includes(match.unitId)) {
                onSelectedUnitsChange([...selectedUnitIds, match.unitId]);
              }
              (event.target as HTMLInputElement).value = '';
            }}
          />
          <datalist id="comms-callsigns">
            {roster.map((r) => (
              <option key={r.unitId} value={r.callsign} />
            ))}
          </datalist>
          <span className="addressee-chips">
            {selectedUnitIds.map((id) => (
              <button
                key={id}
                type="button"
                className="chip"
                onClick={() => onSelectedUnitsChange(selectedUnitIds.filter((s) => s !== id))}
              >
                {roster.find((r) => r.unitId === id)?.callsign ?? id} ✕
              </button>
            ))}
          </span>
        </label>
      )}

      <label>
        Subject
        <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={MESSAGE_TYPE_LABELS[type]} />
      </label>

      {templateFields.map((field) => (
        <label key={field}>
          {FIELD_LABELS[field] ?? field}
          <input
            value={fields[field] ?? ''}
            onChange={(e) => setFields((prev) => ({ ...prev, [field]: e.target.value }))}
          />
        </label>
      ))}

      <label>
        Remarks
        <textarea rows={2} value={freeText} onChange={(e) => setFreeText(e.target.value)} />
      </label>

      <p className="protocol-preview">{preview}</p>

      <button type="submit" className="action-btn" disabled={sending}>
        {sending ? 'Transmitting…' : 'Send Message'}
      </button>
    </form>
  );
}
