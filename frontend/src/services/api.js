import axios from 'axios'

// ── URL normalisation ─────────────────────────────────────────────────────────

const normalizeApiBaseUrl = (rawUrl) => {
  if (!rawUrl) return '/api'
  const trimmed = rawUrl.replace(/\/+$/, '')
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`
}

const normalizeWsBaseUrl = (rawUrl) => {
  if (!rawUrl) {
    const apiBase = import.meta.env.VITE_API_URL || ''
    if (apiBase) {
      try {
        const { protocol, host } = new URL(apiBase)
        const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:'
        return `${wsProtocol}//${host}`
      } catch {}
    }

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    return `${protocol}://${window.location.host}`
  }
  return rawUrl.replace(/\/+$/, '')
}

const BASE_URL = normalizeApiBaseUrl(import.meta.env.VITE_API_URL)

// ── Axios instance ────────────────────────────────────────────────────────────

const api = axios.create({
  baseURL: BASE_URL,
  // 20-second timeout so the UI detects Render cold-start failures quickly
  // rather than hanging indefinitely.
  timeout: 20000,
})

// ── Response interceptor — cold-start / unavailable detection ─────────────────
// When the Render free-tier backend is sleeping, the first request returns a
// network timeout or a 503/504.  We attach a `isBackendWaking` flag to the
// error so pages can show a friendly "Backend waking up…" message.

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status
    const isWakingUp =
      error.code === 'ECONNABORTED' ||  // axios timeout
      error.code === 'ERR_NETWORK'   ||  // network unreachable
      status === 503                 ||  // service unavailable
      status === 504                     // gateway timeout

    error.isBackendWaking = isWakingUp
    return Promise.reject(error)
  }
)

// ── API helpers ───────────────────────────────────────────────────────────────

export const geofenceAPI = {
  list:   (params)     => api.get('/geofences', { params }),
  create: (body)       => api.post('/geofences', body),
  update: (id, body)   => api.put(`/geofences/${id}`, body),
  delete: (id)         => api.delete(`/geofences/${id}`),
}

export const vehicleAPI = {
  list:           (params)     => api.get('/vehicles', { params }),
  create:         (body)       => api.post('/vehicles', body),
  delete:         (id)         => api.delete(`/vehicles/${id}`),
  updateLocation: (body)       => api.post('/vehicles/location', body),
  getLocation:    (id)         => api.get(`/vehicles/location/${id}`),
}

export const alertAPI = {
  list:      (params) => api.get('/alerts', { params }),
  configure: (body)   => api.post('/alerts/configure', body),
  delete:    (id)     => api.delete(`/alerts/${id}`),
  clearAll:  ()       => api.delete('/alerts'),
}

export const violationAPI = {
  history: (params) => api.get('/violations/history', { params }),
}

// ── WebSocket URL ─────────────────────────────────────────────────────────────

export const getWsUrl = () => {
  const wsBase = normalizeWsBaseUrl(import.meta.env.VITE_WS_URL)
  return `${wsBase}/ws/alerts`
}

export default api
