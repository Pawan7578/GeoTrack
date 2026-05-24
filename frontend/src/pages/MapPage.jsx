import { useState, useEffect, useRef, useCallback } from 'react'
import { MapContainer, TileLayer, Polygon, Marker, Popup, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet-draw'
import { geofenceAPI, vehicleAPI } from '../services/api'
import { useToast } from '../context/ToastContext'

// ─── Constants ────────────────────────────────────────────────────────────────

const VEHICLE_EMOJIS = {
  Car: '🚗', Bike: '🏍️', Truck: '🚚', Bus: '🚌',
  Van: '🚐', Auto: '🛺', Tempo: '🚐',
}

const FENCE_COLORS = {
  delivery_zone:   '#f59e0b',
  restricted_zone: '#f43f5e',
  toll_zone:       '#38bdf8',
  customer_area:   '#10b981',
}

const CATEGORY_LABELS = {
  delivery_zone:   'Delivery',
  restricted_zone: 'Restricted',
  toll_zone:       'Toll',
  customer_area:   'Customer',
}

const DEFAULT_CENTER = [20.5937, 78.9629]
const DEFAULT_ZOOM   = 5

// ─── Pure helpers ─────────────────────────────────────────────────────────────

const getEmoji = (type) => VEHICLE_EMOJIS[type] || '🚗'

function pointInPolygon([lat, lon], polygon) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [la, lo] = polygon[i], [lb, lp] = polygon[j]
    if ((lo > lon) !== (lp > lon) && lat < ((lb - la) * (lon - lo)) / (lp - lo) + la)
      inside = !inside
  }
  return inside
}

function fenceForVehicle(loc, geofences) {
  return geofences.find(gf =>
    gf.coordinates?.length >= 3 &&
    pointInPolygon([loc.latitude, loc.longitude], gf.coordinates)
  ) || null
}

function vehiclesInFence(gf, vehicles, locations) {
  if (!gf.coordinates || gf.coordinates.length < 3) return 0
  return vehicles.filter(v => {
    const l = locations[v.id]
    return l && pointInPolygon([l.latitude, l.longitude], gf.coordinates)
  }).length
}

function createMarkerIcon(type, highlight = false) {
  const emoji = getEmoji(type)
  const size  = highlight ? 46 : 38
  return L.divIcon({
    className: '',
    html: `<div style="font-size:${size}px;line-height:1;text-align:center;
      filter:${highlight
        ? 'drop-shadow(0 0 10px rgba(245,158,11,.9))'
        : 'drop-shadow(0 2px 4px rgba(0,0,0,.4))'};
      transition:all .2s ease">${emoji}</div>`,
    iconSize:    [size, size],
    iconAnchor:  [size / 2, size],
    popupAnchor: [0, -size],
  })
}

function createPinIcon() {
  return L.divIcon({
    className: '',
    html: `<div style="font-size:36px;line-height:1;text-align:center;
      filter:drop-shadow(0 2px 6px rgba(0,0,0,.5));
      animation:pin-drop .25s ease-out">📍</div>`,
    iconSize:    [36, 36],
    iconAnchor:  [18, 36],
    popupAnchor: [0, -36],
  })
}

// ─── Stable map sub-components (module level — NEVER inside another component) ─

function MapCapture({ instanceRef }) {
  instanceRef.current = useMap()
  return null
}

// Listens for map clicks — skips if drawing mode is active
function MapClickHandler({ drawing, onMapClick }) {
  useMapEvents({
    click(e) {
      if (drawing) return // don't interfere with leaflet-draw
      onMapClick(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

function DrawControl({ active, onDrawn }) {
  const map = useMap()
  useEffect(() => {
    if (!active) return
    const drawnItems = new L.FeatureGroup()
    map.addLayer(drawnItems)
    const ctrl = new L.Control.Draw({
      draw: {
        polygon:      { shapeOptions: { color: '#f59e0b', weight: 2.5, fillOpacity: 0.12 } },
        polyline:     false, rectangle: false,
        circle:       false, marker:    false, circlemarker: false,
      },
      edit: { featureGroup: drawnItems, remove: false },
    })
    map.addControl(ctrl)
    const onCreated = (e) => {
      drawnItems.addLayer(e.layer)
      onDrawn(e.layer.getLatLngs()[0].map(ll => [ll.lat, ll.lng]))
      map.removeControl(ctrl)
    }
    map.on(L.Draw.Event.CREATED, onCreated)
    return () => {
      map.off(L.Draw.Event.CREATED, onCreated)
      try { map.removeControl(ctrl) } catch {}
      try { map.removeLayer(drawnItems) } catch {}
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])
  return null
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MapPage() {
  const { error: toastError, success } = useToast()

  const [geofences,  setGeofences]  = useState([])
  const [vehicles,   setVehicles]   = useState([])
  const [locations,  setLocations]  = useState({})
  const [drawing,    setDrawing]    = useState(false)
  const [newFence,   setNewFence]   = useState(null)
  const [showForm,   setShowForm]   = useState(false)
  const [fenceForm,  setFenceForm]  = useState({ name: '', category: 'delivery_zone', description: '' })
  const [saving,     setSaving]     = useState(false)
  const [draggedId,  setDraggedId]  = useState(null)
  const [selectedGf, setSelectedGf] = useState(null)
  const [selectedV,  setSelectedV]  = useState(null)
  const [sidebarTab, setSidebarTab] = useState('geofences')
  const [collapsed,  setCollapsed]  = useState(false)

  // ── Pin state (map click → show coordinates + vehicle relocate panel) ────────
  const [pin,            setPin]            = useState(null)   // { lat, lng }
  const [relocatingVehicle, setRelocating]  = useState(null)  // vehicle id being moved
  const [relocateSaving, setRelocateSaving] = useState(false)

  const mapRef    = useRef(null)
  const markerRef = useRef({})

  // ── Data fetching ─────────────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    try {
      const [gRes, vRes] = await Promise.all([
        geofenceAPI.list({ limit: 200 }),
        vehicleAPI.list({ limit: 200 }),
      ])
      setGeofences(gRes.data.data.geofences ?? [])
      const vList = vRes.data.data.vehicles ?? []
      setVehicles(vList)
      const locs = {}
      await Promise.allSettled(vList.map(async v => {
        try {
          const r = await vehicleAPI.getLocation(v.id)
          const loc = r.data.data.current_location
          if (loc) locs[v.id] = loc
        } catch {}
      }))
      setLocations(locs)
    } catch { toastError('Failed to load map data') }
  }, [toastError])

  useEffect(() => { fetchAll() }, [fetchAll])

  // ── Drag handlers ─────────────────────────────────────────────────────────────

  const handleDragEnd = useCallback(async (vehicleId, latlng) => {
    try {
      await vehicleAPI.updateLocation({
        vehicle_id: vehicleId,
        latitude:   latlng.lat,
        longitude:  latlng.lng,
        timestamp:  new Date().toISOString(),
      })
      success(`📍 Location updated`)
      setLocations(prev => ({ ...prev, [vehicleId]: { latitude: latlng.lat, longitude: latlng.lng } }))
    } catch (err) {
      toastError(err.response?.data?.error?.message || 'Failed to update location')
    } finally { setDraggedId(null) }
  }, [success, toastError])

  useEffect(() => {
    Object.entries(markerRef.current).forEach(([id, m]) => {
      if (!m) return
      m.off('dragstart').off('dragend')
      m.on('dragstart', () => setDraggedId(id))
      m.on('dragend',   () => handleDragEnd(id, m.getLatLng()))
      try { m.dragging?.enable() } catch {}
    })
  }, [locations, handleDragEnd])

  // ── Map click → drop pin ──────────────────────────────────────────────────────

  const handleMapClick = useCallback((lat, lng) => {
    if (showForm) return // don't drop pin while filling geofence form
    setPin({ lat, lng })
    setRelocating(null)
  }, [showForm])

  // ── Relocate vehicle to pin location ─────────────────────────────────────────

  const handleRelocate = async () => {
    if (!pin || !relocatingVehicle) return
    setRelocateSaving(true)
    try {
      await vehicleAPI.updateLocation({
        vehicle_id: relocatingVehicle,
        latitude:   pin.lat,
        longitude:  pin.lng,
        timestamp:  new Date().toISOString(),
      })
      const v = vehicles.find(v => v.id === relocatingVehicle)
      success(`📍 ${v?.vehicle_number} moved to ${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}`)
      setLocations(prev => ({ ...prev, [relocatingVehicle]: { latitude: pin.lat, longitude: pin.lng } }))
      setPin(null)
      setRelocating(null)
    } catch (err) {
      toastError(err.response?.data?.error?.message || 'Failed to relocate vehicle')
    } finally { setRelocateSaving(false) }
  }

  // ── Map interactions ──────────────────────────────────────────────────────────

  const zoomToFence = (gf) => {
    setSelectedGf(gf.id)
    if (mapRef.current && gf.coordinates?.length >= 3)
      mapRef.current.fitBounds(L.latLngBounds(gf.coordinates), { padding: [60, 60], animate: true })
  }

  const zoomToVehicle = (v) => {
    setSelectedV(v.id)
    const loc = locations[v.id]
    if (mapRef.current && loc)
      mapRef.current.setView([loc.latitude, loc.longitude], 15, { animate: true })
  }

  const handleDrawn = useCallback((coords) => {
    setNewFence(coords)
    setShowForm(true)
    setDrawing(false)
    setPin(null) // clear pin when draw form opens
  }, [])

  const handleSave = async () => {
    if (!newFence || !fenceForm.name) return
    setSaving(true)
    try {
      await geofenceAPI.create({ ...fenceForm, coordinates: newFence })
      success(`✓ Geofence "${fenceForm.name}" created`)
      setShowForm(false)
      setNewFence(null)
      setFenceForm({ name: '', category: 'delivery_zone', description: '' })
      fetchAll()
    } catch (err) {
      toastError(err.response?.data?.error?.message || 'Failed to create geofence')
    } finally { setSaving(false) }
  }

  const cancelDraw = () => { setDrawing(false); setShowForm(false); setNewFence(null) }

  // ── Derived ───────────────────────────────────────────────────────────────────

  const onlineVehicles  = vehicles.filter(v => locations[v.id])
  const outsideVehicles = onlineVehicles.filter(v => !fenceForVehicle(locations[v.id], geofences)).length

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%', display: 'flex', overflow: 'hidden' }}>

      {/* ── Collapsible Sidebar ──────────────────────────────────────────────── */}
      <div style={{
        width: collapsed ? 0 : 300, minWidth: collapsed ? 0 : 300,
        transition: 'width 0.25s ease, min-width 0.25s ease',
        overflow: 'hidden',
        background: 'rgba(10,12,22,0.97)',
        borderRight: collapsed ? 'none' : '1px solid rgba(255,255,255,0.06)',
        display: 'flex', flexDirection: 'column',
        height: '100%', position: 'relative', zIndex: 100,
      }}>
        <div style={{ width: 300, display: 'flex', flexDirection: 'column', height: '100%' }}>

          {/* Tabs */}
          <div style={{ padding: '14px 16px 0', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
            <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
              {[
                { id: 'geofences', label: 'Zones',    count: geofences.length },
                { id: 'vehicles',  label: 'Vehicles', count: onlineVehicles.length },
              ].map(tab => (
                <button key={tab.id} onClick={() => setSidebarTab(tab.id)} style={{
                  flex: 1, padding: '7px 0', border: 'none', cursor: 'pointer',
                  borderRadius: 6, fontSize: 12, fontWeight: 600,
                  background:   sidebarTab === tab.id ? 'rgba(245,158,11,0.15)' : 'transparent',
                  color:        sidebarTab === tab.id ? '#f59e0b' : 'rgba(255,255,255,0.4)',
                  borderBottom: sidebarTab === tab.id ? '2px solid #f59e0b' : '2px solid transparent',
                  transition:   'all 0.15s',
                }}>
                  {tab.label}
                  <span style={{
                    marginLeft: 6,
                    background: sidebarTab === tab.id ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.08)',
                    color:      sidebarTab === tab.id ? '#f59e0b' : 'rgba(255,255,255,0.3)',
                    borderRadius: 10, fontSize: 10, padding: '1px 6px',
                  }}>{tab.count}</span>
                </button>
              ))}
            </div>
          </div>

          {/* List */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
            {sidebarTab === 'geofences' && (
              geofences.length === 0
                ? <Empty icon="⬡" text="No geofences yet" sub="Click '⬡ Draw Zone' to create one" />
                : geofences.map(gf => {
                    const color    = FENCE_COLORS[gf.category] || '#f59e0b'
                    const selected = selectedGf === gf.id
                    const vCount   = vehiclesInFence(gf, vehicles, locations)
                    return (
                      <ListItem key={gf.id} selected={selected} color={color} onClick={() => zoomToFence(gf)}>
                        <div style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, background: `${color}18`, border: `1px solid ${color}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>⬡</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#e8eaf2', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{gf.name}</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                            <Pill color={color}>{CATEGORY_LABELS[gf.category] || gf.category}</Pill>
                            {vCount > 0 && <Pill color="#10b981">🚗 {vCount}</Pill>}
                          </div>
                        </div>
                      </ListItem>
                    )
                  })
            )}
            {sidebarTab === 'vehicles' && (
              onlineVehicles.length === 0
                ? <Empty icon="🚗" text="No vehicles online" sub="Update a vehicle location to see it here" />
                : onlineVehicles.map(v => {
                    const loc      = locations[v.id]
                    const selected = selectedV === v.id
                    const inFence  = fenceForVehicle(loc, geofences)
                    const color    = inFence ? (FENCE_COLORS[inFence.category] || '#f59e0b') : '#f43f5e'
                    return (
                      <ListItem key={v.id} selected={selected} color={color} onClick={() => zoomToVehicle(v)}>
                        <div style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>{getEmoji(v.vehicle_type)}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#e8eaf2' }}>{v.vehicle_number}</div>
                          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 1 }}>{v.driver_name}</div>
                          <div style={{ marginTop: 3 }}>
                            <Pill color={color}>{inFence ? `✓ ${inFence.name}` : '↗ Outside'}</Pill>
                          </div>
                        </div>
                      </ListItem>
                    )
                  })
            )}
          </div>

          {/* Footer stats */}
          <div style={{ padding: '10px 14px', borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)', display: 'flex', gap: 8, flexShrink: 0 }}>
            {[
              { label: 'Zones',   value: geofences.length,       color: '#f59e0b' },
              { label: 'Online',  value: onlineVehicles.length,  color: '#10b981' },
              { label: 'Outside', value: outsideVehicles,        color: '#f43f5e' },
            ].map(s => (
              <div key={s.label} style={{ flex: 1, textAlign: 'center', padding: '6px 0', borderRadius: 6, background: 'rgba(255,255,255,0.03)' }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: s.color, fontFamily: 'Syne, sans-serif' }}>{s.value}</div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 1 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Map area ─────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <MapContainer
          center={DEFAULT_CENTER}
          zoom={DEFAULT_ZOOM}
          style={{ height: '100%', width: '100%' }}
          zoomControl={false}
        >
          <MapCapture instanceRef={mapRef} />
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='© <a href="https://carto.com">CARTO</a>'
            maxZoom={19}
          />

          {/* Map click handler — skips when draw mode is active */}
          <MapClickHandler drawing={drawing} onMapClick={handleMapClick} />

          {/* Geofence polygons */}
          {geofences.map(gf => {
            if (!gf.coordinates || gf.coordinates.length < 3) return null
            const color    = FENCE_COLORS[gf.category] || '#f59e0b'
            const selected = selectedGf === gf.id
            return (
              <Polygon
                key={gf.id}
                positions={gf.coordinates}
                pathOptions={{
                  color,
                  weight:      selected ? 2.5 : 1.5,
                  fillOpacity: selected ? 0.22 : 0.1,
                  fillColor:   color,
                  dashArray:   selected ? '6, 4' : undefined,
                }}
                eventHandlers={{
                  click(e) {
                    L.DomEvent.stopPropagation(e) // prevent map click from also firing
                    zoomToFence(gf)
                    handleMapClick(e.latlng.lat, e.latlng.lng)
                  }
                }}
              >
                <Popup className="dark-popup">
                  <div style={{ minWidth: 170, padding: 2 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6, color: '#e8eaf2' }}>{gf.name}</div>
                    {gf.description && <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>{gf.description}</div>}
                    <div style={{ display: 'flex', gap: 6 }}>
                      <span style={{ padding: '3px 8px', borderRadius: 20, background: `${color}22`, color, fontSize: 11, fontWeight: 600, textTransform: 'capitalize' }}>
                        {gf.category?.replace(/_/g, ' ')}
                      </span>
                    </div>
                  </div>
                </Popup>
              </Polygon>
            )
          })}

          {/* Vehicle markers */}
          {vehicles.map(v => {
            const loc = locations[v.id]
            if (!loc) return null
            return (
              <Marker
                key={v.id}
                position={[loc.latitude, loc.longitude]}
                icon={createMarkerIcon(v.vehicle_type, draggedId === v.id || selectedV === v.id)}
                draggable
                ref={m => { if (m) markerRef.current[v.id] = m }}
              >
                <Popup>
                  <div style={{ minWidth: 170, padding: 2 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, color: '#e8eaf2' }}>
                      {getEmoji(v.vehicle_type)} {v.vehicle_number}
                    </div>
                    <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>{v.driver_name} · {v.vehicle_type}</div>
                    <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#666', background: 'rgba(0,0,0,0.2)', padding: '4px 6px', borderRadius: 4 }}>
                      {loc.latitude?.toFixed(6)}, {loc.longitude?.toFixed(6)}
                    </div>
                    <div style={{ fontSize: 10, color: '#555', marginTop: 6 }}>💡 Drag marker to relocate</div>
                  </div>
                </Popup>
              </Marker>
            )
          })}

          {/* Pin marker — dropped on map click */}
          {pin && (
            <Marker position={[pin.lat, pin.lng]} icon={createPinIcon()} />
          )}

          <DrawControl active={drawing} onDrawn={handleDrawn} />
        </MapContainer>

        {/* ── Floating top bar ──────────────────────────────────────────────── */}
        <div style={{
          position: 'absolute', top: 14, left: 14, right: 14,
          display: 'flex', alignItems: 'center', gap: 10,
          zIndex: 800, pointerEvents: 'none',
        }}>
          <button onClick={() => setCollapsed(c => !c)} style={floatBtn} title={collapsed ? 'Show panel' : 'Hide panel'}>
            {collapsed ? '▶' : '◀'}
          </button>

          <div style={{ ...floatPill, gap: 8 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 0 2px rgba(16,185,129,0.3)', animation: 'pulse 2s infinite' }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: '#e8eaf2' }}>Live</span>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>·</span>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>{onlineVehicles.length} vehicles</span>
          </div>

          <div style={{ ...floatPill, gap: 8 }}>
            {Object.entries(FENCE_COLORS).map(([k, c]) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: c }} />
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>{CATEGORY_LABELS[k]}</span>
              </div>
            ))}
          </div>

          <div style={{ flex: 1 }} />

          <button onClick={fetchAll} style={floatBtn} title="Refresh">↺</button>

          <button
            onClick={() => { drawing ? cancelDraw() : setDrawing(true); setPin(null) }}
            style={{
              pointerEvents: 'all', height: 36, padding: '0 16px', borderRadius: 10,
              background: drawing ? 'rgba(244,63,94,0.2)' : 'rgba(245,158,11,0.15)',
              border: `1px solid ${drawing ? 'rgba(244,63,94,0.4)' : 'rgba(245,158,11,0.35)'}`,
              backdropFilter: 'blur(12px)',
              color: drawing ? '#f43f5e' : '#f59e0b',
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {drawing ? '✕ Cancel' : '⬡ Draw Zone'}
          </button>
        </div>

        {/* ── Pin info panel ────────────────────────────────────────────────── */}
        {pin && !showForm && (
          <div
            ref={el => { if (el) L.DomEvent.disableClickPropagation(el) }}
            style={{
            position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
            zIndex: 800, width: 360,
            background: 'rgba(10,12,22,0.96)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 14, overflow: 'hidden',
            backdropFilter: 'blur(16px)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          }}>
            {/* Coordinates header */}
            <div style={{
              padding: '12px 16px',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 18 }}>📍</span>
                <div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Pinned Location</div>
                  <div style={{ fontFamily: 'monospace', fontSize: 13, color: '#e8eaf2', fontWeight: 600 }}>
                    {pin.lat.toFixed(6)}, {pin.lng.toFixed(6)}
                  </div>
                </div>
              </div>
              <button
                onClick={() => { setPin(null); setRelocating(null) }}
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}
              >×</button>
            </div>

            {/* Copy coordinates */}
            <div style={{ padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', gap: 6 }}>
              <button
                onClick={() => { navigator.clipboard.writeText(`${pin.lat.toFixed(6)}, ${pin.lng.toFixed(6)}`); success('Copied!') }}
                style={{ ...smallBtn, flex: 1 }}
              >
                📋 Copy coords
              </button>
              <button
                onClick={() => window.open(`https://www.google.com/maps?q=${pin.lat},${pin.lng}`, '_blank')}
                style={{ ...smallBtn, flex: 1 }}
              >
                🗺 Google Maps
              </button>
            </div>

            {/* Move vehicle section */}
            <div style={{ padding: '12px 16px' }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, fontWeight: 600 }}>
                Move Vehicle Here
              </div>

              {vehicles.length === 0 ? (
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', padding: '8px 0' }}>No registered vehicles</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
                  {vehicles.map(v => {
                    const isSelected = relocatingVehicle === v.id
                    const loc        = locations[v.id]
                    return (
                      <button
                        key={v.id}
                        onClick={() => setRelocating(isSelected ? null : v.id)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                          border: `1px solid ${isSelected ? 'rgba(245,158,11,0.5)' : 'rgba(255,255,255,0.06)'}`,
                          background: isSelected ? 'rgba(245,158,11,0.12)' : 'rgba(255,255,255,0.03)',
                          transition: 'all 0.15s', textAlign: 'left',
                        }}
                      >
                        <span style={{ fontSize: 20, flexShrink: 0 }}>{getEmoji(v.vehicle_type)}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: isSelected ? '#f59e0b' : '#e8eaf2' }}>
                            {v.vehicle_number}
                          </div>
                          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>
                            {v.driver_name} · {v.vehicle_type}
                            {loc && <span style={{ marginLeft: 6, fontFamily: 'monospace', fontSize: 10 }}>
                              ({loc.latitude?.toFixed(3)}, {loc.longitude?.toFixed(3)})
                            </span>}
                          </div>
                        </div>
                        {isSelected && <span style={{ fontSize: 12, color: '#f59e0b', flexShrink: 0 }}>✓</span>}
                      </button>
                    )
                  })}
                </div>
              )}

              {relocatingVehicle && (
                <button
                  onClick={handleRelocate}
                  disabled={relocateSaving}
                  style={{
                    marginTop: 10, width: '100%', padding: '10px 0',
                    borderRadius: 8, border: 'none', cursor: 'pointer',
                    background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                    color: '#000', fontSize: 13, fontWeight: 700,
                    opacity: relocateSaving ? 0.6 : 1,
                    transition: 'opacity 0.15s',
                  }}
                >
                  {relocateSaving
                    ? 'Moving…'
                    : `Move ${vehicles.find(v => v.id === relocatingVehicle)?.vehicle_number} here`}
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Drawing hint ──────────────────────────────────────────────────── */}
        {drawing && !showForm && (
          <div style={{
            position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)',
            zIndex: 800, pointerEvents: 'none',
            background: 'rgba(10,12,22,0.9)',
            border: '1px solid rgba(245,158,11,0.3)',
            borderRadius: 10, padding: '10px 20px',
            backdropFilter: 'blur(12px)',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b', animation: 'pulse 1.5s infinite' }} />
            <span style={{ fontSize: 13, color: '#f59e0b', fontWeight: 500 }}>
              Click to place points · Click first point to close polygon
            </span>
          </div>
        )}

        {/* ── Geofence creation form ────────────────────────────────────────── */}
        {showForm && (
          <div style={{
            position: 'absolute', top: 64, right: 14, zIndex: 800, width: 290,
            background: 'rgba(10,12,22,0.95)',
            border: '1px solid rgba(245,158,11,0.25)',
            borderRadius: 14, padding: 20,
            backdropFilter: 'blur(16px)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontFamily: 'Syne, sans-serif', fontWeight: 700, color: '#e8eaf2' }}>New Zone</h3>
              <button onClick={cancelDraw} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: 18, cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <FormField label="Zone Name">
                <input className="input-field" placeholder="e.g. North Warehouse" value={fenceForm.name}
                  onChange={e => setFenceForm({ ...fenceForm, name: e.target.value })} autoFocus />
              </FormField>
              <FormField label="Category">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {Object.entries(FENCE_COLORS).map(([key, color]) => (
                    <button key={key} onClick={() => setFenceForm({ ...fenceForm, category: key })} style={{
                      padding: '7px 6px', borderRadius: 8, cursor: 'pointer', fontSize: 11, fontWeight: 600,
                      background: fenceForm.category === key ? `${color}22` : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${fenceForm.category === key ? color : 'rgba(255,255,255,0.08)'}`,
                      color: fenceForm.category === key ? color : 'rgba(255,255,255,0.4)',
                      transition: 'all 0.15s',
                    }}>{CATEGORY_LABELS[key]}</button>
                  ))}
                </div>
              </FormField>
              <FormField label="Description">
                <input className="input-field" placeholder="Optional note" value={fenceForm.description}
                  onChange={e => setFenceForm({ ...fenceForm, description: e.target.value })} />
              </FormField>
              <button onClick={handleSave} disabled={saving || !fenceForm.name} style={{
                marginTop: 4, padding: '10px 0', borderRadius: 8, border: 'none',
                background: fenceForm.name ? 'linear-gradient(135deg, #f59e0b, #d97706)' : 'rgba(255,255,255,0.06)',
                color: fenceForm.name ? '#000' : 'rgba(255,255,255,0.2)',
                fontSize: 13, fontWeight: 700, cursor: fenceForm.name ? 'pointer' : 'not-allowed',
              }}>
                {saving ? 'Creating…' : 'Create Zone'}
              </button>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes pin-drop { from{transform:translateY(-12px);opacity:0} to{transform:translateY(0);opacity:1} }
        .leaflet-popup-content-wrapper {
          background: rgba(14,18,30,0.97) !important;
          border: 1px solid rgba(255,255,255,0.08) !important;
          border-radius: 10px !important;
          box-shadow: 0 8px 32px rgba(0,0,0,0.4) !important;
          color: #e8eaf2 !important;
        }
        .leaflet-popup-tip { background: rgba(14,18,30,0.97) !important; }
        .leaflet-popup-close-button { color: rgba(255,255,255,0.4) !important; }
      `}</style>
    </div>
  )
}

// ─── Style constants ──────────────────────────────────────────────────────────

const floatBtn = {
  pointerEvents: 'all',
  width: 36, height: 36, borderRadius: 10,
  background: 'rgba(10,12,22,0.85)',
  border: '1px solid rgba(255,255,255,0.1)',
  backdropFilter: 'blur(12px)',
  color: 'rgba(255,255,255,0.7)', fontSize: 14,
  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
}

const floatPill = {
  pointerEvents: 'all',
  display: 'flex', alignItems: 'center',
  padding: '0 12px', height: 36, borderRadius: 10,
  background: 'rgba(10,12,22,0.85)',
  border: '1px solid rgba(255,255,255,0.08)',
  backdropFilter: 'blur(12px)',
}

const smallBtn = {
  padding: '6px 10px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.08)',
  background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.5)',
  fontSize: 11, cursor: 'pointer', fontWeight: 500,
}

// ─── Small helpers ─────────────────────────────────────────────────────────────

function ListItem({ selected, color, onClick, children }) {
  return (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer',
      borderLeft: `3px solid ${selected ? color : 'transparent'}`,
      background: selected ? `${color}0d` : 'transparent', transition: 'background 0.15s',
    }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'transparent' }}
    >{children}</div>
  )
}

function Pill({ color, children }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 7px', borderRadius: 20,
      background: `${color}18`, color, fontSize: 10, fontWeight: 600,
      border: `1px solid ${color}30`, whiteSpace: 'nowrap',
    }}>{children}</span>
  )
}

function Empty({ icon, text, sub }) {
  return (
    <div style={{ padding: '40px 20px', textAlign: 'center' }}>
      <div style={{ fontSize: 32, marginBottom: 10 }}>{icon}</div>
      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>{text}</div>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 4 }}>{sub}</div>
    </div>
  )
}

function FormField({ label, children }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>{label}</label>
      {children}
    </div>
  )
}

