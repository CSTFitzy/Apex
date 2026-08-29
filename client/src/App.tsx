import { useState, useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import axios from 'axios'
import './App.css'

interface Location {
  id: number
  name: string
  latitude: number
  longitude: number
  type: string
  description: string
}

function App() {
  const [locations, setLocations] = useState<Location[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('map')

  useEffect(() => {
    fetchLocations()
  }, [])

  const fetchLocations = async () => {
    try {
      const response = await axios.get('/api/map/data')
      setLocations(response.data)
    } catch (error) {
      console.error('Error fetching locations:', error)
    } finally {
      setLoading(false)
    }
  }

  // Default map center (Sydney, Australia)
  const defaultCenter: [number, number] = [-33.8688, 151.2093]

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-content">
          <h1>🦈 Sharknet</h1>
          <p>Tactical Battle Management System</p>
        </div>
        <nav className="header-nav">
          <button 
            className={`nav-btn ${activeTab === 'map' ? 'active' : ''}`}
            onClick={() => setActiveTab('map')}
          >
            Tactical Map
          </button>
          <button 
            className={`nav-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            C2IS Dashboard
          </button>
          <button 
            className={`nav-btn ${activeTab === 'osint' ? 'active' : ''}`}
            onClick={() => setActiveTab('osint')}
          >
            OSINT Feeds
          </button>
          <button 
            className={`nav-btn ${activeTab === 'weather' ? 'active' : ''}`}
            onClick={() => setActiveTab('weather')}
          >
            Weather
          </button>
        </nav>
      </header>

      <div className="app-content">
        <aside className="sidebar">
          <div className="sidebar-content">
            <h2>Tactical Locations</h2>
            {loading ? (
              <p>Loading...</p>
            ) : locations.length > 0 ? (
              <ul className="location-list">
                {locations.map((location) => (
                  <li key={location.id} className="location-item">
                    <strong>{location.name}</strong>
                    <small>{location.type}</small>
                    <p>{location.description}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No locations found</p>
            )}
          </div>
        </aside>

        <main className="main-content">
          {activeTab === 'map' && (
            <div className="map-container">
              <MapContainer
                center={defaultCenter}
                zoom={10}
                style={{ height: '100%', width: '100%' }}
              >
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                />
                {locations.map((location) => (
                  <Marker
                    key={location.id}
                    position={[location.latitude, location.longitude]}
                  >
                    <Popup>
                      <div>
                        <h3>{location.name}</h3>
                        <p><strong>Type:</strong> {location.type}</p>
                        <p>{location.description}</p>
                      </div>
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            </div>
          )}

          {activeTab === 'dashboard' && (
            <div className="dashboard-panel">
              <h2>C2IS Command & Control Dashboard</h2>
              <div className="dashboard-grid">
                <div className="dashboard-card">
                  <h3>Threat Level</h3>
                  <p className="threat-high">HIGH</p>
                </div>
                <div className="dashboard-card">
                  <h3>Active Targets</h3>
                  <p className="target-count">12</p>
                </div>
                <div className="dashboard-card">
                  <h3>Units Deployed</h3>
                  <p className="units-count">28</p>
                </div>
                <div className="dashboard-card">
                  <h3>System Status</h3>
                  <p className="status-ok">OPERATIONAL</p>
                </div>
              </div>
              <div className="alerts-section">
                <h3>Recent Alerts</h3>
                <div className="alert-item alert-high">
                  <strong>CRITICAL:</strong> Defensive perimeter breached at checkpoint 7
                </div>
                <div className="alert-item alert-medium">
                  <strong>WARNING:</strong> Unusual activity detected in sector 3
                </div>
                <div className="alert-item alert-low">
                  <strong>INFO:</strong> Weather conditions changing - visibility reduced
                </div>
              </div>
            </div>
          )}

          {activeTab === 'osint' && (
            <div className="osint-panel">
              <h2>OSINT Intelligence Feeds</h2>
              <div className="feed-container">
                <div className="feed-item">
                  <h4>Liveuamap</h4>
                  <p>Real-time conflict monitoring and incident tracking</p>
                  <span className="feed-status">CONNECTED</span>
                </div>
                <div className="feed-item">
                  <h4>Oryx Database</h4>
                  <p>Equipment losses and military asset tracking</p>
                  <span className="feed-status">CONNECTED</span>
                </div>
                <div className="feed-item">
                  <h4>Institute for the Study of War</h4>
                  <p>Strategic analysis and military assessments</p>
                  <span className="feed-status">CONNECTED</span>
                </div>
                <div className="feed-item">
                  <h4>ODIN C2IS</h4>
                  <p>Command & Control Intelligence System integration</p>
                  <span className="feed-status">CONNECTED</span>
                </div>
              </div>
              <div className="intelligence-summary">
                <h3>Latest Intelligence Summary</h3>
                <p>Multiple sources indicate sustained operational activity. Analysis suggests coordinated movements across 3 sectors. Current confidence level: HIGH</p>
              </div>
            </div>
          )}

          {activeTab === 'weather' && (
            <div className="weather-panel">
              <h2>Meteorological Data Integration</h2>
              <div className="weather-grid">
                <div className="weather-card">
                  <h3>Open-Meteo</h3>
                  <p>Global forecast data with 7-day prediction</p>
                  <div className="weather-data">
                    <div>Temperature: 24°C</div>
                    <div>Wind: 15 km/h from NW</div>
                    <div>Visibility: 10 km</div>
                  </div>
                </div>
                <div className="weather-card">
                  <h3>MET Norway</h3>
                  <p>High-resolution Nordic regional forecasts</p>
                  <div className="weather-data">
                    <div>Precipitation: 2mm expected</div>
                    <div>Cloud Cover: 40%</div>
                    <div>Humidity: 65%</div>
                  </div>
                </div>
                <div className="weather-card">
                  <h3>OpenWeatherMap</h3>
                  <p>Comprehensive atmospheric monitoring</p>
                  <div className="weather-data">
                    <div>Pressure: 1013 hPa</div>
                    <div>UV Index: 5</div>
                    <div>Dew Point: 18°C</div>
                  </div>
                </div>
              </div>
              <div className="weather-alerts">
                <h3>Operational Impact</h3>
                <p>Current weather conditions suitable for operations. Light winds and good visibility expected to continue for next 12 hours.</p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

export default App
