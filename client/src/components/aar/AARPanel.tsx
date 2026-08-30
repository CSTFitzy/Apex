import { useCallback, useEffect, useState } from 'react';
import type { Operation, OperationSummary, PerformanceAnalytics } from '../../types';
import { getAnalytics, getOperation, listOperations } from '../../api/aar';
import ReplayPlayer from './ReplayPlayer';
import PerformanceAnalyticsPanel from './PerformanceAnalyticsPanel';
import LessonsLearnedPanel from './LessonsLearnedPanel';
import ComparisonPanel from './ComparisonPanel';
import TrainingModulePanel from './TrainingModulePanel';
import ReportExportPanel from './ReportExportPanel';

type SubTab = 'replay' | 'analytics' | 'lessons' | 'compare' | 'training' | 'reports';

interface Props {
  /** Operation id most recently recorded by the live simulation, auto-selected when it changes. */
  latestOperationId?: string | null;
}

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'replay', label: 'Tactical Replay' },
  { id: 'analytics', label: 'Performance Analytics' },
  { id: 'lessons', label: 'Lessons Learned' },
  { id: 'compare', label: 'Historical Comparison' },
  { id: 'training', label: 'Training Module' },
  { id: 'reports', label: 'Reports' },
];

/** After-Action Review: replay, performance analytics, AI lessons learned, comparison, training & reports. */
export default function AARPanel({ latestOperationId }: Props) {
  const [operations, setOperations] = useState<OperationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [analytics, setAnalytics] = useState<PerformanceAnalytics | null>(null);
  const [subTab, setSubTab] = useState<SubTab>('replay');
  const [error, setError] = useState('');

  const refreshOperations = useCallback(async () => {
    try {
      const data = await listOperations();
      setOperations(data);
    } catch {
      setError('Failed to load operations. Is the Apex server running?');
    }
  }, []);

  useEffect(() => {
    refreshOperations();
  }, [refreshOperations]);

  useEffect(() => {
    if (latestOperationId) setSelectedId(latestOperationId);
  }, [latestOperationId]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    Promise.all([getOperation(selectedId), getAnalytics(selectedId)])
      .then(([op, an]) => {
        if (!cancelled) {
          setOperation(op);
          setAnalytics(an);
        }
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load operation details.');
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  return (
    <div className="aar-panel">
      <h2>After-Action Review</h2>
      <p className="panel-subtitle">Tactical replay, performance analytics, AI lessons learned &amp; reports</p>

      <div className="aar-operation-select">
        <label>
          Operation:{' '}
          <select value={selectedId ?? ''} onChange={(e) => setSelectedId(e.target.value || null)}>
            <option value="">-- Select an operation --</option>
            {operations.map((op) => (
              <option key={op.id} value={op.id}>
                {op.name} ({new Date(op.startedAt).toLocaleString()})
              </option>
            ))}
          </select>
        </label>
        <button className="action-btn" onClick={refreshOperations}>
          🔄 Refresh
        </button>
      </div>
      {error && <p className="hint-text">{error}</p>}
      {operations.length === 0 && !error && (
        <p className="hint-text">
          No operations recorded yet. Run the Simulation panel and press "Deploy Forces" to start recording one.
        </p>
      )}

      {selectedId && (
        <>
          <div className="aar-subtab-nav">
            {SUB_TABS.map((t) => (
              <button
                key={t.id}
                className={`nav-btn ${subTab === t.id ? 'active' : ''}`}
                onClick={() => setSubTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {subTab === 'replay' && operation && <ReplayPlayer operation={operation} />}
          {subTab === 'analytics' && analytics && <PerformanceAnalyticsPanel analytics={analytics} />}
          {subTab === 'lessons' && <LessonsLearnedPanel operationId={selectedId} />}
          {subTab === 'compare' && <ComparisonPanel operations={operations} />}
          {subTab === 'training' && <TrainingModulePanel operationId={selectedId} />}
          {subTab === 'reports' && <ReportExportPanel operationId={selectedId} />}
        </>
      )}
    </div>
  );
}
