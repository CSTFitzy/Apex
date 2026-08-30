import React, { useEffect, useMemo, useRef, useState } from 'react';
import api from '../utils/api.js';
import ApexSocket from '../utils/websocket.js';

const REFRESH_INTERVAL_MS = 4000;

const HEATMAP_OPTIONS = [
  { type: 'casualty', label: 'Casualties' },
  { type: 'enemy_contact', label: 'Enemy Contact' },
  { type: 'engagement', label: 'Engagement' },
  { type: 'fire_support', label: 'Fire Support' },
  { type: 'risk', label: 'Risk' },
  { type: 'supply_vulnerability', label: 'Supply Vulnerability' },
  { type: 'comms_blackout', label: 'Comms Blackout' },
];

function KpiCard({ label, value, suffix = '' }) {
  return (
    <div className="kpi-card">
      <span className="kpi-card-label">{label}</span>
      <span className="kpi-card-value">
        {value}
        {suffix}
      </span>
    </div>
  );
}

/**
 * Live tactical analytics dashboard: auto-refreshing KPIs, a battle damage
 * assessment (BDA) table, and toggleable spatial heatmaps. Computation is
 * performed server-side (stateless) from the `units`/`events` supplied by
 * the active simulation; this panel also listens for ANALYTICS_EVENT
 * WebSocket broadcasts so the event stream updates live even if the
 * originating events came from another client.
 */
export default function AnalyticsPanel({ units = [], events = [], onHeatmapChange }) {
  const [kpis, setKpis] = useState(null);
  const [bda, setBda] = useState(null);
  const [liveEvents, setLiveEvents] = useState([]);
  const [activeHeatmap, setActiveHeatmap] = useState(null);
  const [error, setError] = useState(null);
  const eventsRef = useRef(events);
  eventsRef.current = events;

  const combinedEvents = useMemo(() => [...events, ...liveEvents], [events, liveEvents]);

  // Live event stream: append ANALYTICS_EVENT broadcasts as they arrive.
  useEffect(() => {
    const socket = new ApexSocket();
    const token = localStorage.getItem('apex_token');
    socket.connect(token);
    socket.subscribe(['analytics']);

    const unsubscribe = socket.on('ANALYTICS_EVENT', (payload) => {
      setLiveEvents((prev) => [payload, ...prev].slice(0, 50));
    });

    return () => {
      unsubscribe();
      socket.disconnect();
    };
  }, []);

  // Auto-refresh KPIs + BDA from the current unit/event state.
  useEffect(() => {
    let cancelled = false;

    const refresh = () => {
      Promise.all([api.getKPIs(units, combinedEvents), api.getBDA(units, combinedEvents)])
        .then(([kpiRes, bdaRes]) => {
          if (cancelled) return;
          setKpis(kpiRes.kpis);
          setBda(bdaRes.bda);
          setError(null);
        })
        .catch((err) => {
          if (!cancelled) setError(err.message);
        });
    };

    refresh();
    const interval = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [units, combinedEvents]);

  // Fetch the selected heatmap whenever the toggle or underlying data changes.
  useEffect(() => {
    if (!activeHeatmap) {
      onHeatmapChange?.(null);
      return;
    }
    let cancelled = false;
    api
      .getHeatmap(units, combinedEvents, activeHeatmap)
      .then((res) => {
        if (!cancelled) onHeatmapChange?.(res.heatmap);
      })
      .catch(() => {
        if (!cancelled) onHeatmapChange?.(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeHeatmap, units, combinedEvents, onHeatmapChange]);

  const toggleHeatmap = (type) => {
    setActiveHeatmap((current) => (current === type ? null : type));
  };

  return (
    <div className="analytics-panel">
      <h3>Tactical Analytics</h3>
      {error && <p className="analytics-panel-error">{error}</p>}

      <div className="kpi-grid">
        <KpiCard label="Friendly Strength" value={kpis?.friendlyStrength ?? 0} />
        <KpiCard label="Enemy Strength" value={kpis?.enemyStrength ?? 0} />
        <KpiCard label="Readiness" value={kpis?.friendlyReadiness ?? 0} suffix="%" />
        <KpiCard label="Morale" value={kpis?.friendlyMorale ?? 0} suffix="%" />
        <KpiCard label="Combat Effectiveness" value={kpis?.combatEffectiveness ?? 0} suffix="%" />
        <KpiCard label="Casualty Rate" value={kpis?.casualtyRate ?? 0} suffix="/min" />
        <KpiCard label="Casualty Trend" value={kpis?.casualtyTrend ?? 'stable'} />
        <KpiCard label="Mission Progress" value={kpis?.missionProgress ?? 0} suffix="%" />
      </div>

      <div className="bda-table-wrapper">
        <h4>Battle Damage Assessment</h4>
        <table className="bda-table">
          <thead>
            <tr>
              <th>Unit</th>
              <th>Side</th>
              <th>Casualties</th>
              <th>Loss %</th>
              <th>Severity</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(bda?.units || []).map((unit) => (
              <tr key={unit.unitId} className={`severity-${unit.severity}`}>
                <td>{unit.name}</td>
                <td>{unit.side}</td>
                <td>{unit.casualties}</td>
                <td>{unit.lossPercent}%</td>
                <td>{unit.severity}</td>
                <td>{unit.status}</td>
              </tr>
            ))}
            {(!bda || bda.units.length === 0) && (
              <tr>
                <td colSpan={6}>No units to assess.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="heatmap-toggles">
        <h4>Tactical Heatmaps</h4>
        <div className="heatmap-toggle-buttons">
          {HEATMAP_OPTIONS.map((option) => (
            <button
              key={option.type}
              className={activeHeatmap === option.type ? 'heatmap-toggle-active' : ''}
              onClick={() => toggleHeatmap(option.type)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="analytics-event-stream">
        <h4>Live Event Stream</h4>
        <ul>
          {combinedEvents.slice(0, 20).map((event, index) => (
            <li key={event.id || index}>
              <strong>{event.type}</strong> — {event.details || event.unitId}
            </li>
          ))}
          {combinedEvents.length === 0 && <li>No events yet.</li>}
        </ul>
      </div>
    </div>
  );
}
