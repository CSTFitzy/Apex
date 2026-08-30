import { useMemo, useRef, useState } from 'react';
import { QUALITY_COLORS, formatTime } from '../../utils/comms';
import type { VoiceLogEntry } from '../../types';

interface Props {
  logs: VoiceLogEntry[];
  channelId: string | null;
}

/**
 * Voice logging and playback: every recorded transmission on the net in
 * chronological order, replayable individually or as a sequence, and
 * exportable as a transcript for after-action review.
 */
export default function VoiceLogPlayer({ logs, channelId }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const entries = useMemo(
    () => (channelId ? logs.filter((log) => log.channelId === channelId) : logs),
    [logs, channelId]
  );

  const play = (entry: VoiceLogEntry) => {
    if (!entry.audio || !audioRef.current) return;
    audioRef.current.src = `data:audio/webm;base64,${entry.audio}`;
    setPlayingId(entry.id);
    void audioRef.current.play().catch(() => setPlayingId(null));
  };

  /** Replays the whole log in chronological order. */
  const playAll = async () => {
    for (const entry of entries) {
      if (!entry.audio || !audioRef.current) continue;
      play(entry);
      await new Promise((resolve) => setTimeout(resolve, Math.max(500, entry.durationMs)));
    }
    setPlayingId(null);
  };

  const exportTranscript = () => {
    const text = entries
      .map((e) => `${e.timestamp}\t${e.speakerCallsign}\t${e.quality}\t${e.transcript}`)
      .join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'apex-radio-transcript.txt';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="voice-log">
      <h3>Radio Traffic Log</h3>
      {entries.length === 0 && <p className="hint-text">No transmissions recorded on this net yet.</p>}
      {entries.length > 0 && (
        <div className="voice-log-actions">
          <button type="button" className="action-btn" onClick={() => void playAll()}>
            ▶ Replay All
          </button>
          <button type="button" className="action-btn" onClick={exportTranscript}>
            Export Transcript
          </button>
        </div>
      )}
      <ul>
        {entries.map((entry) => (
          <li key={entry.id} className={playingId === entry.id ? 'playing' : undefined}>
            <span className="event-time">{formatTime(entry.timestamp)}</span>{' '}
            <strong>{entry.speakerCallsign}</strong>{' '}
            <span style={{ color: QUALITY_COLORS[entry.quality] }}>{entry.quality}</span>{' '}
            ({(entry.durationMs / 1000).toFixed(1)}s)
            {entry.audio && (
              <button type="button" className="link-btn" onClick={() => play(entry)}>
                play
              </button>
            )}
          </li>
        ))}
      </ul>
      <audio ref={audioRef} onEnded={() => setPlayingId(null)} />
    </div>
  );
}
