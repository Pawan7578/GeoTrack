# GeoTrack — Deployment Guide

This guide covers deploying GeoTrack to **Render** (backend + Postgres) and **Vercel** (frontend).

---

## Prerequisites

- Render account → https://render.com
- Vercel account → https://vercel.com
- GitHub repo with this codebase pushed

---

## Step 1 — Backend on Render

### 1.1 Create a PostgreSQL database

1. Render dashboard → **New → PostgreSQL**
2. Name it `geotrack-db`, choose the free plan
3. Once created, copy the **External Database URL** — you'll need it next

### 1.2 Create the backend Web Service

1. Render dashboard → **New → Web Service**
2. Connect your GitHub repo, set **Root Directory** to `backend`
3. Runtime: **Docker**
4. Set these **Environment Variables** in the Render dashboard:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | Paste the Internal Database URL from step 1.1 |
| `JWT_SECRET` | A long random string (generate with `openssl rand -hex 32`) |
| `CORS_ALLOWED_ORIGINS` | Your Vercel frontend URL (fill in after Step 2) |
| `ALLOWED_WS_ORIGINS` | Same as above |
| `PORT` | `8080` |

> ⚠️ **Do NOT hardcode these values in code.** Set them only in the Render dashboard.

5. Deploy. Note the service URL — e.g. `https://geotrack-xxxx.onrender.com`

---

## Step 2 — Frontend on Vercel

### 2.1 Create Vercel Environment Variables

In the Vercel dashboard for your project → **Settings → Environment Variables**:

| Key | Value |
|-----|-------|
| `VITE_API_URL` | `https://geotrack-xxxx.onrender.com/api` |
| `VITE_WS_URL` | `wss://geotrack-xxxx.onrender.com` |

Replace `geotrack-xxxx` with your actual Render service subdomain.

### 2.2 Deploy

Vercel auto-deploys from your GitHub main branch.
The `vercel.json` already handles:
- Build command and output directory
- **SPA rewrites** so React Router routes don't 404

> After the first deploy, copy the Vercel URL (e.g. `https://geotrack.vercel.app`).

---

## Step 3 — Wire CORS back to Render

Return to your Render backend service → **Environment** and update:

| Key | Value |
|-----|-------|
| `CORS_ALLOWED_ORIGINS` | `https://geotrack.vercel.app` |
| `ALLOWED_WS_ORIGINS` | `https://geotrack.vercel.app` |

Then **Manual Deploy → Deploy latest commit** to pick up the new env vars.

---

## Step 4 — Smoke test

1. Open `https://geotrack.vercel.app/` — Dashboard should load
2. Navigate to `/map`, `/vehicles`, `/geofences` directly — no 404s
3. Real-time alerts (WebSocket) should show "connected" in the Layout header

---

## Local Development (Docker Compose)

There is a single `.env` file at the repo root used by every service.

```bash
# 1. Copy the example and fill in your values
cp .env.example .env

# 2. Start all services (Postgres, backend, frontend)
docker compose up --build

# 3. Frontend: http://localhost:3000
# 4. Backend:  http://localhost:8080/api/health
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Direct URLs (`/map`) return 404 on Vercel | Missing SPA rewrite | Verify `vercel.json` has the `rewrites` block |
| API calls fail (CORS error in browser console) | CORS env var not set or mismatched | Check `CORS_ALLOWED_ORIGINS` on Render matches your exact Vercel URL |
| WebSocket stuck on "connecting" | `ALLOWED_WS_ORIGINS` mismatch or backend sleeping | Check env var; wait for Render cold-start (free tier sleeps after 15 min) |
| Dashboard shows "Backend waking up…" banner | Render free tier cold start | Wait ~45 seconds; it retries automatically |
| DB migration fails on deploy | Wrong DATABASE_URL | Confirm you used the **Internal** URL (not External) in Render |
