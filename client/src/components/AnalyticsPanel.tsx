import { useEffect, useState } from 'react';
import api from '../api/client';
import type { AnalyticsEvent, BDAReport, HeatmapType, KPIReport, MissionObjective, TacticalUnit } from '../types';

interface Props {
  units: TacticalUnit[];
  events: AnalyticsEvent[];
  missionStartTime: number | null;
  objectives?: MissionObjective[];
  activeHeatmap: HeatmapType | null;
  onHeatmapChange: (type: HeatmapType | null) => void;
}

const REFRESH_OPTIONS = [
  { label: '1s', ms: 1000 },
  { label: '5s', ms: 5000 },
  { label: '10s', ms: 10000 },
  { label: '30s', ms: 30000 },
];

const HEATMAP_OPTIONS: { type: HeatmapType; label: string }[] = [
  { type: 'casualty', label: 'Casualty Density' },
  { type: 'enemy_contact', label: 'Enemy Contact' },
  { type: 'engagement', label: 'Engagement Intensity' },
  { type: 'fire_support', label: 'Fire Support' },
  { type: 'risk', label: 'Risk Assessment' },
  { type: 'supply_vulnerability', label: 'Supply Vulnerability' },
  { type: 'comms_blackout', label: 'Comms Blackout' },
];

const readinessColor: Record<string, string> = {
  READY: '#2ecc71',
  DEGRADED: '#f1c40f',
  COMBAT_INEFFECTIVE: '#e74c3c',
};

const threatColor: Record<string, string> = {
  MINIMAL: '#2ecc71',
  LOW: '#2ecc71',
  MODERATE: '#f1c40f',
  HIGH: '#e74c3c',
  CRITICAL: '#e74c3c',
};

function kpiCard(label: string, value: string, color: string) {
  return (
    <div className="kpi-card" key={label}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

/**
 * Analytics tab: KPI summary cards, live Battle Damage Assessment summary,
 * and the tactical heatmap selector — the client-side counterpart to
 * Grafana's live tactical dashboards, computed by the `/api/analytics/*`
 * engine on the server. Post-operation after-action reporting is handled
 * separately (not part of this panel).
 */
export default function AnalyticsPanel({
  units,
  events,
  missionStartTime,
  objectives = [],
  activeHeatmap,
  onHeatmapChange,
}: Props) {
  const [kpis, setKpis] = useState<KPIReport | null>(null);
  const [bda, setBda] = useState<BDAReport | null>(null);
  const [refreshMs, setRefreshMs] = useState(5000);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchAnalytics = async () => {
      try {
        const body = { units, events, missionStartTime: missionStartTime ?? undefined, objectives };
        const [kpiRes, bdaRes] = await Promise.all([
          api.post<KPIReport>('/analytics/kpis', body),
          api.post<BDAReport>('/analytics/bda', body),
        ]);
        if (!cancelled) {
          setKpis(kpiRes.data);
          setBda(bdaRes.data);
          setError(null);
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) setError('Failed to refresh analytics.');
      }
    };
    fetchAnalytics();
    const interval = setInterval(fetchAnalytics, refreshMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units, events, missionStartTime, refreshMs]);

  return (
    <div className="analytics-panel">
      <h2>Analytics Dashboard</h2>
      <p className="panel-subtitle">Real-time KPIs, live battle damage assessment &amp; tactical heatmaps</p>

      {error && <p className="error-text">{error}</p>}
      {units.length === 0 && <p className="hint-text">Deploy forces in the Simulation tab to populate analytics.</p>}

      <div className="analytics-controls">
        <label>
          Refresh rate:{' '}
          <select value={refreshMs} onChange={(e) => setRefreshMs(Number(e.target.value))}>
            {REFRESH_OPTIONS.map((opt) => (
              <option key={opt.ms} value={opt.ms}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {kpis && (
        <div className="kpi-section">
          <h3>KPI Summary</h3>
          <div className="kpi-grid">
            {kpiCard(
              'Friendly Strength',
              `${kpis.friendly.totalPersonnel}/${kpis.friendly.maxPersonnel} (${kpis.friendly.strengthPct}%)`,
              readinessColor[kpis.friendly.readiness]
            )}
            {kpiCard('Readiness', kpis.friendly.readiness.replace('_', ' '), readinessColor[kpis.friendly.readiness])}
            {kpiCard('Combat Effectiveness', `${kpis.friendly.combatEffectivenessPct}%`, '#00b4d8')}
            {kpiCard('Morale', `${kpis.friendly.moralePct}%`, '#00b4d8')}
            {kpiCard('Enemy Est. Strength', `${kpis.enemy.estimatedStrength}`, threatColor[kpis.enemy.threatLevel])}
            {kpiCard('Threat Level', kpis.enemy.threatLevel, threatColor[kpis.enemy.threatLevel])}
            {kpiCard(
              'Casualties (KIA/WIA/MIA)',
              `${kpis.casualties.kia}/${kpis.casualties.wia}/${kpis.casualties.mia}`,
              kpis.casualties.total > 0 ? '#e74c3c' : '#2ecc71'
            )}
            {kpiCard(
              'Casualty Rate',
              `${kpis.casualties.ratePerMinute}/min (${kpis.casualties.trend})`,
              kpis.casualties.trend === 'INCREASING' ? '#e74c3c' : '#2ecc71'
            )}
            {kpiCard('Mission Progress', `${kpis.mission.progressPct}%`, '#00b4d8')}
            {kpiCard('Elapsed Time', `${kpis.mission.elapsedMinutes} min`, '#90caf9')}
          </div>
        </div>
      )}

      {bda && (
        <div className="bda-section">
          <h3>Battle Damage Assessment</h3>
          <table>
            <thead>
              <tr>
                <th>Unit</th>
                <th>Casualties</th>
                <th>Loss %</th>
                <th>Severity</th>
                <th>Time to Ineffective</th>
              </tr>
            </thead>
            <tbody>
              {bda.perUnit.map((u) => (
                <tr key={u.unitId} className={`affiliation-${u.affiliation}`}>
                  <td>{u.unitName}</td>
                  <td>{u.casualties}</td>
                  <td>{u.lossPct}%</td>
                  <td>{u.severity}</td>
                  <td>{u.minutesToCombatIneffective !== null ? `${u.minutesToCombatIneffective} min` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="stats-empty">
            Friendly casualties inflicted on enemy: {bda.comparison.enemyDamage} | Friendly casualties sustained:{' '}
            {bda.comparison.friendlyDamage}
          </p>
        </div>
      )}

      <div className="heatmap-selector">
        <h3>Tactical Heatmaps</h3>
        <div className="heatmap-toggle-group">
          <button className={`action-btn secondary ${activeHeatmap === null ? 'active' : ''}`} onClick={() => onHeatmapChange(null)}>
            Off
          </button>
          {HEATMAP_OPTIONS.map((opt) => (
            <button
              key={opt.type}
              className={`action-btn secondary ${activeHeatmap === opt.type ? 'active' : ''}`}
              onClick={() => onHeatmapChange(opt.type)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
