import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useAlertSocket } from '../hooks/useAlertSocket'
import { useToast } from '../context/ToastContext'
import { useCallback, useState, useEffect } from 'react'

const navItems = [
  { to: '/',           icon: GridIcon,   label: 'Dashboard' },
  { to: '/map',        icon: MapIcon,    label: 'Live Map' },
  { to: '/geofences',  icon: FenceIcon,  label: 'Geofences' },
  { to: '/vehicles',   icon: TruckIcon,  label: 'Vehicles' },
  { to: '/alerts',     icon: BellIcon,   label: 'Alerts' },
  { to: '/violations', icon: ShieldIcon, label: 'Violations' },
]

export default function Layout() {
  const { user }              = useAuth()
  const { alert: toastAlert } = useToast()
  const location              = useLocation()
  const [alertCount, setAlertCount] = useState(0)

  useEffect(() => {
    if (location.pathname === '/alerts') setAlertCount(0)
  }, [location.pathname])

  useEffect(() => {
    const clear = () => setAlertCount(0)
    window.addEventListener('alerts-cleared', clear)
    return () => window.removeEventListener('alerts-cleared', clear)
  }, [])

  const onAlert = useCallback((a) => {
    setAlertCount((n) => n + 1)
    const label = a.event_type === 'entry' ? '🟢 Entered' : '🔴 Exited'
    toastAlert(`${label} ${a.geofence?.geofence_name}`, {
      title: a.vehicle?.vehicle_number,
      sub: `${a.location?.latitude?.toFixed(5)}, ${a.location?.longitude?.toFixed(5)}`,
    })
  }, [toastAlert])

  // FIX: useAlertSocket returns an object {status, isWaking} — not a string
  const { status: wsStatus, isWaking } = useAlertSocket(onAlert)

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <aside style={{
        width: 220, minWidth: 220,
        background: 'var(--surface-800)',
        borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        padding: '0 12px', overflowY: 'auto',
      }}>
        {/* Logo */}
        <div style={{ padding: '20px 4px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg width="28" height="28" viewBox="0 0 36 36" fill="none" style={{ flexShrink: 0 }}>
              <rect width="36" height="36" rx="9" fill="rgba(245,158,11,0.15)"/>
              <path d="M18 7C12.48 7 8 11.48 8 17c0 6.37 10 18 10 18s10-11.63 10-18c0-5.52-4.48-10-10-10zm0 13.5a3.5 3.5 0 110-7 3.5 3.5 0 010 7z" fill="#f59e0b"/>
            </svg>
            <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 17, color: '#e8eaf2', letterSpacing: '-0.02em' }}>
              GeoTrack
            </span>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => `sidebar-item${isActive ? ' active' : ''}`}
            >
              <Icon size={16} />
              <span>{label}</span>
              {label === 'Alerts' && alertCount > 0 && (
                <span style={{
                  marginLeft: 'auto', background: 'var(--amber)', color: '#0a0c12',
                  borderRadius: 10, fontSize: 10, fontWeight: 700,
                  padding: '1px 6px', minWidth: 18, textAlign: 'center',
                }}>
                  {alertCount > 99 ? '99+' : alertCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Bottom: WS status + user */}
        <div style={{ paddingBottom: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', marginBottom: 8 }}>
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              background: wsStatus === 'open' ? '#10b981' : wsStatus === 'connecting' ? '#f59e0b' : '#f43f5e',
              flexShrink: 0,
            }} />
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {isWaking
                ? 'Backend waking up…'
                : wsStatus === 'open'
                  ? 'Live alerts active'
                  : wsStatus === 'connecting'
                    ? 'Connecting…'
                    : 'Alerts offline'}
            </span>
          </div>

          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 10px', borderRadius: 8,
            background: 'var(--surface-700)',
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              background: 'rgba(245,158,11,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 600, color: 'var(--amber)', flexShrink: 0,
            }}>
              {user?.email?.[0]?.toUpperCase() || 'U'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user?.email}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'capitalize' }}>{user?.role}</div>
            </div>
          </div>
        </div>
      </aside>

      <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <Outlet />
      </main>
    </div>
  )
}

function GridIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <rect x="1"  y="1"  width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
      <rect x="11" y="1"  width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
      <rect x="1"  y="11" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
      <rect x="11" y="11" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  )
}
function MapIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <path d="M1 3.5l5-2 6 3 5-2.5v12l-5 2.5-6-3L1 16V3.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
      <path d="M6 1.5v12M12 4.5v12" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  )
}
function FenceIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <path d="M9 2L13 6H5L9 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
      <rect x="2" y="6" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M6 6v10M12 6v10" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  )
}
function TruckIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <rect x="1" y="4" width="11" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M12 7h2.5L16 10v2h-4V7z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
      <circle cx="4.5" cy="13" r="1.5" stroke="currentColor" strokeWidth="1.5"/>
      <circle cx="13.5" cy="13" r="1.5" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  )
}
function BellIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <path d="M9 2a5 5 0 00-5 5v4l-2 2h14l-2-2V7a5 5 0 00-5-5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
      <path d="M7 13a2 2 0 004 0" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  )
}
function ShieldIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <path d="M9 2L3 4.5v5C3 13.5 9 17 9 17s6-3.5 6-7.5v-5L9 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
      <path d="M6.5 9l2 2 3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}