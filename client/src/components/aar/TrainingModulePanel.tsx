import { useState } from 'react';
import type { TrainingScenario } from '../../types';
import { generateTrainingScenario } from '../../api/aar';

interface Props {
  operationId: string;
}

/** Generates a replayable training scenario from a past operation, with adjustable difficulty. */
export default function TrainingModulePanel({ operationId }: Props) {
  const [difficulty, setDifficulty] = useState<TrainingScenario['difficulty']>('medium');
  const [scenario, setScenario] = useState<TrainingScenario | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    setLoading(true);
    try {
      const result = await generateTrainingScenario(operationId, difficulty);
      setScenario(result);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="aar-training">
      <label>
        Difficulty:{' '}
        <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as TrainingScenario['difficulty'])}>
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </select>
      </label>
      <button className="action-btn" onClick={generate} disabled={loading}>
        {loading ? 'Generating...' : '🎓 Generate Training Scenario'}
      </button>

      {scenario && (
        <div className="training-scenario-result">
          <h3>{scenario.name}</h3>
          <h4>Focus Areas</h4>
          <ul>
            {scenario.focusAreas.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
          <h4>Scoring Targets (beat historical commander performance)</h4>
          <table>
            <thead>
              <tr>
                <th>Unit</th>
                <th>Historical Combat Effectiveness Score</th>
              </tr>
            </thead>
            <tbody>
              {scenario.scoringTargets.map((t) => (
                <tr key={t.unitId}>
                  <td>{t.unitName}</td>
                  <td>{t.historicalCombatEffectivenessScore}/100</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint-text">
            {scenario.initialUnits.length} unit(s) seeded from the source operation, with enemy strength adjusted for{' '}
            {scenario.difficulty} difficulty.
          </p>
        </div>
      )}
    </div>
  );
}
