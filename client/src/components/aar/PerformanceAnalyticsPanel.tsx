import type { PerformanceAnalytics } from '../../types';

interface Props {
  analytics: PerformanceAnalytics;
}

function rankLabel(unitId: string, ranking: string[]): string | null {
  const idx = ranking.indexOf(unitId);
  return idx === 0 ? '🏆 #1' : idx >= 0 ? `#${idx + 1}` : null;
}

/** Per-unit performance stats, comparative rankings, and commander effectiveness scoring. */
export default function PerformanceAnalyticsPanel({ analytics }: Props) {
  const { units, rankings, commanderEffectiveness } = analytics;

  return (
    <div className="aar-analytics">
      <h3>Commander Effectiveness</h3>
      <div className="commander-score-grid">
        <div className="score-item">
          <span>Tactical Decision Quality</span>
          <strong>{commanderEffectiveness.tacticalDecisionQualityScore}/100</strong>
        </div>
        <div className="score-item">
          <span>Supply Management</span>
          <strong>{commanderEffectiveness.supplyManagementScore}/100</strong>
        </div>
        <div className="score-item">
          <span>Combat Effectiveness</span>
          <strong>{commanderEffectiveness.combatEffectivenessScore}/100</strong>
        </div>
        <div className="score-item">
          <span>Overall</span>
          <strong>{commanderEffectiveness.overallScore}/100</strong>
        </div>
      </div>

      <h3>Per-Unit Performance</h3>
      <table>
        <thead>
          <tr>
            <th>Unit</th>
            <th>Affiliation</th>
            <th>Casualties</th>
            <th>Damage Dealt</th>
            <th>Effectiveness</th>
            <th>Survived</th>
            <th>Rankings</th>
          </tr>
        </thead>
        <tbody>
          {units.map((u) => (
            <tr key={u.unitId} className={`affiliation-${u.affiliation}`}>
              <td>{u.unitName}</td>
              <td>{u.affiliation}</td>
              <td>{u.casualties}</td>
              <td>{u.damageDealt}</td>
              <td>{u.combatEffectivenessScore}/100</td>
              <td>{u.survived ? 'Yes' : 'No'}</td>
              <td>
                {[
                  rankLabel(u.unitId, rankings.mostDamageDealt) && `Damage ${rankLabel(u.unitId, rankings.mostDamageDealt)}`,
                  rankLabel(u.unitId, rankings.bestSurvivalRate) && `Survival ${rankLabel(u.unitId, rankings.bestSurvivalRate)}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
