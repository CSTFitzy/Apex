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
        <h1>🦈 Sharknet</h1>
        <p>Interactive Marine Tracking System</p>
      </header>

      <div className="app-content">
        <aside className="sidebar">
          <div className="sidebar-content">
            <h2>Locations</h2>
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

        <main className="map-container">
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
        </main>
      </div>
    </div>
  )
}

export default App
