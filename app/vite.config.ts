import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Mobile-first PWA, portrait-locked, no zoom, viewport-fit cover
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'robots.txt'],
      manifest: {
        name: 'Shithead',
        short_name: 'Shithead',
        description: 'The classic shedding card game',
        theme_color: '#2d4a2b',
        background_color: '#faf8f3',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webp,woff2}']
      }
    })
  ],
  server: {
    host: true,
    port: 5173,
    strictPort: false,
    allowedHosts: true, // allow ngrok tunnels
  },
  build: { target: 'es2020', sourcemap: true }
})
