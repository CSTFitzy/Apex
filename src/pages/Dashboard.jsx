import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Map from '../components/Map.jsx';
import WeatherWidget from '../components/WeatherWidget.jsx';
import AOOPanel from '../components/AOOPanel.jsx';
import IntelligencePanel from '../components/IntelligencePanel.jsx';
import AnalysisChart from '../components/AnalysisChart.jsx';
import SimulationPanel from '../components/SimulationPanel.jsx';
import AnalyticsPanel from '../components/AnalyticsPanel.jsx';
import CommunicationsPanel from '../components/comms/CommunicationsPanel.jsx';
import SupplyPanel from '../components/SupplyPanel.jsx';
import LogisticsMap from '../components/LogisticsMap.jsx';
import AARPanel from '../components/AARPanel.jsx';
import UnitSymbols from '../components/UnitSymbols.jsx';
import UnitsPanel from '../components/UnitsPanel.jsx';
import MarkupTools, { DEFAULT_LAYERS } from '../components/MarkupTools.jsx';
import DocumentUpload from '../components/DocumentUpload.jsx';
import COAAnalysisPanel from '../components/COAAnalysisPanel.jsx';
import useSupplyData from '../hooks/useSupplyData.js';
import api, { setToken } from '../utils/api.js';
import ApexSocket from '../utils/websocket.js';
import { AUTH_DISABLED } from '../utils/auth.js';

const SIDEBAR_TABS = [
  { id: 'aoo', label: 'AOO' },
  { id: 'intel', label: 'Intel' },
  { id: 'simulation', label: 'Simulation' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'supply', label: 'Supply' },
  { id: 'coas', label: 'COAs' },
];

/**
 * Main dashboard: tactical map, weather, intelligence, and analysis views.
 */
export default function Dashboard({ onLogout }) {
  const navigate = useNavigate();
  const [locations, setLocations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [sidebarTab, setSidebarTab] = useState('aoo');
  const [aooRadiusKm, setAooRadiusKm] = useState(5);
  const [simUnits, setSimUnits] = useState([]);
  const [simEvents, setSimEvents] = useState([]);
  const [heatmap, setHeatmap] = useState(null);
  const [units, setUnits] = useState([]);
  const [unitTemplate, setUnitTemplate] = useState(null);
  const [selectedUnitId, setSelectedUnitId] = useState(null);
  const [markups, setMarkups] = useState([]);
  const [layers, setLayers] = useState(DEFAULT_LAYERS);
  const [activeTool, setActiveTool] = useState('select');
  const [activeLayerId, setActiveLayerId] = useState(DEFAULT_LAYERS[0].id);
  const [markupStyle, setMarkupStyle] = useState({ color: '#f2cc60', weight: 3 });
  const [draftPointCount, setDraftPointCount] = useState(0);
  const [finishDrawingSignal, setFinishDrawingSignal] = useState(0);
  const [tacticalStatus, setTacticalStatus] = useState('');
  const [documents, setDocuments] = useState([]);
  const [coas, setCoas] = useState([]);
  const [selectedCOAId, setSelectedCOAId] = useState(null);
  const [counterPlan, setCounterPlan] = useState(null);
  const [opord, setOpord] = useState(null);
  const [coaOverlays, setCoaOverlays] = useState([]);
  const supply = useSupplyData();
  const scenarioId = selected
    ? `aoo-${selected.latitude.toFixed(4)}-${selected.longitude.toFixed(4)}`
    : 'default';

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
    let cancelled = false;
    Promise.all([api.getTacticalUnits(scenarioId), api.getTacticalMarkups(scenarioId)])
      .then(([unitData, markupData]) => {
        if (cancelled) return;
        setUnits(unitData.units || []);
        const [latestMarkupSet] = markupData.markupSets || [];
        if (latestMarkupSet) {
          setLayers(latestMarkupSet.layers?.length ? latestMarkupSet.layers : DEFAULT_LAYERS);
          setMarkups(latestMarkupSet.markups || []);
        } else {
          setLayers(DEFAULT_LAYERS);
          setMarkups([]);
        }
      })
      .catch((err) => setTacticalStatus(err.message));
    return () => {
      cancelled = true;
    };
  }, [scenarioId]);

  useEffect(() => {
    let cancelled = false;
    api
      .getTacticalDocuments(scenarioId)
      .then((data) => {
        if (!cancelled) setDocuments(data.documents || []);
      })
      .catch((err) => setTacticalStatus(err.message));
    return () => {
      cancelled = true;
    };
  }, [scenarioId]);

  useEffect(() => {
    const socket = new ApexSocket();
    const token = localStorage.getItem('apex_token');
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

  const saveUnit = useCallback(
    async (unit) => {
      const data = await api.saveTacticalUnit({ ...unit, scenarioId });
      setUnits((current) => {
        const saved = data.units[0];
        const others = current.filter((candidate) => candidate.id !== saved.id);
        return [...others, saved];
      });
      return data.units[0];
    },
    [scenarioId]
  );

  const handleUnitPlace = useCallback(
    async (position) => {
      try {
        const saved = await saveUnit({
          ...(unitTemplate || {
            name: 'New Unit',
            type: 'infantry',
            affiliation: 'friendly',
            hierarchy: 'squad',
            readiness: 'full',
            strength: 9,
          }),
          position,
        });
        setSelectedUnitId(saved.id);
        setActiveTool('select');
        setTacticalStatus(`${saved.name} placed`);
      } catch (err) {
        setTacticalStatus(err.message);
      }
    },
    [saveUnit, unitTemplate]
  );

  const handleUnitUpdate = useCallback(
    async (unit) => {
      setUnits((current) => current.map((candidate) => (candidate.id === unit.id ? unit : candidate)));
      try {
        await saveUnit(unit);
      } catch (err) {
        setTacticalStatus(err.message);
      }
    },
    [saveUnit]
  );

  const handleUnitDelete = useCallback(async (unitId) => {
    setUnits((current) => current.filter((unit) => unit.id !== unitId));
    if (selectedUnitId === unitId) setSelectedUnitId(null);
    try {
      await api.deleteTacticalUnit(unitId);
    } catch (err) {
      setTacticalStatus(err.message);
    }
  }, [selectedUnitId]);

  const handleCreateMarkup = useCallback((markup) => {
    const id = crypto.randomUUID ? crypto.randomUUID() : `markup-${Date.now()}`;
    setMarkups((current) => [...current, { id, ...markup }]);
  }, []);

  const handleSaveMarkups = useCallback(async () => {
    try {
      await api.saveTacticalMarkups({ scenarioId, name: `Scenario ${scenarioId}`, layers, markups });
      setTacticalStatus('Markup set saved');
    } catch (err) {
      setTacticalStatus(err.message);
    }
  }, [layers, markups, scenarioId]);

  const handleExportMarkups = useCallback(async () => {
    try {
      await api.saveTacticalMarkups({ scenarioId, name: `Scenario ${scenarioId}`, layers, markups });
      const { body } = await api.exportTacticalMarkups(scenarioId);
      const blob = new Blob([body], { type: 'application/geo+json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${scenarioId}-markups.geojson`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setTacticalStatus(err.message);
    }
  }, [layers, markups, scenarioId]);

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>Apex</h1>
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
          <button
            type="button"
            className={activeTab === 'aar' ? 'tab-active' : ''}
            onClick={() => setActiveTab('aar')}
          >
            After-Action Review
          </button>
        </nav>
        {!AUTH_DISABLED && <button onClick={handleLogout}>Log out</button>}
      </header>

      <div className={activeTab === 'overview' ? 'dashboard-grid' : 'tab-hidden'}>
        <section className="dashboard-map">
          <MarkupTools
            activeTool={activeTool}
            layers={layers}
            activeLayerId={activeLayerId}
            style={markupStyle}
            draftPointCount={draftPointCount}
            onToolChange={setActiveTool}
            onLayerChange={setActiveLayerId}
            onLayersChange={setLayers}
            onStyleChange={setMarkupStyle}
            onFinishDrawing={() => setFinishDrawingSignal((signal) => signal + 1)}
            onClear={() => {
              if (window.confirm('Clear all markups?')) setMarkups([]);
            }}
            onSave={handleSaveMarkups}
            onExport={handleExportMarkups}
          />
          <Map
            locations={locations}
            onSelect={setSelected}
            aoo={selected}
            aooRadiusKm={aooRadiusKm}
            heatmap={heatmap}
            units={units}
            markups={markups}
            layers={layers}
            coaOverlays={coaOverlays}
            activeTool={activeTool}
            activeLayerId={activeLayerId}
            markupStyle={markupStyle}
            selectedUnitId={selectedUnitId}
            onUnitPlace={handleUnitPlace}
            onSelectUnit={setSelectedUnitId}
            onMoveUnit={(unitId, position) => {
              const unit = units.find((candidate) => candidate.id === unitId);
              if (unit) handleUnitUpdate({ ...unit, position });
            }}
            onCreateMarkup={handleCreateMarkup}
            onDraftChange={setDraftPointCount}
            finishDrawingSignal={finishDrawingSignal}
          />
          {tacticalStatus && <p className="tactical-status">{tacticalStatus}</p>}
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

          <UnitSymbols
            selectedTemplate={unitTemplate}
            onTemplateChange={setUnitTemplate}
            onPlacementMode={(template) => {
              setUnitTemplate(template);
              setActiveTool('unit');
              setTacticalStatus('Click the map to place the selected unit.');
            }}
          />

          <UnitsPanel
            units={units}
            selectedUnitId={selectedUnitId}
            onSelect={setSelectedUnitId}
            onUpdate={handleUnitUpdate}
            onDelete={handleUnitDelete}
          />

          <div className={sidebarTab === 'aoo' ? '' : 'tab-hidden'}>
            <AOOPanel aoo={selected} radiusKm={aooRadiusKm} onRadiusChange={setAooRadiusKm} />
          </div>

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

          <div className={sidebarTab === 'supply' ? '' : 'tab-hidden'}>
            <SupplyPanel
              status={supply.status}
              forecast={supply.forecast}
              consumption={supply.consumption}
              loading={supply.loading}
              error={supply.error}
              onRefresh={supply.refresh}
            />
          </div>

          <div className={sidebarTab === 'coas' ? '' : 'tab-hidden'}>
            <COAAnalysisPanel
              scenarioId={scenarioId}
              units={units}
              documents={documents}
              coas={coas}
              selectedCOAId={selectedCOAId}
              counterPlan={counterPlan}
              opord={opord}
              onCoasChange={setCoas}
              onSelectedCOAChange={setSelectedCOAId}
              onCounterPlanChange={setCounterPlan}
              onOpordChange={setOpord}
              onOverlayChange={setCoaOverlays}
            />
          </div>
        </aside>

        <section className="dashboard-analysis">
          <AnalysisChart
            title="Activity Trend"
            labels={['Mon', 'Tue', 'Wed', 'Thu', 'Fri']}
            datasets={[{ label: 'Reports', data: [3, 5, 2, 8, 4], borderColor: '#2f81f7' }]}
          />
        </section>

        <section className="dashboard-logistics">
          <h2>Logistics</h2>
          <LogisticsMap
            depots={supply.depots}
            units={supply.status?.units || []}
            routes={supply.forecast?.routes || []}
          />
        </section>

        <section className="dashboard-documents">
          <DocumentUpload scenarioId={scenarioId} onDocumentsChange={setDocuments} />
        </section>
      </div>

      <div className={activeTab === 'comms' ? 'dashboard-comms' : 'tab-hidden'}>
        <CommunicationsPanel />
      </div>

      <div className={activeTab === 'aar' ? 'dashboard-aar' : 'tab-hidden'}>
        <AARPanel />
      </div>
    </div>
  );
}
