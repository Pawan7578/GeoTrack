import { useState, useEffect } from 'react'
import { alertAPI, geofenceAPI, vehicleAPI } from '../services/api'
import { useToast } from '../context/ToastContext'
import { formatDistanceToNow } from 'date-fns'

const EVENT_BADGE = { entry: 'badge-emerald', exit: 'badge-rose', both: 'badge-amber' }

export default function AlertsPage() {
  const { error, success } = useToast()
  const [alerts,    setAlerts]    = useState([])
  const [total,     setTotal]     = useState(0)
  const [geofences, setGeofences] = useState([])
  const [vehicles,  setVehicles]  = useState([])
  const [loading,   setLoading]   = useState(true)
  const [showForm,  setShowForm]  = useState(false)
  const [form,      setForm]      = useState({ geofence_id: '', vehicle_id: '', event_type: 'both' })
  const [saving,    setSaving]    = useState(false)
  const [page,      setPage]      = useState(0)
  const LIMIT = 20

  useEffect(() => {
    Promise.all([
      geofenceAPI.list({ limit: 200 }),
      vehicleAPI.list({ limit: 200 }),
    ]).then(([gRes, vRes]) => {
      setGeofences(gRes.data.data.geofences ?? [])
      setVehicles(vRes.data.data.vehicles ?? [])
    })
  }, [])

  const fetchAlerts = async () => {
    setLoading(true)
    try {
      const res = await alertAPI.list({ limit: LIMIT, offset: page * LIMIT })
      setAlerts(res.data.data.alerts ?? [])
      setTotal(res.data.data.total_count ?? 0)
    } catch { error('Failed to load alerts') }
    finally { setLoading(false) }
  }

  useEffect(() => { fetchAlerts() }, [page])

  const handleCreate = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await alertAPI.configure({
        geofence_id: form.geofence_id,
        vehicle_id: form.vehicle_id || null,
        event_type: form.event_type,
      })
      success('Alert rule configured')
      setShowForm(false)
      setForm({ geofence_id: '', vehicle_id: '', event_type: 'both' })
      fetchAlerts()
    } catch (err) {
      error(err.response?.data?.error?.message || 'Failed to configure alert')
    } finally { setSaving(false) }
  }

  const gfName = (id) => geofences.find((g) => g.id === id)?.name ?? id?.slice(0, 8) ?? '—'
  const vName  = (id) => id ? (vehicles.find((v) => v.id === id)?.vehicle_number ?? id?.slice(0, 8)) : 'All vehicles'

  const handleClearAllAlerts = async () => {
    if (!window.confirm('Clear all alert rules? This cannot be undone.')) return
    try {
      await alertAPI.clearAll()
      success('All alerts cleared')
      // Dispatch event to reset alert count in sidebar
      window.dispatchEvent(new Event('alerts-cleared'))
      localStorage.setItem('alerts-cleared', Date.now())
      fetchAlerts()
    } catch (err) {
      error(err.response?.data?.error?.message || 'Failed to clear all alerts')
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface-800)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 20 }}>Alert Rules</h1>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>{total} rules configured</p>
          </div>
          <div style={{ flex: 1 }} />
          {total > 0 && (
            <button className="btn btn-secondary" onClick={handleClearAllAlerts} style={{ fontSize: 13 }}>
              🗑 Clear All
            </button>
          )}
          <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)} style={{ fontSize: 13 }}>
            {showForm ? '✕ Close' : '+ New Alert Rule'}
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} style={{
          padding: '20px 24px', borderBottom: '1px solid var(--border)',
          background: 'rgba(245,158,11,0.03)', flexShrink: 0,
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 12, alignItems: 'flex-end' }}>
            <div>
              <label style={labelStyle}>Geofence *</label>
              <select className="input-field" value={form.geofence_id}
                onChange={(e) => setForm({ ...form, geofence_id: e.target.value })}
                style={{ cursor: 'pointer' }} required>
                <option value="">Select geofence…</option>
                {geofences.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Vehicle (optional)</label>
              <select className="input-field" value={form.vehicle_id}
                onChange={(e) => setForm({ ...form, vehicle_id: e.target.value })}
                style={{ cursor: 'pointer' }}>
                <option value="">All vehicles</option>
                {vehicles.map((v) => <option key={v.id} value={v.id}>{v.vehicle_number}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Trigger on</label>
              <select className="input-field" value={form.event_type}
                onChange={(e) => setForm({ ...form, event_type: e.target.value })}
                style={{ cursor: 'pointer' }}>
                <option value="both">Entry & Exit</option>
                <option value="entry">Entry only</option>
                <option value="exit">Exit only</option>
              </select>
            </div>
            <button className="btn btn-primary" type="submit" disabled={saving} style={{ marginBottom: 0 }}>
              {saving ? 'Saving…' : 'Save Rule'}
            </button>
          </div>
        </form>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px 24px' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>
        ) : alerts.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)' }}>
            No alert rules configured yet.
          </div>
        ) : (
          <>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, marginTop: 16 }}>
              <thead>
                <tr>
                  {['Geofence', 'Vehicle scope', 'Trigger', 'Status', 'Created'].map((h) => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {alerts.map((a) => (
                  <tr key={a.alert_id}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-700)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    style={{ transition: 'background 0.15s' }}
                  >
                    <td style={tdStyle}><span style={{ fontWeight: 500 }}>{gfName(a.geofence_id)}</span></td>
                    <td style={tdStyle}><span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--text-secondary)' }}>{vName(a.vehicle_id)}</span></td>
                    <td style={tdStyle}><span className={`badge ${EVENT_BADGE[a.event_type]}`}>{a.event_type}</span></td>
                    <td style={tdStyle}><span className={`badge ${a.status === 'active' ? 'badge-emerald' : 'badge-muted'}`}>{a.status}</span></td>
                    <td style={tdStyle}><span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} setPage={setPage} total={total} limit={LIMIT} />
          </>
        )}
      </div>
    </div>
  )
}

const labelStyle = { display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 500 }
const thStyle = { textAlign: 'left', padding: '8px 16px', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--border)', background: 'var(--surface-800)', position: 'sticky', top: 0 }
const tdStyle = { padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 13 }

function Pagination({ page, setPage, total, limit }) {
  const pages = Math.ceil(total / limit)
  if (pages <= 1) return null
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 16 }}>
      <button className="btn btn-secondary" disabled={page === 0} onClick={() => setPage(page - 1)} style={{ padding: '6px 12px', fontSize: 13 }}>← Prev</button>
      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Page {page + 1} of {pages}</span>
      <button className="btn btn-secondary" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} style={{ padding: '6px 12px', fontSize: 13 }}>Next →</button>
    </div>
  )
}
