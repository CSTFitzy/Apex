import { useState } from 'react'
import TacticalMap from './components/TacticalMap'
import WeatherPanel from './components/WeatherPanel'
import TerrainPanel from './components/TerrainPanel'
import DocumentsPanel from './components/DocumentsPanel'
import EnemyPanel from './components/EnemyPanel'
import SimulationPanel from './components/SimulationPanel'
import type {
  AOBounds,
  CounterPlanResult,
  DocumentUploadResult,
  LatLon,
  SpotHeight,
  TacticalUnit,
  ViewshedResult,
} from './types'
import './App.css'

type Tab = 'terrain' | 'weather' | 'documents' | 'enemy' | 'simulation'

function boundsCenter(bounds: AOBounds): LatLon {
  return { lat: (bounds.north + bounds.south) / 2, lon: (bounds.east + bounds.west) / 2 }
}

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('terrain')

  // Default map center (Sydney, Australia)
  const [mapCenter] = useState<LatLon>({ lat: -33.8688, lon: 151.2093 })

  const [aoBounds, setAOBounds] = useState<AOBounds | null>(null)
  const [aoCenter, setAOCenter] = useState<LatLon | null>(null)

  const [spotHeights, setSpotHeights] = useState<SpotHeight[]>([])
  const [losPoints, setLosPoints] = useState<LatLon[]>([])
  const [viewshed, setViewshed] = useState<ViewshedResult | null>(null)
  const [terrainSummary, setTerrainSummary] = useState('')

  const [docResult, setDocResult] = useState<DocumentUploadResult | null>(null)
  const [counterPlan, setCounterPlan] = useState<CounterPlanResult | null>(null)
  const [units, setUnits] = useState<TacticalUnit[]>([])

  const handleAOChange = (bounds: AOBounds | null) => {
    setAOBounds(bounds)
    setAOCenter(bounds ? boundsCenter(bounds) : null)
  }

  const handleAOIdentified = (center: LatLon, bounds: AOBounds) => {
    setAOCenter(center)
    setAOBounds(bounds)
  }

  const handleMapClick = (point: LatLon) => {
    setLosPoints((prev) => {
      if (prev.length >= 2) return [point]
      return [...prev, point]
    })
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-content">
          <h1>🦈 Sharknet</h1>
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
        </nav>
      </header>

      <div className="app-content">
        <main className="map-main">
          <TacticalMap
            center={aoCenter ?? mapCenter}
            aoBounds={aoBounds}
            onAOChange={handleAOChange}
            spotHeights={spotHeights}
            losPoints={losPoints}
            onMapClick={handleMapClick}
            units={units}
            viewshed={viewshed}
          />
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
          {activeTab === 'weather' && <WeatherPanel aoCenter={aoCenter} />}
          {activeTab === 'documents' && (
            <DocumentsPanel onAOIdentified={handleAOIdentified} onExtraction={setDocResult} />
          )}
          {activeTab === 'enemy' && (
            <EnemyPanel docResult={docResult} terrainSummary={terrainSummary} onCounterPlan={setCounterPlan} />
          )}
          {activeTab === 'simulation' && (
            <SimulationPanel
              aoCenter={aoCenter}
              units={units}
              onUnitsChange={setUnits}
              counterPlan={counterPlan}
            />
          )}
        </aside>
      </div>
    </div>
  )
}

export default App
