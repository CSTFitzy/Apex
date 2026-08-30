import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Map from '../components/Map.jsx';
import WeatherWidget from '../components/WeatherWidget.jsx';
import IntelligencePanel from '../components/IntelligencePanel.jsx';
import AnalysisChart from '../components/AnalysisChart.jsx';
import CommunicationsPanel from '../components/comms/CommunicationsPanel.jsx';
import api, { setToken } from '../utils/api.js';
import SharknetSocket from '../utils/websocket.js';

/**
 * Main dashboard: tactical map, weather, intelligence, and analysis views.
 */
export default function Dashboard({ onLogout }) {
  const navigate = useNavigate();
  const [locations, setLocations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');

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
          <Map locations={locations} onSelect={setSelected} />
        </section>

        <aside className="dashboard-sidebar">
          <WeatherWidget latitude={selected?.latitude} longitude={selected?.longitude} />
          <IntelligencePanel />
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
