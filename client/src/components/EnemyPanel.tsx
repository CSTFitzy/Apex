import { useState } from 'react';
import api from '../api/client';
import type { CounterPlanResult, DocumentUploadResult, FriendlyForce } from '../types';

interface Props {
  docResult: DocumentUploadResult | null;
  terrainSummary: string;
  onCounterPlan: (result: CounterPlanResult) => void;
}

const threatColor: Record<string, string> = {
  LOW: '#2ecc71',
  MODERATE: '#f1c40f',
  HIGH: '#e67e22',
  CRITICAL: '#e74c3c',
};

export default function EnemyPanel({ docResult, terrainSummary, onCounterPlan }: Props) {
  const [friendlyForces, setFriendlyForces] = useState<FriendlyForce[]>([
    { name: 'Alpha Company', composition: 'Light infantry', strength: 100 },
  ]);
  const [result, setResult] = useState<CounterPlanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enemyText = docResult
    ? [...docResult.extraction.enemyMentions, docResult.rawTextPreview].join(' ')
    : '';

  const updateForce = (idx: number, field: keyof FriendlyForce, value: string) => {
    setFriendlyForces((prev) =>
      prev.map((f, i) =>
        i === idx
          ? { ...f, [field]: field === 'strength' ? Number(value) || 0 : value }
          : f
      )
    );
  };

  const addForce = () => {
    setFriendlyForces((prev) => [...prev, { name: '', composition: '', strength: 0 }]);
  };

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post<CounterPlanResult>('/enemy/counter-plan', {
        enemyText,
        friendlyForces,
        terrainSummary,
      });
      setResult(data);
      onCounterPlan(data);
    } catch (err) {
      console.error(err);
      setError('Failed to generate counter-plan.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="enemy-panel">
      <h2>Enemy Force Planning &amp; Analysis Engine</h2>
      <p className="panel-subtitle">
        Draws on a simulated ODIN-style doctrine database, NATO doctrine, and OSINT-style patterns.
      </p>

      <div className="friendly-forces-input">
        <h3>Friendly Force Disposition</h3>
        {friendlyForces.map((force, idx) => (
          <div key={idx} className="force-row">
            <input
              placeholder="Unit name"
              value={force.name}
              onChange={(e) => updateForce(idx, 'name', e.target.value)}
            />
            <input
              placeholder="Composition"
              value={force.composition}
              onChange={(e) => updateForce(idx, 'composition', e.target.value)}
            />
            <input
              placeholder="Strength"
              type="number"
              value={force.strength ?? 0}
              onChange={(e) => updateForce(idx, 'strength', e.target.value)}
            />
          </div>
        ))}
        <button className="action-btn secondary" onClick={addForce}>
          + Add Unit
        </button>
      </div>

      <button className="action-btn" onClick={generate} disabled={loading}>
        {loading ? 'Analyzing...' : 'Generate Enemy Counter-Plan'}
      </button>
      {error && <p className="error-text">{error}</p>}
      {!docResult && <p className="hint-text">Upload an orders document first for a richer enemy analysis.</p>}

      {result && (
        <div className="counter-plan-results">
          <div className="threat-assessment" style={{ borderLeftColor: threatColor[result.threatAssessment.level] }}>
            <h3>Threat Assessment: {result.threatAssessment.level}</h3>
            <p>Estimated probability of friendly success: {result.threatAssessment.probabilityOfSuccessPct}%</p>
            <ul>
              {result.threatAssessment.rationale.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>

          <div className="matched-doctrine">
            <h3>Identified Enemy Doctrine</h3>
            {result.matchedDoctrine.map((d) => (
              <div key={d.id} className="doctrine-card">
                <h4>{d.name}</h4>
                <p>{d.composition}</p>
                <p><strong>Likely tactics:</strong> {d.tactics.join('; ')}</p>
              </div>
            ))}
            {result.matchedDoctrine.length === 0 && <p>No specific doctrine matched from available intelligence.</p>}
          </div>

          <div className="counter-plan-narrative">
            <h3>Recommended Counter-Plan</h3>
            <p>{result.counterPlan.narrative}</p>
            <ul>
              {result.counterPlan.recommendedActions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
