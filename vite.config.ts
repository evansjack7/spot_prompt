import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// BASE lets the GitHub Pages build live under /<repo>/; default is relative.
export default defineConfig({
  base: process.env.BASE ?? './',
  build: { target: 'es2022', chunkSizeWarningLimit: 7000 },
  plugins: [
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'SpotPrompt Teleprompter',
        short_name: 'SpotPrompt',
        description: 'Voice-tracking teleprompter that works offline',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        orientation: 'any',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        // vosk-browser bundles its WebAssembly (~6 MB) — precache it so offline works
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // user-imported model archive, stored by the app in this cache
            urlPattern: ({ url }) => url.pathname.endsWith('/vosk-model/imported-model.tar.gz'),
            handler: 'CacheOnly',
            options: { cacheName: 'spotprompt-vosk-import' },
          },
        ],
      },
    }),
  ],
});
