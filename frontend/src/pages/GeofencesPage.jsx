import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { geofenceAPI, vehicleAPI } from '../services/api'
import { useToast } from '../context/ToastContext'
import { formatDistanceToNow } from 'date-fns'
import { GeofenceMapDisplay } from '../components/MapEditor'

const CATEGORY_BADGE = {
  delivery_zone:   'badge-amber',
  restricted_zone: 'badge-rose',
  toll_zone:       'badge-sky',
  customer_area:   'badge-emerald',
}

// Popular cities with coordinates
const POPULAR_CITIES = [
  { name: 'Delhi, India', lat: 28.7041, lng: 77.1025 },
  { name: 'Mumbai, India', lat: 19.0760, lng: 72.8777 },
  { name: 'Bangalore, India', lat: 12.9716, lng: 77.5946 },
  { name: 'Hyderabad, India', lat: 17.3850, lng: 78.4867 },
  { name: 'Kolkata, India', lat: 22.5726, lng: 88.3639 },
  { name: 'New York, USA', lat: 40.7128, lng: -74.0060 },
  { name: 'Los Angeles, USA', lat: 34.0522, lng: -118.2437 },
  { name: 'Chicago, USA', lat: 41.8781, lng: -87.6298 },
  { name: 'London, UK', lat: 51.5074, lng: -0.1278 },
  { name: 'Paris, France', lat: 48.8566, lng: 2.3522 },
  { name: 'Berlin, Germany', lat: 52.5200, lng: 13.4050 },
  { name: 'Tokyo, Japan', lat: 35.6762, lng: 139.6503 },
  { name: 'Sydney, Australia', lat: -33.8688, lng: 151.2093 },
  { name: 'Singapore', lat: 1.3521, lng: 103.8198 },
  { name: 'Dubai, UAE', lat: 25.2048, lng: 55.2708 },
]

// Coverage radius in kilometers
const COVERAGE_RADIUS = {
  small: 1,
  medium: 3,
  large: 7,
}

export default function GeofencesPage() {
  const { error, success } = useToast()
  const [geofences, setGeofences] = useState([])
  const [vehicles,  setVehicles]  = useState([])
  const [locations, setLocations] = useState({})
  const [total,     setTotal]     = useState(0)
  const [loading,   setLoading]   = useState(true)
  const [filter,    setFilter]    = useState('')
  const [showForm,  setShowForm]  = useState(false)
  const [showMap,   setShowMap]   = useState(false)
  const [form,      setForm]      = useState({ name: '', category: 'delivery_zone', description: '', coordinates: '' })
  const [saving,    setSaving]    = useState(false)
  const [page,      setPage]      = useState(0)
  const [selectedPoints, setSelectedPoints] = useState([])
  const [editingGeofence, setEditingGeofence] = useState(null)
  const [showQuickGeofence, setShowQuickGeofence] = useState(false)
  const [quickForm, setQuickForm] = useState({ city: '', coverage: 'medium', category: 'delivery_zone' })
  const LIMIT = 20

  const fetchGeofences = async () => {
    setLoading(true)
    try {
      const [gRes, vRes] = await Promise.all([
        geofenceAPI.list({
          limit: LIMIT, offset: page * LIMIT,
          ...(filter ? { category: filter } : {}),
        }),
        vehicleAPI.list({ limit: 200 }),
      ])
      
      setGeofences(gRes.data.data.geofences ?? [])
      setTotal(gRes.data.data.total_count ?? 0)
      
      const vList = vRes.data.data.vehicles ?? []
      setVehicles(vList)
      
      // Fetch locations for all vehicles
      const locs = {}
      await Promise.allSettled(vList.map(async (v) => {
        try {
          const r = await vehicleAPI.getLocation(v.id)
          const loc = r.data.data.current_location
          if (loc) locs[v.id] = loc
        } catch { /* vehicle may not have a location yet */ }
      }))
      setLocations(locs)
    } catch { error('Failed to load geofences') }
    finally { setLoading(false) }
  }

  useEffect(() => { fetchGeofences() }, [page, filter])

  // Generate circular polygon coordinates around a center point
  const generateCircleCoordinates = (centerLat, centerLng, radiusKm, points = 12) => {
    const coords = []
    const earthRadiusKm = 6371
    const radians = (Math.PI / 180)
    
    for (let i = 0; i < points; i++) {
      const angle = (i / points) * 2 * Math.PI
      const lat = centerLat + (radiusKm / earthRadiusKm) * (180 / Math.PI) * Math.cos(angle)
      const lng = centerLng + (radiusKm / earthRadiusKm) * (180 / Math.PI) * Math.sin(angle) / Math.cos(centerLat * radians)
      coords.push([lat, lng])
    }
    
    // Close the polygon
    coords.push(coords[0])
    return coords
  }

  const handleQuickGeofence = () => {
    if (!quickForm.city) {
      error('Please select a city')
      return
    }
    
    const selectedCity = POPULAR_CITIES.find(c => c.name === quickForm.city)
    if (!selectedCity) return
    
    const radius = COVERAGE_RADIUS[quickForm.coverage] || 3
    const cityName = quickForm.city.split(',')[0] // Extract city name without country
    const coordinates = generateCircleCoordinates(selectedCity.lat, selectedCity.lng, radius)
    
    setForm({
      name: `${cityName} - ${quickForm.coverage.charAt(0).toUpperCase() + quickForm.coverage.slice(1)} Coverage`,
      category: quickForm.category,
      description: `Quick geofence for ${quickForm.city} (${radius}km radius)`,
      coordinates: JSON.stringify(coordinates),
    })
    
    setSelectedPoints(coordinates)
    setShowForm(true)
    setShowQuickGeofence(false)
    success(`Geofence template created for ${quickForm.city}`)
  }

  const handleQuickGeofenceClose = () => {
    setShowQuickGeofence(false)
    setQuickForm({ city: '', coverage: 'medium', category: 'delivery_zone' })
  }


  const handleMapCoordinateSelect = (lat, lng) => {
    setSelectedPoints([...selectedPoints, [lat, lng]])
    // Auto-update coordinates in form
    const newCoords = JSON.stringify([...selectedPoints, [lat, lng]])
    setForm({ ...form, coordinates: newCoords })
  }

  const handleClearPoints = () => {
    setSelectedPoints([])
    setForm({ ...form, coordinates: '' })
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      let coords
      try {
        coords = JSON.parse(form.coordinates)
      } catch {
        error('Coordinates must be valid JSON array: [[lat,lon],…]')
        setSaving(false)
        return
      }

      if (editingGeofence) {
        // Update existing geofence
        await geofenceAPI.update(editingGeofence.id, { 
          name: form.name, 
          category: form.category, 
          description: form.description, 
          coordinates: coords 
        })
        success(`Geofence "${form.name}" updated`)
        setEditingGeofence(null)
      } else {
        // Create new geofence
        await geofenceAPI.create({ name: form.name, category: form.category, description: form.description, coordinates: coords })
        success(`Geofence "${form.name}" created`)
      }

      setShowForm(false)
      setForm({ name: '', category: 'delivery_zone', description: '', coordinates: '' })
      setSelectedPoints([])
      fetchGeofences()
    } catch (err) {
      error(err.response?.data?.error?.message || 'Failed to save geofence')
    } finally { setSaving(false) }
  }

  const handleEditGeofence = (geofence) => {
    setEditingGeofence(geofence)
    setForm({
      name: geofence.name,
      category: geofence.category,
      description: geofence.description || '',
      coordinates: JSON.stringify(geofence.coordinates),
    })
    setSelectedPoints(geofence.coordinates || [])
    setShowForm(true)
  }

  const handleCancelEdit = () => {
    setEditingGeofence(null)
    setShowForm(false)
    setForm({ name: '', category: 'delivery_zone', description: '', coordinates: '' })
    setSelectedPoints([])
  }

  const handleDeleteGeofence = async (geofenceId) => {
    if (!window.confirm('Delete this geofence? This cannot be undone.')) return
    try {
      await geofenceAPI.delete(geofenceId)
      success('Geofence deleted')
      fetchGeofences()
    } catch (err) {
      error(err.response?.data?.error?.message || 'Failed to delete geofence')
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '20px 24px 16px',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
        background: 'var(--surface-800)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 20 }}>Geofences</h1>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
              {total} zones configured
            </p>
          </div>
          <div style={{ flex: 1 }} />
          <Link to="/map" className="btn btn-secondary" style={{ fontSize: 13 }}>Open Map</Link>
          <button className="btn btn-secondary" onClick={() => setShowMap((v) => !v)} style={{ fontSize: 13 }}>
            {showMap ? '✕ Hide Map' : '🗺 Show Map'}
          </button>
          <button className="btn btn-secondary" onClick={() => setShowQuickGeofence((v) => !v)} style={{ fontSize: 13 }}>
            {showQuickGeofence ? '✕ Cancel Quick' : '⚡ Quick Geofence'}
          </button>
          <button className="btn btn-primary" onClick={() => {
            if (editingGeofence) handleCancelEdit()
            else setShowForm((v) => !v)
          }} style={{ fontSize: 13 }}>
            {showForm ? '✕ Close' : editingGeofence ? '✕ Cancel Edit' : '+ New Geofence'}
          </button>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {['', 'delivery_zone', 'restricted_zone', 'toll_zone', 'customer_area'].map((cat) => (
            <button
              key={cat}
              onClick={() => { setFilter(cat); setPage(0) }}
              style={{
                padding: '5px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
                border: filter === cat ? '1px solid var(--amber)' : '1px solid var(--border)',
                background: filter === cat ? 'rgba(245,158,11,0.12)' : 'var(--surface-700)',
                color: filter === cat ? 'var(--amber)' : 'var(--text-secondary)',
                textTransform: 'capitalize',
              }}
            >
              {cat ? cat.replace(/_/g, ' ') : 'All categories'}
            </button>
          ))}
        </div>
      </div>

      {/* Map view */}
      {showMap && (
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'rgba(59,130,246,0.03)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 500 }}>
                Interactive map - click to place pins / {selectedPoints.length} points selected
              </div>
            </div>
            {selectedPoints.length > 0 && (
              <button className="btn btn-secondary" onClick={handleClearPoints} style={{ fontSize: 12, marginLeft: 'auto' }}>
                Clear Points
              </button>
            )}
          </div>
          <GeofenceMapDisplay 
            geofences={geofences}
            vehicles={vehicles}
            locations={locations}
            onCoordinatesSelect={handleMapCoordinateSelect}
            height={350}
          />
          {selectedPoints.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
              {selectedPoints.map((p, i) => (
                <div key={i}>Point {i + 1}: {p[0].toFixed(6)}, {p[1].toFixed(6)}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Quick Geofence */}
      {showQuickGeofence && (
        <div style={{
          padding: '16px 24px',
          borderBottom: '1px solid var(--border)',
          background: 'linear-gradient(135deg, rgba(168,85,247,0.08), rgba(59,130,246,0.08))',
          flexShrink: 0,
        }}>
          <div style={{ marginBottom: 12, fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
            ⚡ Quick Geofence Creator
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 12, marginBottom: 12, alignItems: 'flex-end' }}>
            <div>
              <label style={labelStyle}>Select Popular City *</label>
              <select className="input-field" value={quickForm.city}
                onChange={(e) => setQuickForm({ ...quickForm, city: e.target.value })} 
                style={{ cursor: 'pointer' }} required>
                <option value="">Choose a city…</option>
                {POPULAR_CITIES.map((city) => (
                  <option key={city.name} value={city.name}>{city.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Coverage Area *</label>
              <select className="input-field" value={quickForm.coverage}
                onChange={(e) => setQuickForm({ ...quickForm, coverage: e.target.value })}
                style={{ cursor: 'pointer' }}>
                <option value="small">Small (1 km)</option>
                <option value="medium">Medium (3 km)</option>
                <option value="large">Large (7 km)</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Category *</label>
              <select className="input-field" value={quickForm.category}
                onChange={(e) => setQuickForm({ ...quickForm, category: e.target.value })}
                style={{ cursor: 'pointer' }}>
                <option value="delivery_zone">Delivery Zone</option>
                <option value="restricted_zone">Restricted Zone</option>
                <option value="toll_zone">Toll Zone</option>
                <option value="customer_area">Customer Area</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" onClick={handleQuickGeofence} style={{ fontSize: 13, flex: 1 }}>
                Create
              </button>
              <button className="btn btn-secondary" onClick={handleQuickGeofenceClose} style={{ fontSize: 13 }}>
                Cancel
              </button>
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
            💡 Tip: Select a city and coverage area to quickly create a circular geofence. You can still edit the coordinates after creation.
          </div>
        </div>
      )}


      {/* Creation form */}
      {showForm && (
        <form onSubmit={handleCreate} style={{
          padding: '20px 24px',
          borderBottom: '1px solid var(--border)',
          background: 'rgba(245,158,11,0.04)',
          flexShrink: 0,
        }}>
          <div style={{ marginBottom: 12, fontWeight: 600, fontSize: 14 }}>
            {editingGeofence ? `Edit: ${editingGeofence.name}` : 'Create New Geofence'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={labelStyle}>Name *</label>
              <input className="input-field" placeholder="Zone name" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <label style={labelStyle}>Category *</label>
              <select className="input-field" value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })} style={{ cursor: 'pointer' }}>
                <option value="delivery_zone">Delivery Zone</option>
                <option value="restricted_zone">Restricted Zone</option>
                <option value="toll_zone">Toll Zone</option>
                <option value="customer_area">Customer Area</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Description</label>
              <input className="input-field" placeholder="Optional" value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Coordinates JSON * <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>[[lat,lon], …] — min 3 points</span></label>
            <textarea className="input-field" rows={3} placeholder='[[28.6139, 77.2090], [28.6200, 77.2200], [28.6100, 77.2250]]'
              value={form.coordinates} onChange={(e) => setForm({ ...form, coordinates: e.target.value })} required
              style={{ resize: 'vertical', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" type="submit" disabled={saving}>
              {saving ? (editingGeofence ? 'Updating…' : 'Creating…') : (editingGeofence ? 'Update Geofence' : 'Create Geofence')}
            </button>
            <button className="btn btn-secondary" type="button" onClick={handleCancelEdit}>Cancel</button>
          </div>
        </form>
      )}

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px 24px' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>
        ) : geofences.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⬡</div>
            <div>No geofences yet. <button className="btn btn-primary" onClick={() => setShowForm(true)} style={{ marginLeft: 8 }}>Create one</button></div>
          </div>
        ) : (
          <>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, marginTop: 16 }}>
              <thead>
                <tr>
                  {['Name', 'Category', 'Points', 'Status', 'Created', 'Actions'].map((h) => (
                    <th key={h} style={{
                      textAlign: 'left', padding: '8px 16px',
                      fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em',
                      borderBottom: '1px solid var(--border)', background: 'var(--surface-800)',
                      position: 'sticky', top: 0,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {geofences.map((gf, i) => (
                  <tr key={gf.id} style={{ transition: 'background 0.15s' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-700)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 500, fontSize: 14 }}>{gf.name}</div>
                      {gf.description && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{gf.description}</div>}
                    </td>
                    <td style={tdStyle}>
                      <span className={`badge ${CATEGORY_BADGE[gf.category] || 'badge-muted'}`}>
                        {gf.category?.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: 'var(--text-secondary)' }}>
                        {gf.coordinates?.length ?? 0}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span className={`badge ${gf.status === 'active' ? 'badge-emerald' : 'badge-muted'}`}>
                        {gf.status}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {formatDistanceToNow(new Date(gf.created_at), { addSuffix: true })}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => handleEditGeofence(gf)} style={{ background: 'none', border: 'none', color: 'var(--sky)', cursor: 'pointer', fontSize: 13, textDecoration: 'underline' }}>Edit</button>
                        <button onClick={() => handleDeleteGeofence(gf.id)} style={{ background: 'none', border: 'none', color: 'var(--rose)', cursor: 'pointer', fontSize: 13, textDecoration: 'underline' }}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            <Pagination page={page} setPage={setPage} total={total} limit={LIMIT} />
          </>
        )}
      </div>
    </div>
  )
}

const labelStyle = { display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 500 }
const tdStyle    = { padding: '13px 16px', borderBottom: '1px solid var(--border)', fontSize: 13, verticalAlign: 'top' }

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
