# Apex

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

Open-source tactical management system utilizing ODIN, military intelligence data, and meteorological APIs for strategic planning and terrain analysis.

## Features

- **Tactical Mapping** - ODIN integration with MIL-STD-2525C military symbology
- **Area of Operations Analysis** - Click anywhere on the world map to select an AOO and generate an automated terrain & weather report (see [Area of Operations Analysis](#area-of-operations-analysis) below)
- **Real-time Collaboration** - Distributed command & control via Matrix protocol
- **Weather Integration** - Multi-source meteorological data (Open-Meteo, MET Norway, OpenWeatherMap)
- **OSINT Data** - Open-source intelligence aggregation and analysis
- **Threat Visualization** - Heatmaps, timeline analysis, equipment tracking
- **Real-Time Analytics** - Live KPIs, battle damage assessment, and 7 tactical heatmaps computed from the active simulation (see [Real-Time Analytics](#real-time-analytics) below)
- **Supply Chain & Logistics** - Per-unit supply tracking, depletion forecasting, and optimized resupply routing
- **Offline Operation** - Full self-hosting capability
- **No Vendor Lock-in** - Complete operational independence

## Quick Start

### Prerequisites
- Docker & Docker Compose
- Node.js 18+
- PostgreSQL 14+ with PostGIS extension
- Redis 7+

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/CSTFitzy/Apex.git
   cd Apex
   ```

2. **Setup environment**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Start with Docker Compose**
   ```bash
   docker-compose up -d
   ```

4. **Access the application**
   - Frontend: http://localhost:5173
   - Backend API: http://localhost:3000/api

### Running without a database or login

Apex bypasses authentication outside of production, so you can start it with
just Node.js installed:

```bash
npm install
npm run server   # backend on port 3000
npm run dev      # frontend on port 5173 (separate terminal)
```

The dev server opens straight into the dashboard - no login screen and no
PostgreSQL required (user accounts fall back to in-memory storage). To enforce
login again, set `DISABLE_AUTH=false` for the backend and
`VITE_REQUIRE_AUTH=true` for the frontend.

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed system design and technology stack.

## API Integration

See [API_INTEGRATIONS.md](./API_INTEGRATIONS.md) for code examples and integration guides for:
- ODIN Command & Control
- Weather APIs (Open-Meteo, MET Norway, OpenWeatherMap)
- OSINT Data Sources (Liveuamap, Oryx, ISW)

## Area of Operations Analysis

Click anywhere on the tactical map to select an area of operations (AOO). The
**AOO** sidebar tab lets you name the area, set its radius, and run an
automated analysis:

- Elevation is sampled on a 7x7 grid across the AOO (Open-Meteo elevation API,
  no key required) and reduced to min/max/mean elevation and relief.
- Slope statistics (mean, max, fraction of steep ground) drive a terrain
  classification (`water`, `flat`, `rolling`, `hilly`, `mountainous`) and a
  cross-country mobility rating.
- Key terrain (dominating high ground, low ground / likely water courses) and
  likely natural obstacles are identified from the elevation profile.
- The Open-Meteo forecast for the AOO centre is summarised into current
  conditions, a 7-day forecast, and operational impact statements (aviation,
  visibility, going, heat/cold casualty risk).

Endpoints:

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| GET | `/api/terrain/analyze?lat=&lon=&radius=` | Structured terrain + weather analysis (JSON) |
| GET | `/api/terrain/report?lat=&lon=&radius=&name=&format=` | Terrain & weather report (`text` by default, `json` supported) |

Weather lookups are best-effort: if the forecast provider is unreachable the
terrain analysis is still returned.

## Supply Chain & Logistics

Supply state is tracked per unit for four supply classes (ammunition, fuel,
rations, medical), backed by indexed PostgreSQL tables and an in-process TTL
cache for the hot unit-roster reads.

| Endpoint | Description |
| --- | --- |
| `GET /api/supply/status` | Current levels per unit plus aggregate totals, status and alerts |
| `POST /api/supply/consume` | Record a consumption event against a unit's stock |
| `POST /api/supply/transfer` | Transfer supplies unit-to-unit or depot-to-unit |
| `GET /api/supply/forecast` | Time-to-depletion forecasts, resupply recommendations and routes |
| `GET /api/supply/depots` | Supply depot locations and on-hand stock |
| `POST /api/supply/depots` | Register a supply depot |
| `GET /api/supply/units` | Unit roster, filterable by force/status or map bounding box |
| `POST /api/supply/units` | Register a unit and seed its supply lines |
| `GET /api/supply/consumption` | Recent consumption events for the rate graphs |

Forecasts blend each unit's configured consumption rate with the rate actually
observed over a rolling window (`?window=<hours>`, default 24). Units are
classified as `critical` / `low` / `adequate` / `full`, and resupply routes are
planned from the nearest stocked depot using terrain-dependent convoy speeds
while routing around known enemy contact areas.

Consumption and transfer events are broadcast to subscribed WebSocket clients
as `SUPPLY_UPDATE` messages (topic `supply`), which drive the dashboard's
Supply Panel and Logistics Map in real time.

## Visualization

See [VISUALIZATION.md](./VISUALIZATION.md) for data visualization and mapping library recommendations including:
- Leaflet.js for tactical mapping
- Mapbox GL for advanced features
- Chart.js for dashboards
- Cesium.js for 3D terrain visualization

## Real-Time Analytics

During an active simulation the **Analytics** tab in the dashboard displays live KPIs (friendly/enemy strength, readiness, morale, combat effectiveness, casualty rate/trend, mission progress), a per-unit battle damage assessment (BDA) table, and 7 toggleable tactical heatmaps (casualty, enemy contact, engagement, fire support, risk, supply vulnerability, comms blackout).

Analytics computation is stateless: the client (via the **Simulation** tab) supplies the current `units` and `events` and the server computes results on the fly (`server/analytics/engine.js`). Endpoints:
- `POST /api/analytics/kpis`, `/bda`, `/heatmap` - compute analytics from `{ units, events }`
- `POST /api/analytics/events` - ingest a tactical event and broadcast it to subscribed WebSocket clients (topic `analytics`)
- `GET /api/analytics/events` - fetch the recent event log buffer

An optional Grafana instance (`docker-compose up -d grafana`, http://localhost:3001, default `admin`/`admin`) is provisioned with a PostgreSQL/TimescaleDB datasource and 4 starter dashboards (Tactical Ops, BDA, Logistics & Supply, Tactical Heatmaps) under `grafana/`.

## Project Structure

```
sharknet/
├── server/                 # Backend (Node.js/Express)
│   ├── routes/            # API routes
│   ├── services/          # Business logic
│   ├── models/            # Database models
│   ├── middleware/        # Authentication, etc.
│   └── index.js           # Server entry point
├── client/                # Frontend (React/Vue)
│   ├── src/
│   │   ├── components/    # React components
│   │   ├── pages/         # Page components
│   │   ├── services/      # API clients
│   │   └── App.jsx        # Root component
│   └── vite.config.js
├── docs/                  # Documentation
├── docker-compose.yml     # Docker orchestration
├── package.json
└── README.md
```

## Development

### Backend Development

```bash
# Install dependencies
cd server
npm install

# Start development server
npm run dev
```

### Frontend Development

```bash
# Install dependencies
cd client
npm install

# Start Vite development server
npm run dev
```

## Configuration

Key configuration files:
- `.env` - Environment variables
- `docker-compose.yml` - Docker services and networks
- `ARCHITECTURE.md` - System design details
- `API_INTEGRATIONS.md` - External API configuration

## Data Sources

### Weather & Terrain APIs
- **Open-Meteo** - Global forecasts and elevation data (no API key required)
- **MET Norway** - High-resolution Nordic/European forecasts
- **OpenWeatherMap** - Comprehensive global data

### Military Intelligence
- **ODIN** - Open source C2IS platform
- **Liveuamap** - Conflict data aggregation
- **Oryx** - Equipment loss tracking
- **ISW** - Military analysis reports

## Security

- End-to-end encryption for communications
- HTTPS/TLS for external connections
- Database encryption at rest
- API rate limiting
- CORS & CSRF protection
- Regular security audits
- AGPL-3.0 license ensures code remains open

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the GNU Affero General Public License v3.0 - see the [LICENSE](./LICENSE) file for details.

## Acknowledgments

- ODIN project (syncpoint.io)
- Open weather data providers
- Open source intelligence community

## Support

For issues, questions, or contributions, please visit:
- [GitHub Issues](https://github.com/CSTFitzy/sharknet/issues)
- [GitHub Discussions](https://github.com/CSTFitzy/sharknet/discussions)

---

**Disclaimer**: This system is designed for tactical planning and analysis using open-source data. Users are responsible for ensuring compliance with all applicable laws and regulations regarding military technology and intelligence analysis.
