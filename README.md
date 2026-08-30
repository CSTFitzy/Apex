# Apex

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

<img src="assets/icons/apex-logo.svg" alt="Apex logo" width="96" height="96" />

Open-source tactical management system utilizing ODIN, military intelligence data, and meteorological APIs for strategic planning and terrain analysis.

Logo assets (SVG, PNG in 16-512px, and Windows `.ico`) are available in [`assets/icons/`](./assets/icons).

## Features

- **Tactical Mapping** - ODIN integration with MIL-STD-2525C military symbology
- **Real-time Collaboration** - Distributed command & control via Matrix protocol
- **Tactical Comms** - WebRTC push-to-talk radio nets and encrypted real-time messaging
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

- **Interactive Tactical Map** - pan/zoom anywhere and toggle OSM/topographical/satellite base layers plus a military grid overlay.
- **Operating Area (AO) Drawing Tools** - the on-map drawing panel lets you define the AO as a rectangle (click-drag), a circle (click centre, drag radius) or a freehand polygon (click each vertex, double-click or press Enter to close). The AO outline, area, perimeter, centroid and bounds are shown in the operational picture panel, the AO persists while you switch tools, and a Clear button resets it. Weather analysis automatically focuses on the AO centroid and terrain analysis is scoped to the AO bounds.
- **Line-of-Sight Visibility Circle** - the LOS tool places an observer (eye height fixed at 1.5 m AGL) and expands a circle as you drag outward. Terrain that is visible from the observer is shaded green, terrain in shadow red, with the radius, observer coordinates, visible/blocked sample counts and visible-area percentage reported live. Multiple observers can be placed to compare coverage, and Clear LOS resets the analysis.
- **Weather Analysis** - `GET /api/weather?lat=&lon=` and `/api/weather/history` proxy Open-Meteo (current conditions, 7-day forecast, historical archive) and compute an operational impact rating (LOW/MODERATE/HIGH/SEVERE) from visibility, wind, precipitation and cloud cover.
- **Terrain Analysis** - `GET /api/terrain/spot-heights`, `POST /api/terrain/los`, `POST /api/terrain/viewshed`, `POST /api/terrain/slope` and `POST /api/terrain/report` use free SRTM/Copernicus elevation data (via Open-Meteo's elevation API) to auto-identify key terrain (spot heights), compute line-of-sight between any two points (curvature/refraction corrected), generate a simplified 360° viewshed, and produce a full terrain report with inter-visibility between all spot heights in the AO.
- **Operational Orders Processing** - `POST /api/documents/upload` accepts PDF/DOCX/TXT orders, extracts text, and runs rule-based NLP to identify coordinates, enemy/friendly force mentions, mission objectives and key terms, then matches the findings against a simulated ODIN-style doctrine database.
- **Enemy Force Planning** - `POST /api/enemy/counter-plan` combines the matched doctrine profiles with your friendly force disposition to generate a threat assessment (with probability of success) and a counter-plan narrative with recommended actions.
- **Tactical Communications** - the Comms tab provides a WebRTC push-to-talk radio net (Opus voice, squelch/static, 1-5 bar signal strength derived from distance, terrain, weather and altitude) alongside an encrypted real-time tactical messaging system. See [Tactical Communications](#tactical-communications) below.
- **Real-Time Simulation** - the Simulation tab renders friendly/hostile units with NATO APP-6D symbology (via `milsymbol`) and lets you Play/Pause real-time unit movement, with automatic engagement resolution and a narration log describing enemy actions.

## Tactical Communications

Phase 2 adds a full military communications platform: WebRTC tactical radio plus
real-time encrypted messaging, both integrated with the simulation engine.

### Radio nets (WebRTC voice)

- Peer-to-peer mesh audio using the Opus codec, negotiated through a Socket.IO
  signalling gateway (`webrtc:offer` / `webrtc:answer` / `webrtc:ice-candidate`).
  ICE servers are served by `GET /api/webrtc/config` (STUN by default; set
  `TURN_URL`/`TURN_USERNAME`/`TURN_CREDENTIAL` for NAT/firewall traversal).
- Six default nets are provisioned (Battalion, Company, Platoon, Fires, Medical
  and an unencrypted Guard net). Stations join, leave and switch nets, and the
  channel directory shows membership, status (IDLE / BUSY / COMPROMISED) and the
  active speaker.
- Half-duplex push-to-talk: the server grants the net to one transmitter at a
  time. The receiving end applies synthesised squelch/static scaled to the
  measured link quality.
- `POST /api/comms/signal` evaluates link quality from distance, terrain
  obstruction, precipitation/humidity, altitude difference and co-channel
  interference, returning signal bars, an EXCELLENT/GOOD/FAIR/POOR/LOST rating
  and an intercept-risk score used to warn about hostile SIGINT.
- Every transmission is recorded to a voice log (speaker, timestamp, duration,
  quality) for after-action replay and export.

### Tactical messaging

- Five structured message templates - Intel Report, Order, Casualty Report
  (CASREP), Support Request and Situation Report - plus free-form messages, each
  with a ROUTINE / PRIORITY / IMMEDIATE / FLASH precedence.
- Real-time delivery over Socket.IO with typing indicators, delivery and read
  receipts, unread badges, offline queuing and mandatory acknowledgement for
  IMMEDIATE and FLASH traffic.
- Filtering, keyword search, sorting and CSV/JSON export of the message log.
- Direct, broadcast and net-wide addressing, with role-based access control
  (COMMANDER / OFFICER / OPERATOR) enforced on message types.

### Security

- Messages are sealed with AES-256-GCM at rest using a rotating HKDF keyring
  (`COMMS_ENCRYPTION_KEY`, rotated every `COMMS_KEY_ROTATION_MS`) and carry an
  HMAC signature so tampering is detectable via `GET /api/messages/:id`.
- Direct messages are additionally end-to-end encrypted in the browser using
  WebCrypto ECDH (P-256) + AES-256-GCM, so the server only ever stores
  ciphertext.
- Stations authenticate via `POST /api/comms/auth` (JWT) before joining a net,
  and every send/read/acknowledge action is written to an audit trail
  (`GET /api/comms/audit`).

### API surface

| Endpoint | Purpose |
| --- | --- |
| `POST /api/comms/auth` | Issue a comms token for a callsign/role |
| `GET/POST /api/comms/channels` | List or create radio nets |
| `POST /api/comms/channels/:id/join`, `/leave` | Net membership |
| `GET /api/comms/presence` | Online/offline station roster |
| `POST /api/comms/signal` | Evaluate radio link quality |
| `GET/POST /api/comms/voice-logs` | Voice log retrieval and recording |
| `GET /api/comms/voice-logs/export` | Export radio traffic transcripts |
| `GET /api/comms/audit` | Communications audit trail |
| `GET /api/comms/keys`, `POST /api/comms/keys/rotate` | Key management |
| `GET /api/messages/templates` | Structured message templates |
| `GET /api/messages` | Filter/search/sort the message log |
| `GET /api/messages/export` | CSV/JSON export |
| `POST /api/messages` | Send a message |
| `PUT /api/messages/:id/read`, `POST /api/messages/:id/ack` | Receipts |
| `GET /api/webrtc/config` | ICE servers and audio constraints |
| `POST /api/webrtc/signal` | HTTP signalling fallback |

Socket.IO events: `comms:identify`, `channel:join`, `channel:leave`,
`channel:ptt`, `voice:log`, `message:send`, `message:read`, `message:ack`,
`typing:indicator`, `comms:heartbeat`, `webrtc:offer`, `webrtc:answer`,
`webrtc:ice-candidate`.

### Persistence

Comms state is authoritative in memory so the system runs with no external
services. When PostgreSQL is configured, messages, radio channels, voice logs
and the audit trail are written through to `messages`, `radio_channels`,
`voice_logs` and `comms_audit` (created automatically on boot). When Redis is
available it is used for presence, channel state, the offline message queue and
per-station rate limiting. Retention is configurable via
`COMMS_RETENTION_DAYS`.

### Simulation integration

Combat events raise automatic radio traffic (contact reports, CASREPs, and FLASH
SITREPs when a unit becomes combat ineffective), and inbound messages drive the
simulation: an intel report containing a grid reference spawns a hostile
contact, a CASREP attrits the named unit, and a withdraw/retreat order changes
that unit's behaviour. Transmitting stations are drawn on the tactical map with
a signal-coverage circle.

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
apex/
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

## Desktop Application (Electron)

Apex can also run as a native desktop application, with its own window, icon, and taskbar entry - no browser or terminal windows required.

### Run in development mode

```bash
npm install
npm run electron
```

This installs nothing extra beyond the root `npm install` and will automatically:
- Start the Express backend server
- Start the Vite frontend dev server
- Open the Apex desktop window once both are ready

### One-click launcher (Windows)

Double-click `Apex.bat` in the repository root. It installs dependencies on first run and then launches the desktop app.

### Build a standalone Windows executable

```bash
npm run electron:build
```

Produces a portable `Apex-Portable-<version>.exe` in `release/` that runs without installation.

### Build a Windows installer

```bash
npm run electron:dist
```

Produces an `Apex-Setup-<version>.exe` NSIS installer in `release/` that installs Apex with a Start Menu and desktop shortcut.

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
