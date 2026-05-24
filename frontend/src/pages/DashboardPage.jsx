import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { geofenceAPI, vehicleAPI, violationAPI, alertAPI } from '../services/api'
import { useToast } from '../context/ToastContext'
import { formatDistanceToNow } from 'date-fns'

// How many times to retry before giving up and showing an error toast.
const MAX_RETRIES = 3
// Delay between retries when the backend appears to be waking up (ms).
const WAKING_RETRY_DELAY = 6000

export default function DashboardPage() {
  const { error: showError } = useToast()

  const [stats,        setStats]       = useState(null)
  const [recentEvents, setEvents]      = useState([])
  const [loading,      setLoading]     = useState(true)
  const [isWaking,     setIsWaking]    = useState(false)
  const [retryCount,   setRetryCount]  = useState(0)

  const fetchData = useCallback(async (attempt = 0) => {
    setLoading(true)

    try {
      const [gRes, vRes, evRes, aRes] = await Promise.all([
        geofenceAPI.list({ limit: 1 }),
        vehicleAPI.list({ limit: 1 }),
        violationAPI.history({ limit: 5 }),
        alertAPI.list({ limit: 1 }),
      ])

      setStats({
        geofences:  gRes.data.data.total_count  ?? gRes.data.data.count,
        vehicles:   vRes.data.data.total_count  ?? vRes.data.data.count,
        violations: evRes.data.data.total_count ?? evRes.data.data.count,
        alerts:     aRes.data.data.total_count  ?? aRes.data.data.count,
      })
      setEvents(evRes.data.data.violations ?? [])
      setIsWaking(false)

    } catch (err) {
      // If the error looks like a cold-start (timeout / 503 / 504), retry
      // automatically with a delay and show a friendly banner instead of
      // an error toast.
      if (err.isBackendWaking && attempt < MAX_RETRIES) {
        setIsWaking(true)
        setRetryCount(attempt + 1)
        setTimeout(() => fetchData(attempt + 1), WAKING_RETRY_DELAY)
        return
      }

      setIsWaking(false)
      showError('Failed to load dashboard data')
    } finally {
      setLoading(false)
    }
  }, [showError])

  useEffect(() => { fetchData() }, [fetchData])

  const statCards = [
    { label: 'Geofences',   value: stats?.geofences,  color: '#f59e0b', to: '/geofences',  icon: '⬡' },
    { label: 'Vehicles',    value: stats?.vehicles,   color: '#10b981', to: '/vehicles',   icon: '⬡' },
    { label: 'Alert Rules', value: stats?.alerts,     color: '#0ea5e9', to: '/alerts',     icon: '⬡' },
    { label: 'Events',      value: stats?.violations, color: '#f43f5e', to: '/violations', icon: '⬡' },
  ]

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 28 }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ margin: 0, fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 24, letterSpacing: '-0.02em' }}>
          Dashboard
        </h1>
        <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>
          System overview and recent activity
        </p>
      </div>

      {/* Cold-start banner */}
      {isWaking && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 16px', marginBottom: 20,
          background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)',
          borderRadius: 8, fontSize: 13, color: 'var(--text-secondary)',
        }}>
          <span style={{ fontSize: 18 }}>☕</span>
          <div>
            <strong style={{ color: 'var(--amber)' }}>Backend is waking up…</strong>
            <span style={{ marginLeft: 6 }}>
              The server was sleeping. Retrying automatically ({retryCount}/{MAX_RETRIES})
            </span>
          </div>
        </div>
      )}

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, marginBottom: 32 }}>
        {statCards.map(({ label, value, color, to }) => (
          <Link key={label} to={to} className="card card-hover stat-card" style={{
            padding: 20, textDecoration: 'none', display: 'block',
          }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
              {label}
            </div>
            <div style={{ fontSize: 36, fontWeight: 700, fontFamily: 'Syne, sans-serif', color, lineHeight: 1 }}>
              {loading ? <Skeleton w={60} h={36} /> : (value ?? '—')}
            </div>
          </Link>
        ))}
      </div>

      {/* Quick actions */}
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600, color: 'var(--text-secondary)' }}>
          Quick actions
        </h2>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link to="/map"       className="btn btn-primary">Open Live Map</Link>
          <Link to="/geofences" className="btn btn-secondary">+ New Geofence</Link>
          <Link to="/vehicles"  className="btn btn-secondary">+ Register Vehicle</Link>
        </div>
      </div>

      {/* Recent events */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text-secondary)' }}>Recent events</h2>
          <Link to="/violations" style={{ fontSize: 13, color: 'var(--amber)', textDecoration: 'none' }}>View all →</Link>
        </div>
        <div className="card" style={{ overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: 14 }}>Loading…</div>
          ) : recentEvents.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
              No events recorded yet
            </div>
          ) : (
            recentEvents.map((ev, i) => (
              <div key={ev.id} style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '14px 20px',
                borderBottom: i < recentEvents.length - 1 ? '1px solid var(--border)' : 'none',
              }}>
                <span className={`badge ${ev.event_type === 'entry' ? 'badge-emerald' : 'badge-rose'}`}>
                  {ev.event_type === 'entry' ? '▲ Entry' : '▼ Exit'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
                    {ev.vehicle_number}
                    <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> → </span>
                    {ev.geofence_name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', marginTop: 2 }}>
                    {ev.latitude?.toFixed(5)}, {ev.longitude?.toFixed(5)}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
                  {formatDistanceToNow(new Date(ev.timestamp), { addSuffix: true })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function Skeleton({ w, h }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: 6,
      background: 'linear-gradient(90deg, var(--surface-600) 25%, var(--surface-500) 50%, var(--surface-600) 75%)',
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.2s infinite',
    }} />
  )
}
