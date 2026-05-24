import { useState, useEffect } from 'react'
import { violationAPI, vehicleAPI, geofenceAPI } from '../services/api'
import { useToast } from '../context/ToastContext'
import { format } from 'date-fns'

export default function ViolationsPage() {
  const { error } = useToast()
  const [violations, setViolations] = useState([])
  const [total,      setTotal]      = useState(0)
  const [loading,    setLoading]    = useState(true)
  const [vehicles,   setVehicles]   = useState([])
  const [geofences,  setGeofences]  = useState([])
  const [filters,    setFilters]    = useState({ vehicle_id: '', geofence_id: '', start_date: '', end_date: '' })
  const [page,       setPage]       = useState(0)
  const LIMIT = 30

  useEffect(() => {
    Promise.all([
      vehicleAPI.list({ limit: 200 }),
      geofenceAPI.list({ limit: 200 }),
    ]).then(([vRes, gRes]) => {
      setVehicles(vRes.data.data.vehicles ?? [])
      setGeofences(gRes.data.data.geofences ?? [])
    })
  }, [])

  const fetchViolations = async () => {
    setLoading(true)
    try {
      const params = { limit: LIMIT, offset: page * LIMIT }
      if (filters.vehicle_id)  params.vehicle_id  = filters.vehicle_id
      if (filters.geofence_id) params.geofence_id = filters.geofence_id
      if (filters.start_date)  params.start_date  = filters.start_date
      if (filters.end_date)    params.end_date    = filters.end_date
      const res = await violationAPI.history(params)
      setViolations(res.data.data.violations ?? [])
      setTotal(res.data.data.total_count ?? 0)
    } catch { error('Failed to load violation history') }
    finally { setLoading(false) }
  }

  useEffect(() => { fetchViolations() }, [page, filters])

  const clearFilters = () => {
    setFilters({ vehicle_id: '', geofence_id: '', start_date: '', end_date: '' })
    setPage(0)
  }

  const activeFilters = Object.values(filters).filter(Boolean).length

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface-800)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 20 }}>Violation History</h1>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
              {total} events recorded
              {activeFilters > 0 && <span style={{ color: 'var(--amber)', marginLeft: 8 }}>({activeFilters} filter{activeFilters > 1 ? 's' : ''} active)</span>}
            </p>
          </div>
          <div style={{ flex: 1 }} />
          {activeFilters > 0 && (
            <button className="btn btn-secondary" onClick={clearFilters} style={{ fontSize: 12 }}>Clear filters</button>
          )}
        </div>

        {/* Filters row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
          <div>
            <label style={labelStyle}>Vehicle</label>
            <select className="input-field" value={filters.vehicle_id}
              onChange={(e) => { setFilters({ ...filters, vehicle_id: e.target.value }); setPage(0) }}
              style={{ cursor: 'pointer' }}>
              <option value="">All vehicles</option>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.vehicle_number}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Geofence</label>
            <select className="input-field" value={filters.geofence_id}
              onChange={(e) => { setFilters({ ...filters, geofence_id: e.target.value }); setPage(0) }}
              style={{ cursor: 'pointer' }}>
              <option value="">All geofences</option>
              {geofences.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>From date</label>
            <input className="input-field" type="date" value={filters.start_date}
              onChange={(e) => { setFilters({ ...filters, start_date: e.target.value }); setPage(0) }} />
          </div>
          <div>
            <label style={labelStyle}>To date</label>
            <input className="input-field" type="date" value={filters.end_date}
              onChange={(e) => { setFilters({ ...filters, end_date: e.target.value }); setPage(0) }} />
          </div>
        </div>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px 24px' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>
        ) : violations.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🛡</div>
            <div>No events found{activeFilters > 0 ? ' for the selected filters' : ' yet'}</div>
          </div>
        ) : (
          <>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, marginTop: 16 }}>
              <thead>
                <tr>
                  {['Event', 'Vehicle', 'Geofence', 'Coordinates', 'Time'].map((h) => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {violations.map((v) => (
                  <tr key={v.id}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-700)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    style={{ transition: 'background 0.15s' }}
                  >
                    <td style={tdStyle}>
                      <span className={`badge ${v.event_type === 'entry' ? 'badge-emerald' : 'badge-rose'}`}>
                        {v.event_type === 'entry' ? '▲ Entry' : '▼ Exit'}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: 'var(--amber)', fontWeight: 500 }}>
                        {v.vehicle_number}
                      </span>
                    </td>
                    <td style={tdStyle}><span style={{ fontWeight: 500 }}>{v.geofence_name}</span></td>
                    <td style={tdStyle}>
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--text-secondary)' }}>
                        {v.latitude?.toFixed(5)}, {v.longitude?.toFixed(5)}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <div style={{ fontSize: 12, color: 'var(--text-primary)' }}>
                        {format(new Date(v.timestamp), 'MMM d, HH:mm:ss')}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        {format(new Date(v.timestamp), 'yyyy-MM-dd')}
                      </div>
                    </td>
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
