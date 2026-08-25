import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  base: '/Mortgage_DTI/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      // Only the app shell (JS/CSS/HTML/icons) gets precached for offline
      // opening — Supabase requests are cross-origin and untouched by this,
      // so balances and payments always come straight from the network,
      // never a stale cached copy.
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        navigateFallback: '/Mortgage_DTI/index.html',
      },
      manifest: {
        name: 'Clear to Close',
        short_name: 'Clear2Close',
        description: 'Debt payoff & DTI tracker',
        start_url: '/Mortgage_DTI/',
        scope: '/Mortgage_DTI/',
        display: 'standalone',
        background_color: '#ECE6D6',
        theme_color: '#ECE6D6',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
