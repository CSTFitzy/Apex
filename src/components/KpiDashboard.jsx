import React from 'react';

/**
 * A single KPI stat card.
 */
function KpiCard({ label, value, tone }) {
  return (
    <div className={`kpi-card${tone ? ` kpi-card--${tone}` : ''}`}>
      <span className="kpi-card__label">{label}</span>
      <span className="kpi-card__value">{value}</span>
    </div>
  );
}

/**
 * Real-time KPI dashboard summarizing the live simulation: force strength,
 * losses, kill ratio, engagement counts, and operational readiness.
 */
export default function KpiDashboard({ kpis }) {
  if (!kpis) {
    return <div className="kpi-dashboard kpi-dashboard--empty">Waiting for live data…</div>;
  }

  return (
    <div className="kpi-dashboard" data-testid="kpi-dashboard">
      <KpiCard label="Friendly Active" value={kpis.friendlyActive} tone="friendly" />
      <KpiCard label="Hostile Active" value={kpis.hostileActive} tone="hostile" />
      <KpiCard label="Friendly Losses" value={kpis.friendlyLosses} tone="danger" />
      <KpiCard label="Hostile Losses" value={kpis.hostileLosses} tone="success" />
      <KpiCard label="Kill Ratio" value={kpis.killRatio} />
      <KpiCard label="Engagements" value={kpis.engagementsTotal} />
      <KpiCard label="Operational Readiness" value={`${kpis.operationalReadiness}%`} />
      <KpiCard label="Friendly Avg Health" value={`${kpis.friendlyAvgHealth}%`} />
      <KpiCard label="Hostile Avg Health" value={`${kpis.hostileAvgHealth}%`} />
    </div>
  );
}
