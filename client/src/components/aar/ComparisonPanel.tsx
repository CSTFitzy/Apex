import { useState } from 'react';
import type { ComparisonResult, OperationSummary } from '../../types';
import { compareOperations } from '../../api/aar';

interface Props {
  operations: OperationSummary[];
}

/** Side-by-side historical comparison of past operations, with trend and similarity analysis. */
export default function ComparisonPanel({ operations }: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [error, setError] = useState('');

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  };

  const runComparison = async () => {
    setError('');
    if (selectedIds.length < 2) {
      setError('Select at least two operations to compare.');
      return;
    }
    try {
      const data = await compareOperations(selectedIds);
      setResult(data);
    } catch {
      setError('Failed to compare operations.');
    }
  };

  return (
    <div className="aar-comparison">
      <h3>Select Operations to Compare</h3>
      <ul className="operation-select-list">
        {operations.map((op) => (
          <li key={op.id}>
            <label>
              <input type="checkbox" checked={selectedIds.includes(op.id)} onChange={() => toggleSelect(op.id)} />
              {op.name} — {new Date(op.startedAt).toLocaleString()}
            </label>
          </li>
        ))}
      </ul>
      <button className="action-btn" onClick={runComparison}>
        Compare Selected
      </button>
      {error && <p className="hint-text">{error}</p>}

      {result && (
        <>
          <h3>Metrics</h3>
          <table>
            <thead>
              <tr>
                <th>Operation</th>
                <th>Duration (min)</th>
                <th>Casualties</th>
                <th>Objectives</th>
                <th>Success Rating</th>
              </tr>
            </thead>
            <tbody>
              {result.metrics.map((m) => (
                <tr key={m.id}>
                  <td>{m.name}</td>
                  <td>{Math.round(m.durationMs / 60000)}</td>
                  <td>{m.casualties}</td>
                  <td>{m.objectivesAchieved}</td>
                  <td>{m.successRating}/100</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>Trend Analysis</h3>
          <ul>
            {result.trend.map((t, i) => (
              <li key={i}>
                {t.direction === 'improving' ? '📈' : t.direction === 'worsening' ? '📉' : '➡️'} {t.detail}
              </li>
            ))}
          </ul>

          <p>
            <strong>Similarity Score:</strong> {result.similarityScorePct}% (higher means these operations occurred
            under similar conditions)
          </p>
        </>
      )}
    </div>
  );
}
