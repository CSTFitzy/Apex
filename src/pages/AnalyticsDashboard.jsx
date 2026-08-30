import React, { useEffect, useMemo, useState } from 'react';
import Map from '../components/Map.jsx';
import KpiDashboard from '../components/KpiDashboard.jsx';
import BdaTable from '../components/BdaTable.jsx';
import api from '../utils/api.js';
import SharknetSocket from '../utils/websocket.js';

const HEATMAP_LABELS = {
  'all-units': 'All Units',
  'friendly-units': 'Friendly Units',
  'hostile-units': 'Hostile Units',
  engagements: 'Engagements',
  casualties: 'Casualties',
  destroyed: 'Destroyed',
  movement: 'Movement / Activity',
};

const HEATMAP_TYPES = Object.keys(HEATMAP_LABELS);

/**
 * Live tactical analytics dashboard: real-time KPIs, Battle Damage
 * Assessment (BDA) table, live simulated unit map, and a selectable set of
 * 7 tactical heatmaps — all streamed over WebSocket from the simulation
 * engine and also available via `/api/analytics/*` for polling / Grafana.
 */
export default function AnalyticsDashboard() {
  const [kpis, setKpis] = useState(null);
  const [bdaRows, setBdaRows] = useState([]);
  const [units, setUnits] = useState([]);
  const [heatmaps, setHeatmaps] = useState({});
  const [activeHeatmap, setActiveHeatmap] = useState('all-units');
  const [connected, setConnected] = useState(false);

  // Initial snapshot via REST, then keep it live over WebSocket.
  useEffect(() => {
    let cancelled = false;

    Promise.all([api.getKpis(), api.getBda(), api.getUnits(), api.getHeatmaps()])
      .then(([kpiRes, bdaRes, unitRes, heatmapRes]) => {
        if (cancelled) return;
        setKpis(kpiRes.kpis);
        setBdaRows(bdaRes.bda || []);
        setUnits(unitRes.units || []);
        setHeatmaps(heatmapRes.heatmaps || {});
      })
      .catch(() => {
        // Individual widgets degrade gracefully; live WebSocket data will
        // still populate the dashboard once connected.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const socket = new SharknetSocket();
    const token = localStorage.getItem('sharknet_token');
    socket.connect(token);
    socket.subscribe(['simulation', 'analytics']);

    const unsubOpen = socket.on('open', () => setConnected(true));
    const unsubClose = socket.on('close', () => setConnected(false));

    const unsubSimulation = socket.on('SIMULATION_UPDATE', (payload) => {
      setUnits(payload.units || []);
    });

    const unsubKpi = socket.on('KPI_UPDATE', (payload) => {
      setKpis(payload);
    });

    const unsubBda = socket.on('BDA_UPDATE', (payload) => {
      setBdaRows((prev) => [...payload, ...prev].slice(0, 200));
    });

    return () => {
      unsubOpen();
      unsubClose();
      unsubSimulation();
      unsubKpi();
      unsubBda();
      socket.disconnect();
    };
  }, []);

  // Recompute the active heatmap layer from live unit/BDA state so it stays
  // in sync between periodic REST refreshes.
  useEffect(() => {
    const interval = setInterval(() => {
      api
        .getHeatmaps()
        .then((res) => setHeatmaps(res.heatmaps || {}))
        .catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const activePoints = useMemo(() => heatmaps[activeHeatmap] || [], [heatmaps, activeHeatmap]);

  return (
    <div className="analytics-dashboard" data-testid="analytics-dashboard">
      <header className="analytics-header">
        <h2>Live Tactical Analytics</h2>
        <span className={`connection-badge connection-badge--${connected ? 'up' : 'down'}`}>
          {connected ? 'LIVE' : 'RECONNECTING'}
        </span>
      </header>

      <KpiDashboard kpis={kpis} />

      <div className="analytics-grid">
        <section className="analytics-map">
          <div className="heatmap-selector">
            {HEATMAP_TYPES.map((type) => (
              <button
                key={type}
                className={`heatmap-button${activeHeatmap === type ? ' heatmap-button--active' : ''}`}
                onClick={() => setActiveHeatmap(type)}
                type="button"
              >
                {HEATMAP_LABELS[type]}
              </button>
            ))}
          </div>
          <Map units={units} heatmapPoints={activePoints} />
        </section>

        <section className="analytics-bda">
          <h3>Battle Damage Assessment</h3>
          <BdaTable rows={bdaRows} />
        </section>
      </div>
    </div>
  );
}
