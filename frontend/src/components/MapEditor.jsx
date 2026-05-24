import { useCallback, useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polygon, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const VEHICLE_EMOJIS = {
  Car: '🚗', Bike: '🏍️', Truck: '🚚', Bus: '🚌',
  Van: '🚐', Auto: '🛺', Tempo: '🚐',
}

const GEOFENCE_COLORS = {
  delivery_zone: '#f59e0b',
  restricted_zone: '#f43f5e',
  toll_zone: '#38bdf8',
  customer_area: '#10b981',
}

const INDIA_CENTER = [20.5937, 78.9629]

const getEmoji = (type) => VEHICLE_EMOJIS[type] || '🚗'

function createVehicleIcon(type, highlight = false) {
  const size = highlight ? 40 : 34
  return L.divIcon({
    className: '',
    html: `<div style="font-size:${size}px;line-height:1;text-align:center;filter:${highlight ? 'drop-shadow(0 0 8px rgba(245,158,11,.8))' : 'drop-shadow(0 1px 3px rgba(0,0,0,.3))'}">${getEmoji(type)}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size],
  })
}

function createPinIcon() {
  return L.divIcon({
    className: '',
    html: `<div style="font-size:34px;line-height:1;filter:drop-shadow(0 2px 5px rgba(0,0,0,.4))">📍</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 34],
    popupAnchor: [0, -34],
  })
}

function FitBoundsOnMount({ vehicles, locations, geofences }) {
  const map = useMap()
  useEffect(() => {
    const pts = [
      ...geofences.flatMap(g => (g.coordinates || []).map(c => [c[0], c[1]])),
      ...vehicles
        .filter(v => locations[v.id]?.latitude && locations[v.id]?.longitude)
        .map(v => [locations[v.id].latitude, locations[v.id].longitude]),
    ]
    if (pts.length > 0) {
      const b = L.latLngBounds(pts)
      if (b.isValid()) map.fitBounds(b, { padding: [50, 50] })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

function MapPinHandler({ disabled, onPin }) {
  useMapEvents({
    click(e) {
      if (disabled) return
      onPin(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

function GeofenceLayer({ geofences }) {
  return (
    <>
      {geofences.map((g, idx) => {
        const coords = (g.coordinates || []).map(c => [c[0], c[1]])
        if (coords.length < 3) return null
        const color = GEOFENCE_COLORS[g.category] || '#8b5cf6'
        return (
          <Polygon
            key={idx}
            positions={coords}
            pathOptions={{ color, weight: 2, fillOpacity: 0.1, interactive: false }}
          />
        )
      })}
    </>
  )
}

const qBtn = {
  flex: 1,
  padding: '5px 8px',
  borderRadius: 6,
  border: '1px solid rgba(255,255,255,0.08)',
  background: 'rgba(255,255,255,0.04)',
  color: 'rgba(255,255,255,0.5)',
  fontSize: 11,
  cursor: 'pointer',
  fontWeight: 500,
}

function PinPanel({ pin, vehicles, locations, onRelocate, onCopy, onGoogleMaps, onClose }) {
  const [selectedVehicle, setSelectedVehicle] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setSelectedVehicle(null)
  }, [pin])

  const handleRelocate = async () => {
    if (!selectedVehicle || !pin) return
    setSaving(true)
    try {
      await onRelocate(selectedVehicle, pin.lat, pin.lng)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  if (!pin) return null

  return (
    <div
      ref={el => { if (el) L.DomEvent.disableClickPropagation(el) }}
      style={{
        position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
        zIndex: 800, width: 340,
        background: 'rgba(10,12,22,0.96)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 14, overflow: 'hidden',
        backdropFilter: 'blur(16px)',
        boxShadow: '0 16px 50px rgba(0,0,0,0.5)',
      }}
    >
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>📍</span>
          <div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Pinned Location</div>
            <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#e8eaf2', fontWeight: 600, marginTop: 1 }}>
              {pin.lat.toFixed(6)}, {pin.lng.toFixed(6)}
            </div>
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
      </div>

      <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', gap: 6 }}>
        <button onClick={onCopy} style={qBtn}>📋 Copy</button>
        <button onClick={onGoogleMaps} style={qBtn}>🗺 Google Maps</button>
      </div>

      {vehicles.length > 0 && (
        <div style={{ padding: '10px 12px' }}>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, fontWeight: 600 }}>
            Move Vehicle Here
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 160, overflowY: 'auto' }}>
            {vehicles.map(v => {
              const loc = locations[v.id]
              const isSel = selectedVehicle === v.id
              return (
                <button key={v.id} onClick={() => setSelectedVehicle(isSel ? null : v.id)} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '7px 9px', borderRadius: 7, cursor: 'pointer', textAlign: 'left',
                  border: `1px solid ${isSel ? 'rgba(245,158,11,0.5)' : 'rgba(255,255,255,0.06)'}`,
                  background: isSel ? 'rgba(245,158,11,0.12)' : 'rgba(255,255,255,0.03)',
                  transition: 'all 0.15s',
                }}>
                  <span style={{ fontSize: 18 }}>{getEmoji(v.vehicle_type)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: isSel ? '#f59e0b' : '#e8eaf2' }}>{v.vehicle_number}</div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>
                      {v.driver_name}
                      {loc && <span style={{ fontFamily: 'monospace', marginLeft: 4 }}>
                        ({loc.latitude?.toFixed(3)}, {loc.longitude?.toFixed(3)})
                      </span>}
                    </div>
                  </div>
                  {isSel && <span style={{ color: '#f59e0b', fontSize: 12 }}>✓</span>}
                </button>
              )
            })}
          </div>

          {selectedVehicle && (
            <button onClick={handleRelocate} disabled={saving} style={{
              marginTop: 8, width: '100%', padding: '9px 0', borderRadius: 8, border: 'none',
              background: 'linear-gradient(135deg, #f59e0b, #d97706)',
              color: '#000', fontSize: 13, fontWeight: 700,
              cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1,
            }}>
              {saving ? 'Moving…' : `Move ${vehicles.find(v => v.id === selectedVehicle)?.vehicle_number} here`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function MapEditor({ onLocationSelect, initialLat, initialLng, height = '400px' }) {
  const [selected, setSelected] = useState(
    initialLat && initialLng ? { lat: initialLat, lng: initialLng } : null
  )

  const handleSelect = (lat, lng) => {
    setSelected({ lat, lng })
    onLocationSelect(lat, lng)
  }

  const center = selected
    ? [selected.lat, selected.lng]
    : initialLat && initialLng ? [initialLat, initialLng] : INDIA_CENTER

  return (
    <div style={{ height, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
      <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap contributors" />
        <MapPinHandler disabled={false} onPin={handleSelect} />
        {selected && (
          <Marker position={[selected.lat, selected.lng]}>
            <Popup>
              <div style={{ fontSize: 12, fontFamily: 'monospace' }}>
                {selected.lat.toFixed(6)}, {selected.lng.toFixed(6)}
              </div>
            </Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  )
}

export function GeofenceMapDisplay({
  geofences = [], vehicles = [], locations = {},
  onCoordinatesSelect, onVehicleLocationUpdate,
  height = '500px',
}) {
  const [pin, setPin] = useState(null)

  const handlePin = useCallback((lat, lng) => {
    setPin({ lat, lng })
    onCoordinatesSelect && onCoordinatesSelect(lat, lng)
  }, [onCoordinatesSelect])

  const handleRelocate = useCallback(async (vehicleId, lat, lng) => {
    if (onVehicleLocationUpdate) {
      await onVehicleLocationUpdate(vehicleId, lat, lng)
    }
  }, [onVehicleLocationUpdate])

  const firstPoint = geofences[0]?.coordinates?.[0]
  const center = firstPoint ? [firstPoint[0], firstPoint[1]] : INDIA_CENTER

  return (
    <div style={{ height, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', position: 'relative' }}>
      <MapContainer center={center} zoom={5} style={{ height: '100%', width: '100%' }}>
        <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" attribution="© CARTO" maxZoom={19} />
        <FitBoundsOnMount vehicles={vehicles} locations={locations} geofences={geofences} />
        <GeofenceLayer geofences={geofences} />
        <MapPinHandler disabled={false} onPin={handlePin} />
        {vehicles.map(v => {
          const loc = locations[v.id]
          if (!loc?.latitude || !loc?.longitude) return null
          return (
            <Marker key={v.id} position={[loc.latitude, loc.longitude]} icon={createVehicleIcon(v.vehicle_type)}>
              <Popup>
                <div style={{ fontSize: 12 }}>
                  <div style={{ fontWeight: 700, marginBottom: 3 }}>{getEmoji(v.vehicle_type)} {v.vehicle_number}</div>
                  <div style={{ color: '#888' }}>{v.driver_name}</div>
                  <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#666', marginTop: 3 }}>
                    {loc.latitude.toFixed(6)}, {loc.longitude.toFixed(6)}
                  </div>
                </div>
              </Popup>
            </Marker>
          )
        })}
        {pin && <Marker position={[pin.lat, pin.lng]} icon={createPinIcon()} />}
      </MapContainer>

      <PinPanel
        pin={pin}
        vehicles={vehicles}
        locations={locations}
        onRelocate={handleRelocate}
        onCopy={() => { navigator.clipboard.writeText(`${pin.lat.toFixed(6)}, ${pin.lng.toFixed(6)}`) }}
        onGoogleMaps={() => window.open(`https://www.google.com/maps?q=${pin.lat},${pin.lng}`, '_blank')}
        onClose={() => setPin(null)}
      />
    </div>
  )
}

export function VehicleRelocationMap({ vehicles = [], locations = {}, geofences = [], onVehicleLocationUpdate, height = '500px' }) {
  const [pin, setPin] = useState(null)
  const [draggedId, setDraggedId] = useState(null)
  const markerRefs = useRef({})

  const handleRelocate = useCallback(async (vehicleId, lat, lng) => {
    if (onVehicleLocationUpdate) {
      await onVehicleLocationUpdate(vehicleId, lat, lng)
    }
  }, [onVehicleLocationUpdate])

  useEffect(() => {
    Object.entries(markerRefs.current).forEach(([vehicleId, m]) => {
      if (!m) return
      m.off('dragstart').off('dragend')
      m.on('dragstart', () => setDraggedId(vehicleId))
      m.on('dragend', async () => {
        setDraggedId(null)
        const latlng = m.getLatLng()
        await handleRelocate(vehicleId, latlng.lat, latlng.lng)
      })
      try { m.dragging?.enable() } catch {}
    })
  }, [vehicles, locations, handleRelocate])

  const firstVehicleLoc = vehicles.find(v => locations[v.id]?.latitude)
  const center = firstVehicleLoc
    ? [locations[firstVehicleLoc.id].latitude, locations[firstVehicleLoc.id].longitude]
    : INDIA_CENTER

  return (
    <div style={{ height, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', position: 'relative' }}>
      <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }}>
        <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" attribution="© CARTO" maxZoom={19} />
        <FitBoundsOnMount vehicles={vehicles} locations={locations} geofences={geofences} />
        <GeofenceLayer geofences={geofences} />
        <MapPinHandler disabled={false} onPin={(lat, lng) => setPin({ lat, lng })} />

        {vehicles.map(v => {
          const loc = locations[v.id]
          if (!loc?.latitude || !loc?.longitude) return null
          const isDragged = draggedId === v.id
          return (
            <Marker
              key={v.id}
              position={[loc.latitude, loc.longitude]}
              draggable
              icon={createVehicleIcon(v.vehicle_type, isDragged)}
              ref={m => { if (m) markerRefs.current[v.id] = m }}
            >
              <Popup>
                <div style={{ fontSize: 12 }}>
                  <div style={{ fontWeight: 700, marginBottom: 3 }}>{getEmoji(v.vehicle_type)} {v.vehicle_number}</div>
                  <div style={{ color: '#888' }}>{v.driver_name} · {v.vehicle_type}</div>
                  <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#666', marginTop: 3 }}>
                    {loc.latitude.toFixed(6)}, {loc.longitude.toFixed(6)}
                  </div>
                  <div style={{ fontSize: 10, color: '#555', marginTop: 4 }}>💡 Drag to relocate</div>
                </div>
              </Popup>
            </Marker>
          )
        })}

        {pin && <Marker position={[pin.lat, pin.lng]} icon={createPinIcon()} />}
      </MapContainer>

      <PinPanel
        pin={pin}
        vehicles={vehicles}
        locations={locations}
        onRelocate={handleRelocate}
        onCopy={() => { navigator.clipboard.writeText(`${pin.lat.toFixed(6)}, ${pin.lng.toFixed(6)}`) }}
        onGoogleMaps={() => window.open(`https://www.google.com/maps?q=${pin.lat},${pin.lng}`, '_blank')}
        onClose={() => setPin(null)}
      />
    </div>
  )
}

export { VehicleRelocationMap as VehicleMapDisplay }