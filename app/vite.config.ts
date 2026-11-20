import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Mobile-first PWA; every orientation is supported.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registered by src/swUpdate.ts, which also owns the single bounded
      // reload after an update. The plugin's own client is not used: its
      // reload-on-activate has no limit and can loop.
      injectRegister: null,
      includeAssets: ['favicon.svg', 'robots.txt'],
      manifest: {
        // `id` must keep resolving to the current implicit identity
        // (start_url, https://<origin>/) or existing installs are orphaned.
        id: '/',
        name: 'Shithead',
        short_name: 'Shithead',
        description: 'The classic shedding card game',
        theme_color: '#173d2f',
        background_color: '#0c2b21',
        display: 'standalone',
        // Scope is what Chrome's WebAPK turns into an Android intent filter,
        // so an installed app claims every invite link on this origin. Stated
        // here rather than inherited from the plugin defaults.
        start_url: '/',
        scope: '/',
        // A second invite opened while the app is running reuses the window;
        // the reload re-reads ?room= through initialMode().
        launch_handler: { client_mode: 'navigate-existing' },
        handle_links: 'preferred',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webp,mp3}'],
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
    sourcemap: false,
    rolldownOptions: {
      output: {
        // The libraries are two thirds of the JavaScript and change only when
        // a dependency is upgraded; the app code changes with nearly every
        // deploy. In chunks of their own their hashes stay put, so a returning
        // player's service worker downloads just the app chunk after a deploy.
        // Everything is still loaded up front: no screen is fetched on demand.
        codeSplitting: {
          groups: [
            { name: 'react', test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 3 },
            { name: 'motion', test: /[\\/]node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/, priority: 2 },
            { name: 'vendor', test: /[\\/]node_modules[\\/]/, priority: 1 },
          ],
        },
      },
    },
  }
})
