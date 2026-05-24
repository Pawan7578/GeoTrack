import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  plugins: [react()],

  server: {
    port: 3000,
    proxy: {
      // In local dev, proxy /api to the backend so there are no CORS issues.
      // The backend URL is read from VITE_API_URL via the .env file.
      // Vite's dev server does NOT use import.meta.env at config time —
      // process.env is used here intentionally.
      '/api': {
        target: (process.env.VITE_API_URL || 'http://localhost:8080/api')
          .replace(/\/api\/?$/, ''),
        changeOrigin: true,
      },
    },
  },

  build: {
    // Useful for diagnosing bundle issues in production
    sourcemap: mode !== 'production',
  },
}))
