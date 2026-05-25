# GeoTrack — Vehicle Geofencing System

A real-time vehicle tracking and geofencing platform built with Go (backend) and React (frontend).

🔗 **Live Demo:** [https://geo-track-rho.vercel.app](https://geo-track-rho.vercel.app)

---

## Features

* 🗺 **Live Map** — Real-time vehicle tracking on a dark interactive map
* ⬡ **Geofence Management** — Draw custom polygon zones with category tags
* 🚗 **Vehicle Management** — Register and track vehicles with driver info
* 🔔 **Live Alerts** — WebSocket-powered real-time entry/exit notifications
* 📍 **Pin & Relocate** — Click map to drop a pin, move any vehicle to that location
* 📊 **Dashboard** — Overview of zones, vehicles, and violation events
* 🚨 **Violation History** — Full log of geofence entry/exit events

---

## Tech Stack

| Layer      | Technology                                                |
| ---------- | --------------------------------------------------------- |
| Frontend   | React 18, Vite, React-Leaflet, Leaflet-Draw, Tailwind CSS |
| Backend    | Go 1.21, Gorilla Mux, WebSocket                           |
| Database   | Supabase (PostgreSQL + PostGIS)                           |
| Deployment | Vercel (frontend) · Render (backend)                      |
| Container  | Docker, Docker Compose                                    |

---

## Project Structure

```text
GeoTrack/
├── .env.example                 # Environment variable template
├── .gitignore
├── vercel.json                  # Vercel SPA rewrite rules
├── docker-compose.yml           # Local development orchestration
├── DEPLOYMENT.md                # Step-by-step deployment guide
│
├── backend/
│   ├── Dockerfile               # Multi-stage Go build
│   ├── go.mod
│   ├── go.sum
│   ├── main.go                  # Server entry point, routing, CORS
│   ├── migrations/
│   │   └── 001_init.sql         # Database schema (run once in Supabase)
│   └── internal/
│       ├── db/
│       │   ├── db.go            # Supabase connection (pgx, simple protocol)
│       │   └── user.go          # User queries
│       ├── errors/
│       │   └── errors.go        # Standardised error responses
│       ├── handlers/
│       │   ├── geofence.go      # Geofence CRUD
│       │   ├── vehicle.go       # Vehicle CRUD + location updates
│       │   ├── alert.go         # Alert rules + violation history
│       │   └── handlers_test.go
│       ├── logger/
│       │   └── logger.go        # Structured JSON logger
│       ├── middleware/
│       │   └── middleware.go    # Request logger, rate limiter
│       ├── models/
│       │   └── models.go        # Shared data structs
│       ├── validation/
│       │   ├── validation.go
│       │   └── validation_test.go
│       └── websocket/
│           └── hub.go           # WebSocket hub, client management
│
└── frontend/
    ├── Dockerfile               # Nginx static serve
    ├── nginx.conf               # SPA fallback config
    ├── index.html
    ├── package.json
    ├── vite.config.js
    ├── tailwind.config.js
    ├── postcss.config.js
    └── src/
        ├── App.jsx              # Routes (no auth — direct dashboard)
        ├── main.jsx
        ├── index.css            # Global styles + CSS variables
        ├── components/
        │   ├── Layout.jsx       # Sidebar, nav, WebSocket status
        │   └── MapEditor.jsx    # Reusable map components
        ├── context/
        │   ├── AuthContext.jsx  # Mock system user context
        │   └── ToastContext.jsx # Toast notification system
        ├── hooks/
        │   └── useAlertSocket.js # WebSocket connection + auto-reconnect
        ├── pages/
        │   ├── DashboardPage.jsx
        │   ├── MapPage.jsx      # Live map, draw geofences, pin & relocate
        │   ├── GeofencesPage.jsx
        │   ├── VehiclesPage.jsx
        │   ├── AlertsPage.jsx
        │   └── ViolationsPage.jsx
        └── services/
            └── api.js           # Axios instance, API helpers, WS URL
```

---

## Local Development

### Prerequisites

* Docker + Docker Compose
* Node.js 22+
* Go 1.21+

### 1. Clone and configure

```bash
git clone https://github.com/Pawan7578/GeoTrack.git
cd GeoTrack
cp .env.example .env
# Edit .env and fill in your values
```

### 2. Run with Docker Compose

```bash
docker compose up --build
```

| Service     | URL                                                                  |
| ----------- | -------------------------------------------------------------------- |
| Frontend    | [http://localhost:3000](http://localhost:3000)                       |
| Backend API | [http://localhost:8080/api/health](http://localhost:8080/api/health) |

### 3. Run without Docker

**Backend:**

```bash
cd backend
go mod download
go run main.go
```

**Frontend:**

```bash
cd frontend
npm install --legacy-peer-deps
npm run dev
```

---

## Environment Variables

All variables live in a single `.env` file at the repo root.

| Variable               | Description                  | Example                                                      |
| ---------------------- | ---------------------------- | ------------------------------------------------------------ |
| `DATABASE_URL`         | Supabase connection string   | `postgresql://...supabase.com:6543/postgres?sslmode=require` |
| `JWT_SECRET`           | Random secret string         | `openssl rand -hex 32`                                       |
| `CORS_ALLOWED_ORIGINS` | Allowed frontend origins     | `https://geo-track-rho.vercel.app`                           |
| `ALLOWED_WS_ORIGINS`   | Allowed WebSocket origins    | `https://geo-track-rho.vercel.app`                           |
| `PORT`                 | Backend server port          | `8080`                                                       |
| `HOST`                 | Backend bind address         | `0.0.0.0`                                                    |
| `VITE_API_URL`         | Backend API URL (build-time) | `https://your-backend.onrender.com/api`                      |
| `VITE_WS_URL`          | WebSocket URL (build-time)   | `wss://your-backend.onrender.com`                            |

> **Production:** Set backend vars in Render dashboard. Set `VITE_*` vars in Vercel dashboard.

---

## Database Setup

Schema is in `backend/migrations/001_init.sql`.

Run it **once** in the Supabase SQL Editor — no migration runner needed at runtime.

Supabase connection notes:

* Use **Transaction Pooler** URL (port `6543`) — Render blocks port `5432`
* The backend uses `pgx` with `QueryExecModeSimpleProtocol` to disable prepared statements (required for PgBouncer compatibility)

---

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the full step-by-step guide.

| Service  | Platform | Notes                           |
| -------- | -------- | ------------------------------- |
| Frontend | Vercel   | Auto-deploys from `main` branch |
| Backend  | Render   | Docker runtime, free tier       |
| Database | Supabase | PostgreSQL + PostGIS            |

---

## API Endpoints

| Method   | Path                          | Description             |
| -------- | ----------------------------- | ----------------------- |
| `GET`    | `/api/health`                 | Health check            |
| `GET`    | `/api/geofences`              | List geofences          |
| `POST`   | `/api/geofences`              | Create geofence         |
| `PUT`    | `/api/geofences/{id}`         | Update geofence         |
| `DELETE` | `/api/geofences/{id}`         | Delete geofence         |
| `GET`    | `/api/vehicles`               | List vehicles           |
| `POST`   | `/api/vehicles`               | Register vehicle        |
| `DELETE` | `/api/vehicles/{id}`          | Delete vehicle          |
| `POST`   | `/api/vehicles/location`      | Update vehicle location |
| `GET`    | `/api/vehicles/location/{id}` | Get vehicle location    |
| `GET`    | `/api/alerts`                 | List alert rules        |
| `POST`   | `/api/alerts/configure`       | Create alert rule       |
| `DELETE` | `/api/alerts/{id}`            | Delete alert rule       |
| `DELETE` | `/api/alerts`                 | Clear all alerts        |
| `GET`    | `/api/violations/history`     | Violation event log     |
| `GET`    | `/ws/alerts`                  | WebSocket — live alerts |

---

## Known Limitations

* No authentication — direct dashboard access (by design)
* Render free tier sleeps after 15 min inactivity — first request may take ~30s
* Supabase free plan: 60 pooler connections max

---

## License

MIT
