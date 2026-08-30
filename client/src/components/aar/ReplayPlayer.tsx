import { useEffect, useMemo, useRef, useState } from 'react';
import type { Operation } from '../../types';
import { addBookmark } from '../../api/aar';

interface Props {
  operation: Operation;
  onBookmarkAdded?: (label: string, timestamp: number) => void;
}

const SPEED_OPTIONS = [0.1, 0.25, 0.5, 1, 2, 4, 8];

/**
 * Tactical replay engine: plays back an operation's recorded frames with
 * play/pause/stop, adjustable speed, a timeline scrubber, frame-by-frame
 * stepping and bookmarks.
 */
export default function ReplayPlayer({ operation, onBookmarkAdded }: Props) {
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [bookmarkLabel, setBookmarkLabel] = useState('');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const frames = operation.frames;
  const lastIndex = Math.max(0, frames.length - 1);
  const currentFrame = frames[frameIndex] ?? frames[0];

  useEffect(() => {
    setFrameIndex(0);
    setPlaying(false);
  }, [operation.id]);

  useEffect(() => {
    if (!playing) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    const baseMs = 1000 / speed;
    intervalRef.current = setInterval(() => {
      setFrameIndex((idx) => {
        if (idx >= lastIndex) {
          setPlaying(false);
          return idx;
        }
        return idx + 1;
      });
    }, Math.max(30, baseMs));
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [playing, speed, lastIndex]);

  const startTime = frames[0]?.timestamp ?? 0;
  const elapsedSec = currentFrame ? Math.round((currentFrame.timestamp - startTime) / 1000) : 0;

  const eventsUpToNow = useMemo(
    () => frames.slice(0, frameIndex + 1).flatMap((f) => f.events),
    [frames, frameIndex]
  );

  const handleAddBookmark = async () => {
    if (!currentFrame || !bookmarkLabel.trim()) return;
    await addBookmark(operation.id, currentFrame.timestamp, bookmarkLabel.trim());
    onBookmarkAdded?.(bookmarkLabel.trim(), currentFrame.timestamp);
    setBookmarkLabel('');
  };

  const jumpToBookmark = (timestamp: number) => {
    const idx = frames.findIndex((f) => f.timestamp >= timestamp);
    if (idx >= 0) setFrameIndex(idx);
  };

  if (frames.length === 0) {
    return <p className="hint-text">This operation has no recorded frames yet.</p>;
  }

  return (
    <div className="aar-replay">
      <div className="terrain-actions">
        <button className="action-btn" onClick={() => setFrameIndex(0)} title="Stop / rewind to start">
          ⏹ Stop
        </button>
        <button
          className="action-btn"
          onClick={() => setFrameIndex((i) => Math.max(0, i - 1))}
          disabled={frameIndex === 0}
          title="Step back one frame"
        >
          ⏮ Step
        </button>
        <button className="action-btn play-btn" onClick={() => setPlaying((p) => !p)}>
          {playing ? '⏸ Pause' : '▶ Play'}
        </button>
        <button
          className="action-btn"
          onClick={() => setFrameIndex((i) => Math.min(lastIndex, i + 1))}
          disabled={frameIndex >= lastIndex}
          title="Step forward one frame"
        >
          Step ⏭
        </button>
        <label className="speed-select">
          Speed:{' '}
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {SPEED_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}x
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="aar-scrubber">
        <input
          type="range"
          min={0}
          max={lastIndex}
          value={frameIndex}
          onChange={(e) => setFrameIndex(Number(e.target.value))}
        />
        <span>
          Frame {frameIndex + 1} / {frames.length} ({elapsedSec}s elapsed)
        </span>
      </div>

      <div className="aar-bookmark-controls">
        <input
          type="text"
          placeholder="Bookmark label for this moment..."
          value={bookmarkLabel}
          onChange={(e) => setBookmarkLabel(e.target.value)}
        />
        <button className="action-btn" onClick={handleAddBookmark} disabled={!bookmarkLabel.trim()}>
          🔖 Add Bookmark
        </button>
      </div>
      {operation.bookmarks.length > 0 && (
        <ul className="aar-bookmark-list">
          {operation.bookmarks.map((b) => (
            <li key={b.id}>
              <button className="link-btn" onClick={() => jumpToBookmark(b.timestamp)}>
                🔖 {b.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="unit-status-list">
        <h3>Unit Positions at This Frame</h3>
        <table>
          <thead>
            <tr>
              <th>Unit</th>
              <th>Affiliation</th>
              <th>Status</th>
              <th>Strength</th>
              <th>Position</th>
            </tr>
          </thead>
          <tbody>
            {currentFrame?.units.map((u) => (
              <tr key={u.id} className={`affiliation-${u.affiliation} ${u.status === 'destroyed' ? 'unit-casualty' : ''}`}>
                <td>{u.name}</td>
                <td>{u.affiliation}</td>
                <td>{u.status === 'destroyed' ? '💀 destroyed' : u.status}</td>
                <td>{u.strength}</td>
                <td>
                  {u.position.lat.toFixed(4)}, {u.position.lon.toFixed(4)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="narration-log">
        <h3>Events Up To Current Frame</h3>
        <ul>
          {eventsUpToNow
            .slice()
            .reverse()
            .map((e, i) => (
              <li key={i}>
                <span className="event-time">{new Date(e.timestamp).toLocaleTimeString()}</span> [{e.type}] {e.message}
              </li>
            ))}
          {eventsUpToNow.length === 0 && <li>No events recorded yet at this point in the replay.</li>}
        </ul>
      </div>
    </div>
  );
}
