import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ToastProvider } from './context/ToastContext'
import Layout from './components/Layout'
import DashboardPage from './pages/DashboardPage'
import MapPage from './pages/MapPage'
import GeofencesPage from './pages/GeofencesPage'
import VehiclesPage from './pages/VehiclesPage'
import AlertsPage from './pages/AlertsPage'
import ViolationsPage from './pages/ViolationsPage'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<DashboardPage />} />
              <Route path="map" element={<MapPage />} />
              <Route path="geofences" element={<GeofencesPage />} />
              <Route path="vehicles" element={<VehiclesPage />} />
              <Route path="alerts" element={<AlertsPage />} />
              <Route path="violations" element={<ViolationsPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
