import { useState, useEffect, useCallback } from 'react'
import { vehicleAPI, geofenceAPI } from '../services/api'
import { useToast } from '../context/ToastContext'
import { formatDistanceToNow } from 'date-fns'
import { VehicleRelocationMap } from '../components/MapEditor'
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Fix Leaflet marker icon issue
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

const defaultIcon = L.icon({
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})
L.Marker.prototype.setIcon(defaultIcon)

const VEHICLE_TYPES = ['Car', 'Bike', 'Truck', 'Bus', 'Van', 'Auto', 'Tempo']

export default function VehiclesPage() {
  const { error, success } = useToast()
  const [vehicles,  setVehicles]  = useState([])
  const [locations, setLocations] = useState({}) // vehicleId -> {latitude, longitude}
  const [geofences, setGeofences] = useState([])
  const [total,     setTotal]     = useState(0)
  const [loading,   setLoading]   = useState(true)
  const [showForm,  setShowForm]  = useState(false)
  const [showMap,   setShowMap]   = useState(false)
  const [form,      setForm]      = useState({ vehicle_number: '', driver_name: '', vehicle_type: '', phone: '' })
  const [saving,    setSaving]    = useState(false)
  const [locForm,   setLocForm]   = useState({ vehicleId: '', latitude: '', longitude: '' })
  const [sendingLoc,setSendingLoc]= useState(false)
  const [showMapSelector, setShowMapSelector] = useState(false)
  const [editingVehicle, setEditingVehicle] = useState(null)
  const [page,      setPage]      = useState(0)
  const LIMIT = 20

  const fetchVehicles = async () => {
    setLoading(true)
    try {
      const [vRes, gRes] = await Promise.all([
        vehicleAPI.list({ limit: LIMIT, offset: page * LIMIT }),
        geofenceAPI.list({ limit: 200 }),
      ])
      
      setVehicles(vRes.data.data.vehicles ?? [])
      setTotal(vRes.data.data.total_count ?? 0)
      setGeofences(gRes.data.data.geofences ?? [])
      
      // Fetch locations for all vehicles
      const locs = {}
      const vList = vRes.data.data.vehicles ?? []
      await Promise.allSettled(vList.map(async (v) => {
        try {
          const r = await vehicleAPI.getLocation(v.id)
          const loc = r.data.data.current_location
          if (loc) locs[v.id] = loc
        } catch { /* vehicle may not have a location yet */ }
      }))
      setLocations(locs)
    } catch { error('Failed to load vehicles') }
    finally { setLoading(false) }
  }

  useEffect(() => { fetchVehicles() }, [page])

  // Auto-fill lat/lng when vehicle is selected
  useEffect(() => {
    if (locForm.vehicleId && locations[locForm.vehicleId]) {
      const loc = locations[locForm.vehicleId]
      setLocForm(prev => ({
        ...prev,
        latitude: loc.latitude?.toString() || '',
        longitude: loc.longitude?.toString() || '',
      }))
    }
  }, [locForm.vehicleId, locations])

  const handleCreate = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await vehicleAPI.create(form)
      success(`Vehicle ${form.vehicle_number} registered`)
      setShowForm(false)
      setForm({ vehicle_number: '', driver_name: '', vehicle_type: '', phone: '' })
      fetchVehicles()
    } catch (err) {
      error(err.response?.data?.error?.message || 'Failed to register vehicle')
    } finally { setSaving(false) }
  }

  const handleSendLocation = async (e) => {
    e.preventDefault()
    setSendingLoc(true)
    try {
      const lat = parseFloat(locForm.latitude)
      const lon = parseFloat(locForm.longitude)
      if (isNaN(lat) || isNaN(lon)) { error('Invalid coordinates'); return }
      await vehicleAPI.updateLocation({
        vehicle_id: locForm.vehicleId,
        latitude: lat,
        longitude: lon,
        timestamp: new Date().toISOString(),
      })
      success('Location updated')
      setLocForm({ vehicleId: '', latitude: '', longitude: '' })
      fetchVehicles()
    } catch (err) {
      error(err.response?.data?.error?.message || 'Failed to update location')
    } finally { setSendingLoc(false) }
  }

  const handleVehicleLocationUpdate = async (vehicleId, lat, lng) => {
    try {
      await vehicleAPI.updateLocation({
        vehicle_id: vehicleId,
        latitude: lat,
        longitude: lng,
        timestamp: new Date().toISOString(),
      })
      success('Vehicle location updated')
      fetchVehicles()
    } catch (err) {
      error(err.response?.data?.error?.message || 'Failed to update vehicle location')
    }
  }

  const handleDeleteVehicle = async (vehicleId) => {
    if (!window.confirm('Delete this vehicle? This cannot be undone.')) return
    try {
      await vehicleAPI.delete(vehicleId)
      success('Vehicle deleted')
      fetchVehicles()
    } catch (err) {
      error(err.response?.data?.error?.message || 'Failed to delete vehicle')
    }
  }

  const handleMapLocationSelect = (lat, lng) => {
    setLocForm(prev => ({
      ...prev,
      latitude: lat.toString(),
      longitude: lng.toString(),
    }))
    setShowMapSelector(false)
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface-800)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <div>
            <h1 style={{ margin: 0, fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 20 }}>Vehicles</h1>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>{total} registered vehicles</p>
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn btn-secondary" onClick={() => setShowMap((v) => !v)} style={{ fontSize: 13 }}>
            {showMap ? '✕ Hide Map' : '🗺 Show Map'}
          </button>
          <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)} style={{ fontSize: 13 }}>
            {showForm ? '✕ Close' : '+ Register Vehicle'}
          </button>
        </div>
      </div>

      {/* Registration form */}
      {showForm && (
        <form onSubmit={handleCreate} style={{
          padding: '20px 24px', borderBottom: '1px solid var(--border)',
          background: 'rgba(245,158,11,0.03)', flexShrink: 0,
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 12 }}>
            {[
              { key: 'vehicle_number', label: 'Vehicle Number *', type: 'text', placeholder: 'MH01AB1234' },
              { key: 'driver_name',   label: 'Driver Name *', type: 'text',    placeholder: 'John Doe' },
              { key: 'phone',         label: 'Phone *', type: 'tel',          placeholder: '+91 98765 43210' },
            ].map(({ key, label, type, placeholder }) => (
              <div key={key}>
                <label style={labelStyle}>{label}</label>
                <input className="input-field" type={type} placeholder={placeholder} value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })} required />
              </div>
            ))}
            <div>
              <label style={labelStyle}>Vehicle Type *</label>
              <select className="input-field" value={form.vehicle_type}
                onChange={(e) => setForm({ ...form, vehicle_type: e.target.value })} style={{ cursor: 'pointer' }} required>
                <option value="">Select type…</option>
                {VEHICLE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Register Vehicle'}</button>
            <button className="btn btn-secondary" type="button" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      {/* Location update form */}
      <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'rgba(14,165,233,0.03)' }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 500 }}>
          Simulate location update
        </div>
        <form onSubmit={handleSendLocation} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 2, minWidth: 160 }}>
            <label style={labelStyle}>Vehicle</label>
            <select className="input-field" value={locForm.vehicleId}
              onChange={(e) => setLocForm({ ...locForm, vehicleId: e.target.value })} style={{ cursor: 'pointer' }} required>
              <option value="">Select vehicle…</option>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.vehicle_number} — {v.driver_name}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 120 }}>
            <label style={labelStyle}>Latitude</label>
            <input className="input-field" placeholder="28.6139" value={locForm.latitude}
              onChange={(e) => setLocForm({ ...locForm, latitude: e.target.value })} required />
          </div>
          <div style={{ flex: 1, minWidth: 120 }}>
            <label style={labelStyle}>Longitude</label>
            <input className="input-field" placeholder="77.2090" value={locForm.longitude}
              onChange={(e) => setLocForm({ ...locForm, longitude: e.target.value })} required />
          </div>
          <button className="btn btn-secondary" type="button" onClick={() => setShowMapSelector(true)} disabled={!locForm.vehicleId} style={{ flexShrink: 0 }}>
            📍 Choose at Map
          </button>
          <button className="btn btn-secondary" type="submit" disabled={sendingLoc} style={{ flexShrink: 0 }}>
            {sendingLoc ? 'Sending…' : 'Send Location'}
          </button>
        </form>
      </div>

      {/* Map view */}
      {showMap && (
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'rgba(59,130,246,0.03)' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 500 }}>
            Click on map to relocate a vehicle
          </div>
          <VehicleRelocationMap 
            vehicles={vehicles} 
            locations={locations}
            geofences={geofences}
            onVehicleLocationUpdate={handleVehicleLocationUpdate}
            height={400}
          />
        </div>
      )}

      {/* Map selector modal for location picking */}
      {showMapSelector && (
        <div style={{ 
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', 
          alignItems: 'center', justifyContent: 'center'
        }}>
          <div style={{ 
            background: 'var(--surface-900)', borderRadius: 8, 
            padding: 0, width: '90%', maxWidth: 800, height: '85vh', 
            display: 'flex', flexDirection: 'column', overflow: 'hidden'
          }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Select Location on Map</h3>
              <button onClick={() => setShowMapSelector(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <MapLocationSelector onSelect={handleMapLocationSelect} />
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px 24px' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>
        ) : vehicles.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)' }}>
            No vehicles registered yet.
          </div>
        ) : (
          <>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, marginTop: 16 }}>
              <thead>
                <tr>
                  {['Vehicle #', 'Driver', 'Type', 'Phone', 'Status', 'Registered', 'Actions'].map((h) => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {vehicles.map((v) => (
                  <tr key={v.id}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-700)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    style={{ transition: 'background 0.15s' }}
                  >
                    <td style={tdStyle}>
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 500, color: 'var(--amber)', fontSize: 13 }}>
                        {v.vehicle_number}
                      </span>
                    </td>
                    <td style={tdStyle}>{v.driver_name}</td>
                    <td style={tdStyle}>
                      <span className="badge badge-muted">{v.vehicle_type}</span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>{v.phone}</span>
                    </td>
                    <td style={tdStyle}>
                      <span className={`badge ${v.status === 'active' ? 'badge-emerald' : 'badge-muted'}`}>{v.status}</span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {formatDistanceToNow(new Date(v.created_at), { addSuffix: true })}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => setEditingVehicle(v)} style={{ background: 'none', border: 'none', color: 'var(--sky)', cursor: 'pointer', fontSize: 13, textDecoration: 'underline' }}>Edit</button>
                        <button onClick={() => handleDeleteVehicle(v.id)} style={{ background: 'none', border: 'none', color: 'var(--rose)', cursor: 'pointer', fontSize: 13, textDecoration: 'underline' }}>Delete</button>
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

function createPinIcon() {
  return L.divIcon({
    className: '',
    html: `<div style="font-size:34px;line-height:1;filter:drop-shadow(0 2px 5px rgba(0,0,0,.4))">📍</div>`,
    iconSize: [34, 34], iconAnchor: [17, 34], popupAnchor: [0, -34],
  })
}

// ─── Stable click handler — MUST be at module level, not inside MapLocationSelector ──
function MapSelectorClickHandler({ onSelect }) {
  useMapEvents({
    click(e) { onSelect(e.latlng.lat, e.latlng.lng) },
  })
  return null
}

function MapLocationSelector({ onSelect }) {
  const [selectedPos, setSelectedPos] = useState(null)

  const handleClick = useCallback((lat, lng) => {
    setSelectedPos([lat, lng])
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        <MapContainer center={[20.5937, 78.9629]} zoom={5} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution="© CARTO"
          />
          <MapSelectorClickHandler onSelect={handleClick} />
          {selectedPos && <Marker position={selectedPos} icon={createPinIcon()} />}
        </MapContainer>
      </div>
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end', flexShrink: 0, background: 'var(--surface-900)' }}>
        {selectedPos && (
          <>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginRight: 'auto' }}>
              📍 {selectedPos[0].toFixed(6)}, {selectedPos[1].toFixed(6)}
            </span>
            <button onClick={() => onSelect(selectedPos[0], selectedPos[1])} className="btn btn-primary" style={{ padding: '6px 12px', fontSize: 13 }}>
              ✓ Use this location
            </button>
          </>
        )}
        {!selectedPos && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)', margin: 'auto' }}>Click anywhere on the map to select a location</span>
        )}
      </div>
    </div>
  )
}

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
