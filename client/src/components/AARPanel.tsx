import { useEffect, useMemo, useRef, useState } from 'react';
import type { AAROperation, AARSummary, LessonCategory, OperationComparison } from '../types';
import api from '../api/client';

const LESSON_LABELS: Record<LessonCategory, string> = {
  what_went_well: 'What Went Well',
  what_could_improve: 'What Could Improve',
  doctrinal_alignment: 'Doctrinal Alignment',
  enemy_analysis: 'Enemy Analysis',
  environmental_factors: 'Environmental Factors',
  training_recommendations: 'Training Recommendations',
};

const LESSON_ORDER: LessonCategory[] = [
  'what_went_well',
  'what_could_improve',
  'doctrinal_alignment',
  'enemy_analysis',
  'environmental_factors',
  'training_recommendations',
];

const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 4, 8];

function fmtDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}m ${sec}s`;
}

/**
 * After-Action Review panel: lists generated AARs (produced by "End Operation
 * & Generate AAR" in the Simulation tab), and for the selected operation
 * provides a tactical replay (play/pause/speed/timeline scrubber), per-unit
 * performance analytics, AI-generated lessons learned, and a historical
 * comparison against a second operation. Also supports JSON/CSV export.
 */
export default function AARPanel() {
  const [summaries, setSummaries] = useState<AARSummary[]>([]);
  const [selected, setSelected] = useState<AAROperation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Replay state
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [frameIndex, setFrameIndex] = useState(0);
  const playTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Comparison state
  const [compareId, setCompareId] = useState<string>('');
  const [comparison, setComparison] = useState<OperationComparison | null>(null);

  const refreshList = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<{ operations: AARSummary[] }>('/aar');
      setSummaries(data.operations);
    } catch (err) {
      console.error(err);
      setError('Failed to load After-Action Reviews.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshList();
  }, []);

  const openOperation = async (operationId: string) => {
    setLoading(true);
    setError(null);
    setComparison(null);
    setCompareId('');
    try {
      const { data } = await api.get<AAROperation>(`/aar/${operationId}`);
      setSelected(data);
      setFrameIndex(0);
      setPlaying(false);
    } catch (err) {
      console.error(err);
      setError('Failed to load operation.');
    } finally {
      setLoading(false);
    }
  };

  // Replay playback loop: advances frameIndex based on the selected speed.
  useEffect(() => {
    if (playTimerRef.current) {
      clearInterval(playTimerRef.current);
      playTimerRef.current = null;
    }
    if (!playing || !selected) return;
    const intervalMs = Math.max(50, 500 / speed);
    playTimerRef.current = setInterval(() => {
      setFrameIndex((i) => {
        if (i >= selected.frames.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, intervalMs);
    return () => {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, speed, selected]);

  const currentFrame = useMemo(() => selected?.frames[frameIndex], [selected, frameIndex]);

  const runComparison = async (otherId: string) => {
    if (!selected || !otherId) {
      setComparison(null);
      return;
    }
    try {
      const { data } = await api.get<OperationComparison>(
        `/aar/compare/${selected.operationId}/${otherId}`
      );
      setComparison(data);
    } catch (err) {
      console.error(err);
      setError('Failed to compare operations.');
    }
  };

  const exportReport = (format: 'json' | 'csv') => {
    if (!selected) return;
    window.open(`/api/aar/${selected.operationId}/export?format=${format}`, '_blank');
  };

  return (
    <div className="aar-panel">
      <h2>After-Action Review</h2>
      <p className="panel-subtitle">
        Tactical replay, performance analytics, and AI-generated lessons learned for completed operations.
      </p>

      {error && <p className="error-text">{error}</p>}

      <div className="terrain-actions">
        <button className="action-btn" onClick={refreshList} disabled={loading}>
          🔄 Refresh
        </button>
      </div>

      <div className="unit-status-list">
        <h3>Operations</h3>
        {summaries.length === 0 && (
          <p className="hint-text">
            No AARs yet. Run a simulation and click &quot;End Operation &amp; Generate AAR&quot; in the Simulation tab.
          </p>
        )}
        {summaries.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Operation</th>
                <th>Success</th>
                <th>Friendly Cas.</th>
                <th>Enemy Cas.</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map((s) => (
                <tr
                  key={s.operationId}
                  onClick={() => openOperation(s.operationId)}
                  style={{ cursor: 'pointer' }}
                  className={selected?.operationId === s.operationId ? 'affiliation-friendly' : undefined}
                >
                  <td>{s.name}</td>
                  <td>{s.missionSuccessRatingPct}%</td>
                  <td>{s.friendlyCasualties}</td>
                  <td>{s.enemyCasualties}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <>
          <div className="terrain-report">
            <h3>Summary — {selected.name}</h3>
            <ul>
              <li>Duration: {fmtDuration(selected.summary.durationMs)}</li>
              <li>Mission success rating: {selected.summary.missionSuccessRatingPct}%</li>
              <li>Overall combat effectiveness: {selected.summary.overallCombatEffectiveness}/100</li>
              <li>Friendly casualties: {selected.summary.friendlyCasualties}</li>
              <li>Enemy casualties: {selected.summary.enemyCasualties}</li>
            </ul>
          </div>

          <div className="narration-log">
            <h3>Tactical Replay</h3>
            {selected.frames.length === 0 ? (
              <p className="stats-empty">No recorded frames for this operation.</p>
            ) : (
              <>
                <div className="terrain-actions">
                  <button className="action-btn play-btn" onClick={() => setPlaying((p) => !p)}>
                    {playing ? '⏸ Pause' : '▶ Play'}
                  </button>
                  <button
                    className="action-btn secondary"
                    onClick={() => {
                      setPlaying(false);
                      setFrameIndex(0);
                    }}
                  >
                    ⏹ Stop
                  </button>
                  <button
                    className="action-btn secondary"
                    onClick={() => setFrameIndex((i) => Math.max(0, i - 1))}
                  >
                    ⏮ Step
                  </button>
                  <button
                    className="action-btn secondary"
                    onClick={() => setFrameIndex((i) => Math.min(selected.frames.length - 1, i + 1))}
                  >
                    ⏭ Step
                  </button>
                  <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                    {SPEEDS.map((s) => (
                      <option key={s} value={s}>
                        {s}x
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  type="range"
                  min={0}
                  max={selected.frames.length - 1}
                  value={frameIndex}
                  onChange={(e) => {
                    setPlaying(false);
                    setFrameIndex(Number(e.target.value));
                  }}
                  style={{ width: '100%' }}
                />
                <p className="hint-text">
                  Frame {frameIndex + 1} / {selected.frames.length} —{' '}
                  {currentFrame ? new Date(currentFrame.timestamp).toLocaleTimeString() : ''}
                </p>
                {currentFrame?.event && (
                  <p className="hint-text">
                    {currentFrame.event.eventType === 'combat_action' ? '💥 ' : ''}
                    {currentFrame.event.message}
                  </p>
                )}
                <table>
                  <thead>
                    <tr>
                      <th>Unit</th>
                      <th>Status</th>
                      <th>Strength</th>
                      <th>Position</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentFrame?.units.map((u) => (
                      <tr key={u.id} className={`affiliation-${u.affiliation}`}>
                        <td>{u.name}</td>
                        <td>{u.status}</td>
                        <td>{u.strength}</td>
                        <td>
                          {u.position.lat.toFixed(4)}, {u.position.lon.toFixed(4)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>

          <div className="unit-status-list">
            <h3>Unit Performance</h3>
            <table>
              <thead>
                <tr>
                  <th>Unit</th>
                  <th>Casualties</th>
                  <th>Cas. Rate</th>
                  <th>Effectiveness</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {selected.unitPerformance.map((u) => (
                  <tr key={u.unitId} className={`affiliation-${u.affiliation}`}>
                    <td>{u.unitName}</td>
                    <td>
                      {u.casualties} ({u.startingStrength}→{u.endingStrength})
                    </td>
                    <td>{u.casualtyRatePct}%</td>
                    <td>{u.combatEffectivenessScore}/100</td>
                    <td>{u.finalStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h4>Commander Evaluation</h4>
            <ul>
              <li>Friendly units commanded: {selected.commanderPerformance.friendlyUnitCount}</li>
              <li>Total friendly casualties: {selected.commanderPerformance.totalFriendlyCasualties}</li>
              <li>Total enemy casualties inflicted: {selected.commanderPerformance.totalEnemyCasualties}</li>
              <li>
                Average combat effectiveness: {selected.commanderPerformance.averageCombatEffectiveness}/100
              </li>
              <li>Decision quality score: {selected.commanderPerformance.decisionQualityScore}/100</li>
            </ul>
          </div>

          <div className="terrain-report">
            <h3>AI-Generated Lessons Learned</h3>
            {LESSON_ORDER.map((category) => {
              const lessons = selected.lessons.filter((l) => l.category === category);
              if (lessons.length === 0) return null;
              return (
                <div key={category} className="doctrine-card">
                  <h4>{LESSON_LABELS[category]}</h4>
                  <ul>
                    {lessons.map((lesson) => (
                      <li key={lesson.id}>
                        <span className="confidence-badge">{lesson.severity}</span> {lesson.summary}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>

          <div className="terrain-report">
            <h3>Historical Comparison</h3>
            <div className="force-row">
              <select
                value={compareId}
                onChange={(e) => {
                  setCompareId(e.target.value);
                  runComparison(e.target.value);
                }}
              >
                <option value="">Select operation to compare…</option>
                {summaries
                  .filter((s) => s.operationId !== selected.operationId)
                  .map((s) => (
                    <option key={s.operationId} value={s.operationId}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </div>
            {comparison && (
              <table>
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>{comparison.operationA.name}</th>
                    <th>{comparison.operationB.name}</th>
                    <th>Δ</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Friendly casualties</td>
                    <td>{comparison.operationA.friendlyCasualties}</td>
                    <td>{comparison.operationB.friendlyCasualties}</td>
                    <td>{comparison.deltas.friendlyCasualties}</td>
                  </tr>
                  <tr>
                    <td>Enemy casualties</td>
                    <td>{comparison.operationA.enemyCasualties}</td>
                    <td>{comparison.operationB.enemyCasualties}</td>
                    <td>{comparison.deltas.enemyCasualties}</td>
                  </tr>
                  <tr>
                    <td>Mission success</td>
                    <td>{comparison.operationA.missionSuccessRatingPct}%</td>
                    <td>{comparison.operationB.missionSuccessRatingPct}%</td>
                    <td>{comparison.deltas.missionSuccessRatingPct}</td>
                  </tr>
                  <tr>
                    <td>Combat effectiveness</td>
                    <td>{comparison.operationA.overallCombatEffectiveness}</td>
                    <td>{comparison.operationB.overallCombatEffectiveness}</td>
                    <td>{comparison.deltas.overallCombatEffectiveness}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>

          <div className="terrain-actions">
            <button className="action-btn secondary" onClick={() => exportReport('json')}>
              ⬇ Export JSON
            </button>
            <button className="action-btn secondary" onClick={() => exportReport('csv')}>
              ⬇ Export CSV
            </button>
          </div>
        </>
      )}
    </div>
  );
}
