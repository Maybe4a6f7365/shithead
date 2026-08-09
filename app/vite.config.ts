import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Mobile-first PWA; every orientation is supported.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registered explicitly in main.tsx so an activated update reloads an
      // already-open game client instead of leaving it on a stale bundle.
      injectRegister: null,
      includeAssets: ['favicon.svg', 'robots.txt'],
      manifest: {
        name: 'Shithead',
        short_name: 'Shithead',
        description: 'The classic shedding card game',
        theme_color: '#0b1120',
        background_color: '#0b1120',
        display: 'standalone',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webp}'],
        globIgnores: ['fonts/**'],
        // A newly deployed shell takes control immediately and old hashed
        // asset caches are removed. The registration layer performs at most
        // one reload when that new worker activates.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
      }
    })
  ],
  server: {
    host: true,
    port: 5173,
    strictPort: false,
    allowedHosts: true, // allow ngrok tunnels
  },
  build: {
    target: 'es2020',
    // Never ship source maps to production assets (they are publicly served).
    // `vite dev` still serves sourcemaps during local development.
    sourcemap: false
  }
})
