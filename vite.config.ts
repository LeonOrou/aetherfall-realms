import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => ({
  // Set VITE_BASE_PATH=/repository-name/ in GitHub Actions. Root works locally.
  base: mode === 'production' ? process.env.VITE_BASE_PATH || './' : '/',
  build: {
    emptyOutDir: true,
    // Phaser is intentionally shipped as one engine chunk; its gzip size is ~350 kB.
    chunkSizeWarningLimit: 1400
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['assets/*'],
      manifest: {
        name: 'Aetherfall Realms',
        short_name: 'Aetherfall',
        description: 'A compact fantasy civilization strategy game.',
        theme_color: '#141b24',
        background_color: '#0b1017',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        icons: [
          { src: 'assets/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'assets/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'assets/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        navigateFallback: 'index.html',
        globPatterns: ['**/*.{js,css,html,svg,png,webp,woff2}'],
        cleanupOutdatedCaches: true
      }
    })
  ],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
}));
