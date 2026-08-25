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
      // injectManifest (a custom src/sw.js, bundled at build time) instead
      // of generateSW — push notifications need a `push` event listener,
      // which generateSW's auto-generated worker has no hook for. The
      // precaching behavior is unchanged: same app shell, same "Supabase
      // calls are cross-origin and untouched" guarantee, just declared in
      // src/sw.js instead of here.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
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
