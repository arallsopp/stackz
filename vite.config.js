import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    // Rapier ships a large base64-inlined wasm module; bump the warning limit.
    chunkSizeWarningLimit: 2000,
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      workbox: {
        // Cache everything the built app needs so the PWA runs fully offline,
        // including the inlined Rapier wasm chunk.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,wasm,gltf,bin,jpg,jpeg,glb}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
      manifest: {
        name: 'STACKZ — Neon Demolition',
        short_name: 'STACKZ',
        description: 'Tap to launch balls and obliterate neon structures. Clear the platform in as few shots as possible.',
        theme_color: '#05010f',
        background_color: '#05010f',
        display: 'fullscreen',
        orientation: 'portrait',
        start_url: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
});
