import { createContext, useContext, useState } from 'react'

const AuthContext = createContext(null)

// Mock user for non-authenticated mode
const MOCK_USER = {
  id: 'system-001',
  email: 'System',
  role: 'admin',
}

export function AuthProvider({ children }) {
  const [user] = useState(MOCK_USER)
  const [loading] = useState(false)

  const logout = () => {
    // No-op in non-authenticated mode
  }

  return (
    <AuthContext.Provider value={{ user, loading, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
