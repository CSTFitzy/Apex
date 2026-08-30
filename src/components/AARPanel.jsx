import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../utils/api.js';

const REPLAY_SPEEDS = [0.1, 0.25, 0.5, 1, 2, 4, 8];

const AAR_TABS = [
  { id: 'replay', label: 'Tactical Replay' },
  { id: 'analytics', label: 'Performance Analytics' },
  { id: 'lessons', label: 'Lessons Learned' },
  { id: 'comparison', label: 'Historical Comparison' },
  { id: 'training', label: 'Training Module' },
  { id: 'reports', label: 'Reports' },
  { id: 'ai', label: 'AI Analysis' },
];

/**
 * After-Action Review (AAR) panel: tactical replay, per-unit/commander
 * performance analytics, rule-based lessons learned, historical comparison,
 * training scenario generation, report export, and AI-powered analysis
 * (Claude + GPT-4).
 *
 * Operations are recorded server-side (in-memory, see server/aar/store.js);
 * this panel loads the list of recorded operations and lets the user drill
 * into any one of them.
 */
export default function AARPanel() {
  const [activeTab, setActiveTab] = useState('replay');
  const [operations, setOperations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [operation, setOperation] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const refreshOperations = useCallback(() => {
    api
      .listAAROperations()
      .then((res) => setOperations(res.operations || []))
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    refreshOperations();
  }, [refreshOperations]);

  useEffect(() => {
    if (!selectedId) {
      setOperation(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .getAAROperation(selectedId)
      .then((res) => {
        if (!cancelled) setOperation(res.operation);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  return (
    <div className="aar-panel">
      <div className="aar-panel-header">
        <h3>After-Action Review</h3>
        <select
          value={selectedId || ''}
          onChange={(e) => setSelectedId(e.target.value || null)}
          aria-label="Select operation"
        >
          <option value="">Select an operation…</option>
          {operations.map((op) => (
            <option key={op.id} value={op.id}>
              {op.name} ({op.status})
            </option>
          ))}
        </select>
        <button className="link-button" onClick={refreshOperations}>
          Refresh
        </button>
      </div>

      {error && <p className="aar-panel-error">{error}</p>}

      <nav className="dashboard-tabs">
        {AAR_TABS.map((tab) => (
          <button
            key={tab.id}
            className={activeTab === tab.id ? 'tab-active' : ''}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {!operation && !loading && (
        <p className="aar-panel-hint">Select a recorded operation above to review it.</p>
      )}

      {operation && (
        <>
          <div className={activeTab === 'replay' ? '' : 'tab-hidden'}>
            <TacticalReplayTab operation={operation} />
          </div>
          <div className={activeTab === 'analytics' ? '' : 'tab-hidden'}>
            <PerformanceAnalyticsTab operationId={operation.id} />
          </div>
          <div className={activeTab === 'lessons' ? '' : 'tab-hidden'}>
            <LessonsLearnedTab operationId={operation.id} />
          </div>
          <div className={activeTab === 'comparison' ? '' : 'tab-hidden'}>
            <HistoricalComparisonTab operationId={operation.id} operations={operations} />
          </div>
          <div className={activeTab === 'training' ? '' : 'tab-hidden'}>
            <TrainingModuleTab operationId={operation.id} />
          </div>
          <div className={activeTab === 'reports' ? '' : 'tab-hidden'}>
            <ReportsTab operationId={operation.id} />
          </div>
          <div className={activeTab === 'ai' ? '' : 'tab-hidden'}>
            <AIAnalysisTab operationId={operation.id} />
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tactical Replay                                                      */
/* ------------------------------------------------------------------ */

function TacticalReplayTab({ operation }) {
  const frames = operation.frames || [];
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [bookmarkLabel, setBookmarkLabel] = useState('');

  useEffect(() => {
    setFrameIndex(0);
    setPlaying(false);
  }, [operation.id]);

  useEffect(() => {
    if (!playing || frames.length === 0) return undefined;
    const baseIntervalMs = 500;
    const interval = setInterval(() => {
      setFrameIndex((prev) => {
        if (prev >= frames.length - 1) {
          setPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, Math.max(30, baseIntervalMs / speed));
    return () => clearInterval(interval);
  }, [playing, speed, frames.length]);

  const currentFrame = frames[frameIndex] || { units: [] };

  const addBookmark = () => {
    if (!bookmarkLabel.trim()) return;
    api
      .addAARBookmark(operation.id, { label: bookmarkLabel, timestamp: currentFrame.timestamp })
      .then(() => setBookmarkLabel(''))
      .catch(() => {
        // Non-fatal; bookmark can be retried.
      });
  };

  return (
    <div className="aar-replay">
      <div className="aar-replay-controls">
        <button onClick={() => setPlaying((p) => !p)} disabled={frames.length === 0}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <button onClick={() => setPlaying(false)} disabled={frames.length === 0}>
          Stop
        </button>
        <button onClick={() => setFrameIndex((i) => Math.max(0, i - 1))} disabled={frameIndex === 0}>
          « Step
        </button>
        <button
          onClick={() => setFrameIndex((i) => Math.min(frames.length - 1, i + 1))}
          disabled={frameIndex >= frames.length - 1}
        >
          Step »
        </button>
        <label>
          Speed
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {REPLAY_SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}x
              </option>
            ))}
          </select>
        </label>
      </div>

      <input
        type="range"
        min={0}
        max={Math.max(0, frames.length - 1)}
        value={frameIndex}
        onChange={(e) => setFrameIndex(Number(e.target.value))}
        disabled={frames.length === 0}
        aria-label="Replay scrubber"
      />
      <p>
        Frame {frames.length === 0 ? 0 : frameIndex + 1} of {frames.length}
        {currentFrame.timestamp ? ` — ${currentFrame.timestamp}` : ''}
      </p>

      <table className="simulation-unit-table">
        <thead>
          <tr>
            <th>Unit</th>
            <th>Side</th>
            <th>Strength</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {currentFrame.units.map((unit) => (
            <tr key={unit.id} className={unit.status === 'destroyed' ? 'unit-destroyed' : ''}>
              <td>{unit.name || unit.id}</td>
              <td>{unit.side}</td>
              <td>
                {unit.strength}/{unit.maxStrength}
              </td>
              <td>{unit.status}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="aar-bookmark-controls">
        <input
          type="text"
          placeholder="Bookmark label"
          value={bookmarkLabel}
          onChange={(e) => setBookmarkLabel(e.target.value)}
        />
        <button onClick={addBookmark}>Add Bookmark</button>
      </div>

      <ul className="aar-bookmark-list">
        {(operation.bookmarks || []).map((bookmark) => (
          <li key={bookmark.id}>
            <strong>{bookmark.label}</strong> — {bookmark.timestamp}
            {bookmark.note ? `: ${bookmark.note}` : ''}
          </li>
        ))}
        {(operation.bookmarks || []).length === 0 && <li>No bookmarks yet.</li>}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Performance Analytics                                                */
/* ------------------------------------------------------------------ */

function PerformanceAnalyticsTab({ operationId }) {
  const [analytics, setAnalytics] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getAARAnalytics(operationId)
      .then((res) => {
        if (!cancelled) setAnalytics(res.analytics);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [operationId]);

  if (error) return <p className="aar-panel-error">{error}</p>;
  if (!analytics) return <p>Loading analytics…</p>;

  return (
    <div className="aar-analytics">
      <div className="kpi-card-row">
        <div className="kpi-card">
          <span className="kpi-card-label">Friendly Casualties</span>
          <span className="kpi-card-value">{analytics.forceMetrics.friendly.casualties}</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-card-label">Enemy Casualties</span>
          <span className="kpi-card-value">{analytics.forceMetrics.enemy.casualties}</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-card-label">Exchange Ratio</span>
          <span className="kpi-card-value">{analytics.forceMetrics.exchangeRatio}</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-card-label">Commander Score</span>
          <span className="kpi-card-value">{analytics.commanderEffectiveness.friendly.overallScore}</span>
        </div>
      </div>

      <h4>Unit Performance Rankings</h4>
      <table className="simulation-unit-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Unit</th>
            <th>Side</th>
            <th>Casualties</th>
            <th>Engagements</th>
            <th>Effectiveness</th>
          </tr>
        </thead>
        <tbody>
          {analytics.rankings.map((unit) => (
            <tr key={unit.unitId}>
              <td>{unit.rank}</td>
              <td>{unit.name}</td>
              <td>{unit.side}</td>
              <td>{unit.casualties}</td>
              <td>{unit.engagementCount}</td>
              <td>{unit.effectiveness}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Lessons Learned                                                      */
/* ------------------------------------------------------------------ */

function LessonsLearnedTab({ operationId }) {
  const [lessons, setLessons] = useState([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState(null);

  const load = useCallback(
    (q) => {
      api
        .getAARLessons(operationId, q)
        .then((res) => setLessons(res.lessons || []))
        .catch((err) => setError(err.message));
    },
    [operationId]
  );

  useEffect(() => {
    load();
  }, [load]);

  const grouped = useMemo(() => {
    const map = {};
    for (const lesson of lessons) {
      if (!map[lesson.category]) map[lesson.category] = [];
      map[lesson.category].push(lesson);
    }
    return map;
  }, [lessons]);

  if (error) return <p className="aar-panel-error">{error}</p>;

  return (
    <div className="aar-lessons">
      <div className="aar-lessons-search">
        <input
          type="text"
          placeholder="Search lessons…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') load(query);
          }}
        />
        <button onClick={() => load(query)}>Search</button>
      </div>

      {Object.entries(grouped).map(([category, items]) => (
        <div key={category} className="aar-lessons-category">
          <h4>{category.replace(/_/g, ' ')}</h4>
          <ul>
            {items.map((lesson) => (
              <li key={lesson.id} className={`aar-lesson-severity-${lesson.severity}`}>
                <strong>{lesson.title}</strong>: {lesson.detail}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {lessons.length === 0 && <p>No lessons found.</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Historical Comparison                                                */
/* ------------------------------------------------------------------ */

function HistoricalComparisonTab({ operationId, operations }) {
  const [compareWith, setCompareWith] = useState('');
  const [comparison, setComparison] = useState(null);
  const [error, setError] = useState(null);

  const runComparison = () => {
    if (!compareWith) return;
    api
      .getAARComparison(operationId, compareWith)
      .then((res) => setComparison(res.comparison))
      .catch((err) => setError(err.message));
  };

  const otherOperations = operations.filter((op) => op.id !== operationId);

  return (
    <div className="aar-comparison">
      <div className="aar-comparison-controls">
        <select value={compareWith} onChange={(e) => setCompareWith(e.target.value)}>
          <option value="">Compare with…</option>
          {otherOperations.map((op) => (
            <option key={op.id} value={op.id}>
              {op.name}
            </option>
          ))}
        </select>
        <button onClick={runComparison} disabled={!compareWith}>
          Compare
        </button>
      </div>

      {error && <p className="aar-panel-error">{error}</p>}

      {comparison && (
        <div>
          <p>Similarity Score: {comparison.similarityScore}%</p>
          <table className="simulation-unit-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th>Delta</th>
                <th>Trend</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(comparison.metricsDiff).map(([key, value]) => (
                <tr key={key}>
                  <td>{key}</td>
                  <td>{value}</td>
                  <td>{comparison.trends[key] || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Training Module                                                      */
/* ------------------------------------------------------------------ */

function TrainingModuleTab({ operationId }) {
  const [difficulty, setDifficulty] = useState('moderate');
  const [scenario, setScenario] = useState(null);
  const [error, setError] = useState(null);

  const generate = () => {
    api
      .generateAARTraining(operationId, difficulty)
      .then((res) => setScenario(res.scenario))
      .catch((err) => setError(err.message));
  };

  return (
    <div className="aar-training">
      <div className="aar-training-controls">
        <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
          <option value="easy">Easy</option>
          <option value="moderate">Moderate</option>
          <option value="hard">Hard</option>
          <option value="extreme">Extreme</option>
        </select>
        <button onClick={generate}>Generate Scenario</button>
        <button disabled={!scenario}>Launch Scenario</button>
      </div>

      {error && <p className="aar-panel-error">{error}</p>}

      {scenario && (
        <div>
          <h4>{scenario.name}</h4>
          <p>Difficulty: {scenario.difficulty}</p>
          <h5>Objectives</h5>
          <ul>
            {scenario.objectives.map((objective, index) => (
              <li key={index}>{objective}</li>
            ))}
          </ul>
          <p>{scenario.initialUnits.length} unit(s) seeded from source operation.</p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Reports                                                              */
/* ------------------------------------------------------------------ */

function ReportsTab({ operationId }) {
  const [error, setError] = useState(null);
  const [downloading, setDownloading] = useState(false);

  const download = (format) => {
    setDownloading(true);
    api
      .exportAARReport(operationId, format)
      .then(({ body, contentType }) => {
        const blob = new Blob([body], { type: contentType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `aar-${operationId}.${format}`;
        link.click();
        URL.revokeObjectURL(url);
      })
      .catch((err) => setError(err.message))
      .finally(() => setDownloading(false));
  };

  return (
    <div className="aar-reports">
      {error && <p className="aar-panel-error">{error}</p>}
      <button disabled={downloading} onClick={() => download('json')}>
        Export JSON
      </button>
      <button disabled={downloading} onClick={() => download('csv')}>
        Export CSV
      </button>
      <button disabled={downloading} onClick={() => download('html')}>
        Export HTML
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* AI Analysis                                                         */
/* ------------------------------------------------------------------ */

function AIAnalysisTab({ operationId }) {
  const [analysis, setAnalysis] = useState(null);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api
      .getAARAIStatus()
      .then(setStatus)
      .catch(() => {
        // Status is informational only; ignore failures.
      });
  }, []);

  const generate = (forceRefresh = false) => {
    setLoading(true);
    api
      .getAARAIAnalysis(operationId, forceRefresh)
      .then((res) => {
        setAnalysis(res.analysis);
        setStatus(res.status);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  return (
    <div className="aar-ai-analysis">
      {status && (
        <p>
          Claude: {status.claudeAvailable ? 'Available' : 'Offline (rule-based fallback)'} · GPT-4:{' '}
          {status.gpt4Available ? 'Available' : 'Offline (rule-based fallback)'}
        </p>
      )}
      <button onClick={() => generate(false)} disabled={loading}>
        Generate AI Analysis
      </button>
      <button onClick={() => generate(true)} disabled={loading}>
        Regenerate
      </button>

      {error && <p className="aar-panel-error">{error}</p>}

      {analysis && (
        <div>
          <h4>Claude — Narrative &amp; Lessons</h4>
          <p>{analysis.claude?.narrative}</p>
          <h4>GPT-4 — Threat Assessment</h4>
          <p>{analysis.gpt4?.assessment}</p>
        </div>
      )}
    </div>
  );
}
