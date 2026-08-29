# Apex - Data Visualization & Mapping Libraries

## Recommended Libraries & Tools

### 1. Map Rendering Libraries

#### Leaflet.js (Primary Recommendation)
**Why**: Lightweight, battle-tested, ODIN-compatible, excellent military symbology support

```javascript
// Basic setup with military symbols
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

class ApexMap {
  constructor(containerId) {
    this.map = L.map(containerId).setView([52.52, 13.405], 10);
    
    // Add base layer (OpenStreetMap)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(this.map);

    this.symbols = new Map();
    this.layers = new Map();
  }

  // Add military symbol (MIL-STD-2525C)
  addMilitarySymbol(symbolData) {
    const marker = L.marker(
      [symbolData.latitude, symbolData.longitude],
      {
        icon: this.getMilitaryIcon(symbolData.sidc),
        title: symbolData.name
      }
    )
      .bindPopup(`
        <b>${symbolData.name}</b><br/>
        SIDC: ${symbolData.sidc}<br/>
        Status: ${symbolData.status || 'ACTIVE'}
      `)
      .addTo(this.map);

    this.symbols.set(symbolData.id, marker);
    return marker;
  }

  updateSymbolPosition(symbolId, latitude, longitude) {
    const marker = this.symbols.get(symbolId);
    if (marker) {
      marker.setLatLng([latitude, longitude]);
    }
  }

  addWeatherLayer(weatherData) {
    const weatherLayer = L.layerGroup();

    weatherData.windPoints.forEach(point => {
      L.circleMarker([point.lat, point.lon], {
        radius: 5,
        color: this.getWindSpeedColor(point.speed),
        fill: true
      })
        .bindPopup(`Wind: ${point.speed} m/s from ${point.direction}°`)
        .addTo(weatherLayer);
    });

    this.layers.set('weather', weatherLayer);
    weatherLayer.addTo(this.map);
  }

  toggleLayer(layerName) {
    const layer = this.layers.get(layerName);
    if (layer) {
      if (this.map.hasLayer(layer)) {
        this.map.removeLayer(layer);
      } else {
        this.map.addLayer(layer);
      }
    }
  }
}
```

#### Mapbox GL JS (Advanced Option)
**Why**: High-performance, 3D support, excellent for large datasets

```javascript
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

class ApexMapboxMap {
  constructor(containerId, accessToken) {
    mapboxgl.accessToken = accessToken;
    this.map = new mapboxgl.Map({
      container: containerId,
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      center: [13.405, 52.52],
      zoom: 10,
      pitch: 45,
      bearing: 0
    });

    this.setupLayers();
  }

  setupLayers() {
    this.map.on('load', () => {
      // Add military symbols layer
      this.map.addSource('military-units', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: []
        }
      });

      this.map.addLayer({
        id: 'military-symbols',
        type: 'symbol',
        source: 'military-units',
        layout: {
          'icon-image': ['get', 'icon'],
          'icon-size': 1,
          'text-field': ['get', 'name'],
          'text-offset': [0, 1.5],
          'text-anchor': 'top'
        }
      });
    });
  }
}
```

### 2. Dashboard & Charts

#### Chart.js (Real-time Dashboards)
```javascript
import Chart from 'chart.js/auto';

class TacticalDashboard {
  createThreatTimeline(containerId, threatData) {
    const ctx = document.getElementById(containerId).getContext('2d');
    return new Chart(ctx, {
      type: 'line',
      data: {
        labels: threatData.timestamps,
        datasets: [{
          label: 'Threat Level',
          data: threatData.levels,
          borderColor: 'red',
          backgroundColor: 'rgba(255, 0, 0, 0.1)'
        }]
      },
      options: {
        responsive: true,
        scales: {
          y: { min: 0, max: 100 }
        }
      }
    });
  }
}
```

### 3. Heatmap Visualization

#### Leaflet.heat
```javascript
import 'leaflet.heat';

class ThreatDensityMap {
  displayThreatHeatmap(map, threatPoints) {
    // threatPoints: array of [latitude, longitude, intensity]
    return L.heatLayer(threatPoints, {
      radius: 30,
      blur: 20,
      maxZoom: 17,
      gradient: {
        0.0: 'green',
        0.25: 'yellow',
        0.5: 'orange',
        0.75: 'red',
        1.0: 'darkred'
      }
    }).addTo(map);
  }
}
```

### 4. 3D Terrain Visualization

#### Cesium.js (Advanced 3D)
```javascript
import * as Cesium from 'cesium';

class TerrainVisualization {
  constructor(containerId) {
    Cesium.Ion.defaultAccessToken = 'YOUR_CESIUM_TOKEN';
    
    this.viewer = new Cesium.Viewer(containerId, {
      terrainProvider: Cesium.createWorldTerrain(),
      imageryProvider: Cesium.ArcGisMapServerImageryProvider.fromUrl(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'
      )
    });
  }

  addUnit(unit) {
    return this.viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(
        unit.longitude,
        unit.latitude,
        100
      ),
      model: {
        uri: `/models/${unit.type}.gltf`,
        minimumPixelSize: 128
      },
      label: {
        text: unit.name,
        fillColor: Cesium.Color.WHITE,
        font: '12px monospace'
      }
    });
  }
}
```

## Recommended Stack for Apex

| Library | Use Case | Complexity | Performance |
|---------|----------|-----------|-------------||
| Leaflet.js | Tactical mapping, military symbols | Low | Excellent |
| Mapbox GL | Advanced mapping, 3D, large datasets | Medium | Very Good |
| Chart.js | Dashboards, real-time metrics | Low | Excellent |
| Leaflet.heat | Threat/density heatmaps | Low | Very Good |
| Cesium.js | 3D terrain, advanced visualization | High | Good |

**Primary Stack**:
- Leaflet.js + ODIN integration for tactical mapping
- Chart.js for dashboard metrics
- Leaflet.heat for threat/weather density
