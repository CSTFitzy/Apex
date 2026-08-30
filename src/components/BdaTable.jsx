import React from 'react';

/**
 * Battle Damage Assessment (BDA) table: live feed of combat engagement
 * outcomes (target, attacker, damage type/confidence, location).
 */
export default function BdaTable({ rows = [], limit = 25 }) {
  const visible = rows.slice(0, limit);

  return (
    <div className="bda-table" data-testid="bda-table">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Target</th>
            <th>Attacker</th>
            <th>Damage</th>
            <th>Confidence</th>
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 && (
            <tr>
              <td colSpan={5} className="bda-table__empty">
                No engagements recorded yet.
              </td>
            </tr>
          )}
          {visible.map((row) => (
            <tr key={row.id} className={`bda-row bda-row--${row.damageType}`}>
              <td>{new Date(row.timestamp).toLocaleTimeString()}</td>
              <td>
                {row.target} <span className="bda-side">({row.targetSide})</span>
              </td>
              <td>
                {row.attacker} <span className="bda-side">({row.attackerSide})</span>
              </td>
              <td>
                {row.damageType} ({row.damagePercent}%)
              </td>
              <td>{row.confidence}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
