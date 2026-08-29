# Sharknet

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

Open-source tactical management system utilizing ODIN, military intelligence data, and meteorological APIs for strategic planning and terrain analysis.

## Features

- **Tactical Mapping** - ODIN integration with MIL-STD-2525C military symbology
- **Real-time Collaboration** - Distributed command & control via Matrix protocol
- **Weather Integration** - Multi-source meteorological data (Open-Meteo, MET Norway, OpenWeatherMap)
- **OSINT Data** - Open-source intelligence aggregation and analysis
- **Threat Visualization** - Heatmaps, timeline analysis, equipment tracking
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
   git clone https://github.com/CSTFitzy/sharknet.git
   cd sharknet
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

## Core Tactical Capabilities

This build wires the full tactical decision-support workflow together end-to-end:

- **Interactive Tactical Map** - pan/zoom anywhere, toggle OSM/topographical/satellite base layers plus a military grid overlay, and draw an operational area (AO) boundary directly on the map.
- **Weather Analysis** - `GET /api/weather?lat=&lon=` and `/api/weather/history` proxy Open-Meteo (current conditions, 7-day forecast, historical archive) and compute an operational impact rating (LOW/MODERATE/HIGH/SEVERE) from visibility, wind, precipitation and cloud cover.
- **Terrain Analysis** - `GET /api/terrain/spot-heights`, `POST /api/terrain/los`, `POST /api/terrain/viewshed`, `POST /api/terrain/slope` and `POST /api/terrain/report` use free SRTM/Copernicus elevation data (via Open-Meteo's elevation API) to auto-identify key terrain (spot heights), compute line-of-sight between any two points (curvature/refraction corrected), generate a simplified 360° viewshed, and produce a full terrain report with inter-visibility between all spot heights in the AO.
- **Operational Orders Processing** - `POST /api/documents/upload` accepts PDF/DOCX/TXT orders, extracts text, and runs rule-based NLP to identify coordinates, enemy/friendly force mentions, mission objectives and key terms, then matches the findings against a simulated ODIN-style doctrine database.
- **Enemy Force Planning** - `POST /api/enemy/counter-plan` combines the matched doctrine profiles with your friendly force disposition to generate a threat assessment (with probability of success) and a counter-plan narrative with recommended actions.
- **Real-Time Simulation** - the Simulation tab renders friendly/hostile units with NATO APP-6D symbology (via `milsymbol`) and lets you Play/Pause real-time unit movement, with automatic engagement resolution and a narration log describing enemy actions.

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed system design and technology stack.

## API Integration

See [API_INTEGRATIONS.md](./API_INTEGRATIONS.md) for code examples and integration guides for:
- ODIN Command & Control
- Weather APIs (Open-Meteo, MET Norway, OpenWeatherMap)
- OSINT Data Sources (Liveuamap, Oryx, ISW)

## Visualization

See [VISUALIZATION.md](./VISUALIZATION.md) for data visualization and mapping library recommendations including:
- Leaflet.js for tactical mapping
- Mapbox GL for advanced features
- Chart.js for dashboards
- Cesium.js for 3D terrain visualization

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

### Weather APIs
- **Open-Meteo** - Global forecasts (no API key required)
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
