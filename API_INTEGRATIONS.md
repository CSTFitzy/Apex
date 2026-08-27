# Sharknet - API Integration Guide

## Weather Data Integration Examples

### 1. Open-Meteo Integration
**Endpoint**: https://api.open-meteo.com/v1/forecast

```javascript
// Example: Fetch weather forecast
async function getWeatherForecast(latitude, longitude) {
  const response = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,precipitation,windspeed_10m,winddirection_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`
  );
  const data = await response.json();
  return {
    location: { latitude, longitude },
    hourly: data.hourly,
    daily: data.daily,
    timezone: data.timezone
  };
}
```

**Features**:
- No API key required
- Global coverage
- Hourly & daily forecasts
- Wind speed/direction (critical for tactical planning)
- Precipitation data
- Temperature forecasts

---

### 2. MET Norway (Yr) API Integration
**Endpoint**: https://api.met.no/weatherapi/locationforecast/2.0/

```javascript
// Example: Fetch locationforecast data
async function getMetNorwayForecast(latitude, longitude) {
  const response = await fetch(
    `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${latitude}&lon=${longitude}`,
    {
      headers: {
        'User-Agent': '(Sharknet; contact@example.com)' // Required by MET Norway
      }
    }
  );
  const data = await response.json();
  return data.properties.timeseries;
}
```

**Features**:
- No API key required
- High-resolution forecasts
- Detailed weather symbols
- Excellent for Nordic/European coverage
- Real-time updates every 6 hours

---

### 3. OpenWeatherMap Integration
**Endpoint**: https://api.openweathermap.org/data/2.5/

```javascript
// Example: One Call API (current + forecast + historical)
async function getOpenWeatherData(latitude, longitude, apiKey) {
  const response = await fetch(
    `https://api.openweathermap.org/data/3.0/onecall?lat=${latitude}&lon=${longitude}&appid=${apiKey}&exclude=minutely`
  );
  const data = await response.json();
  return {
    current: data.current,
    hourly: data.hourly,
    daily: data.daily,
    alerts: data.alerts
  };
}
```

**Features**:
- One Call API covers current, forecast, and historical
- Severe weather alerts
- UV index & visibility
- Global coverage
- Free tier available (limited calls)

---

## ODIN Integration Examples

### 1. ODIN WebSocket Connection

```javascript
// Example: Connect to ODIN via WebSocket
const WebSocket = require('ws');

class ODINClient {
  constructor(odinUrl = 'wss://odin.syncpoint.io') {
    this.url = odinUrl;
    this.ws = null;
    this.listeners = {};
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      
      this.ws.on('open', () => {
        console.log('Connected to ODIN');
        resolve();
      });
      
      this.ws.on('message', (data) => {
        const message = JSON.parse(data);
        this.emit(message.type, message.payload);
      });
      
      this.ws.on('error', reject);
    });
  }

  // Add a military symbol to the map
  addSymbol(symbolData) {
    const message = {
      type: 'ADD_SYMBOL',
      payload: {
        id: symbolData.id,
        sidc: symbolData.sidc, // MIL-STD-2525C code
        latitude: symbolData.latitude,
        longitude: symbolData.longitude,
        name: symbolData.name,
        properties: symbolData.properties
      }
    };
    this.ws.send(JSON.stringify(message));
  }

  // Update symbol position (for moving units)
  updateSymbolPosition(symbolId, latitude, longitude) {
    const message = {
      type: 'UPDATE_POSITION',
      payload: { id: symbolId, latitude, longitude }
    };
    this.ws.send(JSON.stringify(message));
  }

  // Listen for events
  on(eventType, callback) {
    if (!this.listeners[eventType]) {
      this.listeners[eventType] = [];
    }
    this.listeners[eventType].push(callback);
  }

  emit(eventType, data) {
    if (this.listeners[eventType]) {
      this.listeners[eventType].forEach(callback => callback(data));
    }
  }

  disconnect() {
    if (this.ws) this.ws.close();
  }
}

// Usage example
const odinClient = new ODINClient();
await odinClient.connect();

odinClient.addSymbol({
  id: 'unit-001',
  sidc: 'SFGPUCHRH', // Friendly Ground armor unit
  latitude: 52.5200,
  longitude: 13.4050,
  name: 'Tank Platoon Alpha'
});

odinClient.on('SYMBOL_MOVED', (data) => {
  console.log(`Unit ${data.id} moved to:`, data.latitude, data.longitude);
});
```

---

## OSINT Data Integration Examples

### 1. Liveuamap API Integration

```javascript
// Example: Fetch conflict data
async function getConflictData(bbox) {
  // bbox format: [min_lon, min_lat, max_lon, max_lat]
  const [minLon, minLat, maxLon, maxLat] = bbox;
  
  const response = await fetch(
    `https://liveuamap.com/api/map/incidents?bbox=${minLon},${minLat},${maxLon},${maxLat}`
  );
  const data = await response.json();
  
  return data.features.map(feature => ({
    id: feature.properties.id,
    type: feature.properties.type,
    timestamp: feature.properties.timestamp,
    location: {
      lat: feature.geometry.coordinates[1],
      lon: feature.geometry.coordinates[0]
    },
    description: feature.properties.description,
    source: feature.properties.source
  }));
}
```

### 2. Oryx Equipment Tracking

```javascript
// Example: Parse Oryx equipment loss data
async function parseOryxData(sourceUrl) {
  const response = await fetch(sourceUrl);
  const html = await response.text();
  
  // Parse equipment casualties from Oryx reports
  const losses = {
    tanks: extractLosses(html, 'tank'),
    helicopters: extractLosses(html, 'helicopter'),
    aircraft: extractLosses(html, 'aircraft'),
    vehicles: extractLosses(html, 'vehicle')
  };
  
  return losses;
}

function extractLosses(html, equipmentType) {
  // Implementation would parse HTML and extract loss counts
  // Returns: { confirmed: number, estimatedTotal: number, lastUpdated: date }
}
```

### 3. ISW Military Analysis Feed

```javascript
// Example: Aggregate ISW reports
async function getISWAnalysis(region = 'ukraine') {
  const response = await fetch(
    `https://www.understandingwar.org/api/reports?region=${region}&type=daily-update`
  );
  const reports = await response.json();
  
  return reports.map(report => ({
    date: report.published,
    title: report.title,
    summary: report.summary,
    keyPoints: report.analysis,
    mapUrl: report.mapUrl,
    sourceUrl: report.url
  }));
}
```

---

## Composite Integration Example

### Multi-Source Tactical Assessment

```javascript
class TacticalAssessmentEngine {
  constructor(odinClient, weatherClient, osintClient) {
    this.odin = odinClient;
    this.weather = weatherClient;
    this.osint = osintClient;
  }

  async generateTacticalAssessment(latitude, longitude, missionArea) {
    // Gather data from all sources
    const [weatherData, osintData] = await Promise.all([
      this.weather.getForecast(latitude, longitude),
      this.osint.getConflictData(missionArea.bbox)
    ]);

    // Analyze weather impact on operations
    const weatherImpact = this.analyzeWeatherTactically(weatherData);

    // Assess threat level from OSINT
    const threatAssessment = this.assessThreats(osintData);

    // Generate recommendation
    return {
      timestamp: new Date(),
      location: { latitude, longitude },
      weather: weatherImpact,
      threats: threatAssessment,
      operationalRecommendation: this.generateRecommendation(
        weatherImpact,
        threatAssessment
      ),
      confidenceLevel: this.calculateConfidence(osintData)
    };
  }

  analyzeWeatherTactically(weather) {
    return {
      visibility: weather.current.visibility < 1000 ? 'REDUCED' : 'GOOD',
      windSpeed: weather.current.wind_speed,
      windDirection: weather.current.wind_deg,
      precipitation: weather.hourly.precipitation,
      tacticalImpact: this.getWeatherTacticalImpact(weather)
    };
  }

  getWeatherTacticalImpact(weather) {
    const impacts = [];
    if (weather.current.visibility < 500) impacts.push('HELICOPTER_OPS_RESTRICTED');
    if (weather.current.wind_speed > 25) impacts.push('ROTARY_WING_CAUTION');
    if (weather.hourly.precipitation > 5) impacts.push('MUD_MOBILITY_REDUCED');
    return impacts;
  }

  assessThreats(osintData) {
    return {
      recentIncidents: osintData.slice(0, 5),
      threatLevel: osintData.length > 10 ? 'HIGH' : osintData.length > 5 ? 'MEDIUM' : 'LOW',
      primaryThreats: this.identifyPrimaryThreats(osintData)
    };
  }

  identifyPrimaryThreats(osintData) {
    // Categorize threats by type and recency
    return osintData
      .filter(incident => incident.timestamp > Date.now() - 86400000) // Last 24h
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 5);
  }

  generateRecommendation(weather, threats) {
    let recommendation = 'OPERATIONS_PROCEED';
    
    if (weather.tacticalImpact.includes('HELICOPTER_OPS_RESTRICTED')) {
      recommendation = 'AVOID_ROTARY_OPERATIONS';
    }
    if (threats.threatLevel === 'HIGH') {
      recommendation = 'HEIGHTENED_ALERT_REQUIRED';
    }
    
    return recommendation;
  }

  calculateConfidence(osintData) {
    return Math.min(100, osintData.length * 10); // Rough confidence based on data sources
  }
}
```

---

## Data Schema for Integrated Data

```javascript
// Tactical Mission Object
{
  id: "mission-2024-001",
  name: "Operation Thunder",
  status: "ACTIVE",
  areaOfOperation: {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [...] }
  },
  units: [
    {
      id: "unit-001",
      name: "Tank Platoon Alpha",
      sidc: "SFGPUCHRH",
      position: { latitude: 52.5200, longitude: 13.4050 },
      lastUpdate: "2024-01-15T10:30:00Z"
    }
  ],
  weather: {
    current: {...},
    forecast: {...},
    tacticalImpact: ["REDUCED_VISIBILITY"]
  },
  intelligence: {
    threats: [...],
    lastUpdated: "2024-01-15T10:25:00Z",
    sourceCount: 5
  },
  assessments: [
    {
      timestamp: "2024-01-15T10:30:00Z",
      recommendation: "PROCEED_WITH_CAUTION",
      confidenceLevel: 85
    }
  ]
}
```

---

## API Rate Limiting & Caching Strategy

```javascript
class APICache {
  constructor(ttl = 300000) { // 5 minutes default
    this.cache = new Map();
    this.ttl = ttl;
  }

  set(key, value) {
    this.cache.set(key, {
      value,
      expires: Date.now() + this.ttl
    });
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    if (Date.now() > item.expires) {
      this.cache.delete(key);
      return null;
    }
    return item.value;
  }

  async fetchWithCache(key, fetchFn) {
    const cached = this.get(key);
    if (cached) return cached;
    
    const value = await fetchFn();
    this.set(key, value);
    return value;
  }
}

// Usage
const weatherCache = new APICache(600000); // 10 minutes

const forecast = await weatherCache.fetchWithCache(
  `weather-${lat}-${lon}`,
  () => getWeatherForecast(lat, lon)
);
```

---

## Testing Integration Endpoints

```bash
# Test Open-Meteo
curl "https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.405&hourly=temperature_2m"

# Test MET Norway
curl -H "User-Agent: Sharknet" "https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=52.52&lon=13.405"

# Test local ODIN instance (if running)
wscat -c ws://localhost:8080/ws
```
