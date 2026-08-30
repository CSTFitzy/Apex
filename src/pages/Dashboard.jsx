import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Map from '../components/Map.jsx';
import WeatherWidget from '../components/WeatherWidget.jsx';
import IntelligencePanel from '../components/IntelligencePanel.jsx';
import AnalysisChart from '../components/AnalysisChart.jsx';
import SimulationPanel from '../components/SimulationPanel.jsx';
import AnalyticsPanel from '../components/AnalyticsPanel.jsx';
import CommunicationsPanel from '../components/comms/CommunicationsPanel.jsx';
import api, { setToken } from '../utils/api.js';
import SharknetSocket from '../utils/websocket.js';

const SIDEBAR_TABS = [
  { id: 'intel', label: 'Intel' },
  { id: 'simulation', label: 'Simulation' },
  { id: 'analytics', label: 'Analytics' },
];

/**
 * Main dashboard: tactical map, weather, intelligence, and analysis views.
 */
export default function Dashboard({ onLogout }) {
  const navigate = useNavigate();
  const [locations, setLocations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [sidebarTab, setSidebarTab] = useState('intel');
  const [simUnits, setSimUnits] = useState([]);
  const [simEvents, setSimEvents] = useState([]);
  const [heatmap, setHeatmap] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getTacticalLocations()
      .then((data) => {
        if (!cancelled) setLocations(data.locations || []);
      })
      .catch(() => {
        // Errors are surfaced via individual widgets; dashboard remains usable.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const socket = new SharknetSocket();
    const token = localStorage.getItem('sharknet_token');
    socket.connect(token);
    socket.subscribe(['map', 'weather', 'intelligence']);

    const unsubscribe = socket.on('MAP_UPDATE', (payload) => {
      setLocations((prev) => [...prev, payload]);
    });

    return () => {
      unsubscribe();
      socket.disconnect();
    };
  }, []);

  // Stream simulation events to the backend analytics engine and keep a
  // local copy for the AnalyticsPanel's live event stream/BDA computation.
  const handleSimEvent = useCallback((event) => {
    setSimEvents((prev) => [...prev, event].slice(-200));
    api.postAnalyticsEvent(event).catch(() => {
      // Streaming failures shouldn't interrupt the local simulation.
    });
  }, []);

  const handleLogout = () => {
    setToken(null);
    onLogout?.();
    navigate('/login');
  };

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>Sharknet</h1>
        <nav className="dashboard-tabs">
          <button
            type="button"
            className={activeTab === 'overview' ? 'tab-active' : ''}
            onClick={() => setActiveTab('overview')}
          >
            Overview
          </button>
          <button
            type="button"
            className={activeTab === 'comms' ? 'tab-active' : ''}
            onClick={() => setActiveTab('comms')}
          >
            Communications
          </button>
        </nav>
        <button onClick={handleLogout}>Log out</button>
      </header>

      <div className={activeTab === 'overview' ? 'dashboard-grid' : 'tab-hidden'}>
        <section className="dashboard-map">
          <Map locations={locations} onSelect={setSelected} heatmap={heatmap} />
        </section>

        <aside className="dashboard-sidebar">
          <nav className="dashboard-tabs">
            {SIDEBAR_TABS.map((tab) => (
              <button
                key={tab.id}
                className={sidebarTab === tab.id ? 'dashboard-tab-active' : ''}
                onClick={() => setSidebarTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <div className={sidebarTab === 'intel' ? '' : 'tab-hidden'}>
            <WeatherWidget latitude={selected?.latitude} longitude={selected?.longitude} />
            <IntelligencePanel />
          </div>

          {/* Kept mounted (via CSS) rather than unmounted so the simulation's
              interval keeps running when the user switches tabs. */}
          <div className={sidebarTab === 'simulation' ? '' : 'tab-hidden'}>
            <SimulationPanel onEvent={handleSimEvent} onUnitsChange={setSimUnits} />
          </div>

          <div className={sidebarTab === 'analytics' ? '' : 'tab-hidden'}>
            <AnalyticsPanel units={simUnits} events={simEvents} onHeatmapChange={setHeatmap} />
          </div>
        </aside>

        <section className="dashboard-analysis">
          <AnalysisChart
            title="Activity Trend"
            labels={['Mon', 'Tue', 'Wed', 'Thu', 'Fri']}
            datasets={[{ label: 'Reports', data: [3, 5, 2, 8, 4], borderColor: '#2f81f7' }]}
          />
        </section>
      </div>

      <div className={activeTab === 'comms' ? 'dashboard-comms' : 'tab-hidden'}>
        <CommunicationsPanel />
      </div>
    </div>
  );
}
