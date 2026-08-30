import { useEffect, useRef, useState } from 'react'
import TacticalMap from './components/TacticalMap'
import { AnalysisStatsPanel, DrawingToolsPanel } from './components/MapTools'
import WeatherPanel from './components/WeatherPanel'
import TerrainPanel from './components/TerrainPanel'
import DocumentsPanel from './components/DocumentsPanel'
import EnemyPanel from './components/EnemyPanel'
import SimulationPanel from './components/SimulationPanel'
import PredictionPanel from './components/PredictionPanel'
import AARPanel from './components/aar/AARPanel'
import Cesium3DView from './components/Cesium3DView'
import api from './api/client'
import { buildAO, rectangleVertices } from './utils/geometry'
import { pushHistory } from './utils/prediction'
import { usePredictions } from './hooks/usePredictions'
import type {
  AOBounds,
  AreaOfOperations,
  CounterPlanResult,
  DocumentUploadResult,
  DrawMode,
  LatLon,
  LosObserver,
  SpotHeight,
  TacticalUnit,
  ViewshedResult,
} from './types'
import './App.css'

type Tab = 'terrain' | 'weather' | 'documents' | 'enemy' | 'simulation' | 'predictions' | 'aar'

/** Observer eye height above ground level used by the LOS visibility tool. */
const OBSERVER_HEIGHT_M = 1.5
const LOS_RAYS = 36
const MAX_LOS_RADIUS_M = 20000
const DRAFT_OBSERVER_ID = 'los-draft'

function aoFromBounds(bounds: AOBounds): AreaOfOperations {
  return buildAO(
    'rectangle',
    rectangleVertices(
      { lat: bounds.north, lon: bounds.west },
      { lat: bounds.south, lon: bounds.east }
    )
  )
}

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('terrain')

  // Default map center (Sydney, Australia)
  const [mapCenter] = useState<LatLon>({ lat: -33.8688, lon: 151.2093 })

  const [ao, setAO] = useState<AreaOfOperations | null>(null)
  const [drawMode, setDrawMode] = useState<DrawMode>('none')
  const [observers, setObservers] = useState<LosObserver[]>([])

  const [spotHeights, setSpotHeights] = useState<SpotHeight[]>([])
  const [losPoints, setLosPoints] = useState<LatLon[]>([])
  const [viewshed, setViewshed] = useState<ViewshedResult | null>(null)
  const [terrainSummary, setTerrainSummary] = useState('')

  const [docResult, setDocResult] = useState<DocumentUploadResult | null>(null)
  const [counterPlan, setCounterPlan] = useState<CounterPlanResult | null>(null)
  const [units, setUnits] = useState<TacticalUnit[]>([])
  const [unitHistory, setUnitHistory] = useState<Record<string, LatLon[]>>({})
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('2d')
  const [latestAAROperationId, setLatestAAROperationId] = useState<string | null>(null)

  // Track a bounded position history per unit so the AI prediction models have
  // recent movement to extrapolate from (updates whenever unit positions change).
  const historyRef = useRef<Record<string, LatLon[]>>({})
  useEffect(() => {
    const next = { ...historyRef.current }
    for (const unit of units) {
      next[unit.id] = pushHistory(next[unit.id] ?? [], unit.position)
    }
    historyRef.current = next
    setUnitHistory(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units])

  const { predictions, loading: predictionsLoading, error: predictionsError } = usePredictions(
    units,
    unitHistory,
    counterPlan
  )

  const aoBounds = ao?.bounds ?? null
  const aoCenter = ao?.center ?? null

  const handleAOIdentified = (_center: LatLon, bounds: AOBounds) => {
    setAO(aoFromBounds(bounds))
  }

  const handleMapClick = (point: LatLon) => {
    setLosPoints((prev) => {
      if (prev.length >= 2) return [point]
      return [...prev, point]
    })
  }

  /** Live preview while the user drags the LOS circle - no terrain query yet. */
  const handleLosDraft = (position: LatLon, radiusM: number) => {
    setObservers((prev) => [
      ...prev.filter((o) => o.id !== DRAFT_OBSERVER_ID),
      {
        id: DRAFT_OBSERVER_ID,
        position,
        observerHeightM: OBSERVER_HEIGHT_M,
        radiusM: Math.min(radiusM, MAX_LOS_RADIUS_M),
        viewshed: null,
        loading: false,
      },
    ])
  }

  /** Drag finished: run the terrain viewshed for the observer at 1.5 m AGL. */
  const handleLosCommit = async (position: LatLon, rawRadiusM: number) => {
    const radiusM = Math.min(rawRadiusM, MAX_LOS_RADIUS_M)
    const id = `los-${Date.now()}`
    setObservers((prev) => [
      ...prev.filter((o) => o.id !== DRAFT_OBSERVER_ID),
      {
        id,
        position,
        observerHeightM: OBSERVER_HEIGHT_M,
        radiusM,
        viewshed: null,
        loading: true,
      },
    ])

    try {
      const { data } = await api.post<ViewshedResult>('/terrain/viewshed', {
        origin: position,
        radius: radiusM,
        rays: LOS_RAYS,
        observerHeight: OBSERVER_HEIGHT_M,
        targetHeight: 0,
      })
      setObservers((prev) =>
        prev.map((o) => (o.id === id ? { ...o, viewshed: data, loading: false } : o))
      )
    } catch (err) {
      console.error(err)
      setObservers((prev) =>
        prev.map((o) =>
          o.id === id ? { ...o, loading: false, error: 'Visibility analysis failed.' } : o
        )
      )
    }
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-content">
          <h1><img src="/apex-logo.svg" alt="Apex" className="app-logo" /> Apex</h1>
          <p>Tactical Battle Management System</p>
        </div>
        <nav className="header-nav">
          <button className={`nav-btn ${activeTab === 'terrain' ? 'active' : ''}`} onClick={() => setActiveTab('terrain')}>
            Terrain
          </button>
          <button className={`nav-btn ${activeTab === 'weather' ? 'active' : ''}`} onClick={() => setActiveTab('weather')}>
            Weather
          </button>
          <button className={`nav-btn ${activeTab === 'documents' ? 'active' : ''}`} onClick={() => setActiveTab('documents')}>
            Orders Upload
          </button>
          <button className={`nav-btn ${activeTab === 'enemy' ? 'active' : ''}`} onClick={() => setActiveTab('enemy')}>
            Enemy Analysis
          </button>
          <button className={`nav-btn ${activeTab === 'simulation' ? 'active' : ''}`} onClick={() => setActiveTab('simulation')}>
            Simulation
          </button>
          <button className={`nav-btn ${activeTab === 'predictions' ? 'active' : ''}`} onClick={() => setActiveTab('predictions')}>
            AI Predictions
          </button>
          <button className={`nav-btn ${activeTab === 'aar' ? 'active' : ''}`} onClick={() => setActiveTab('aar')}>
            After-Action Review
          </button>
        </nav>
      </header>

      <div className="app-content">
        <main className="map-main">
          <button
            className="view-toggle-btn"
            onClick={() => setViewMode((m) => (m === '2d' ? '3d' : '2d'))}
            title="Switch between 2D map and 3D globe view"
          >
            {viewMode === '2d' ? '🌍 Switch to 3D Globe' : '🗺️ Switch to 2D Map'}
          </button>
          {viewMode === '2d' ? (
            <TacticalMap
              center={aoCenter ?? mapCenter}
              ao={ao}
              drawMode={drawMode}
              onAOChange={setAO}
              onDrawModeChange={setDrawMode}
              observers={observers}
              onLosDraft={handleLosDraft}
              onLosCommit={handleLosCommit}
              spotHeights={spotHeights}
              losPoints={losPoints}
              onMapClick={handleMapClick}
              units={units}
              viewshed={viewshed}
              predictions={predictions}
            />
          ) : (
            <Cesium3DView center={aoCenter ?? mapCenter} ao={ao} observers={observers} units={units} />
          )}
          {viewMode === '2d' && (
            <>
              <DrawingToolsPanel
                drawMode={drawMode}
                onDrawModeChange={setDrawMode}
                hasAO={ao !== null}
                onClearAO={() => setAO(null)}
                observerCount={observers.length}
                onClearObservers={() => setObservers([])}
              />
              <AnalysisStatsPanel ao={ao} observers={observers} />
            </>
          )}
        </main>

        <aside className="side-panel">
          {activeTab === 'terrain' && (
            <TerrainPanel
              aoBounds={aoBounds}
              spotHeights={spotHeights}
              onSpotHeightsChange={setSpotHeights}
              losPoints={losPoints}
              onClearLosPoints={() => setLosPoints([])}
              onViewshedChange={setViewshed}
              onTerrainSummary={setTerrainSummary}
            />
          )}
          {activeTab === 'weather' && <WeatherPanel ao={ao} />}
          {activeTab === 'documents' && (
            <DocumentsPanel onAOIdentified={handleAOIdentified} onExtraction={setDocResult} />
          )}
          {activeTab === 'enemy' && (
            <EnemyPanel docResult={docResult} terrainSummary={terrainSummary} onCounterPlan={setCounterPlan} />
          )}
          {/*
            The simulation panel stays mounted (just hidden) rather than being
            conditionally rendered, so its tick loop - and therefore unit
            movement history - keeps running while the user views other tabs
            (e.g. AI Predictions), instead of pausing whenever the tab is
            switched away from "Simulation".
          */}
          <div className={activeTab === 'simulation' ? undefined : 'tab-hidden'}>
            <SimulationPanel
              aoCenter={aoCenter}
              units={units}
              onUnitsChange={setUnits}
              counterPlan={counterPlan}
              onOperationRecorded={setLatestAAROperationId}
            />
          </div>
          {activeTab === 'predictions' && (
            <PredictionPanel
              units={units}
              predictions={predictions}
              loading={predictionsLoading}
              error={predictionsError}
            />
          )}
          {activeTab === 'aar' && <AARPanel latestOperationId={latestAAROperationId} />}
        </aside>
      </div>
    </div>
  )
}

export default App
