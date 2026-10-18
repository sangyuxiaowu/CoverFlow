import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
    const isTauriMode = mode === 'tauri';
    const env = loadEnv(mode, '.', '');
    let base = env.VITE_BASE || '/';
    if (!base.endsWith('/')) {
      base += '/';
    }
    const plugins = [
      react(),
      tailwindcss(),
      VitePWA({
        disable: isTauriMode || mode === 'test',
        registerType: 'prompt',
        includeManifestIcons: false,
        manifest: {
          id: base,
          name: 'CoverFlow Designer',
          short_name: 'CoverFlow',
          description: 'CoverFlow - Professional SVG cover designer',
          start_url: base,
          scope: base,
          display: 'standalone',
          orientation: 'portrait-primary',
          background_color: '#0f172a',
          theme_color: '#0f172a',
          categories: ['design', 'graphics', 'productivity', 'utilities'],
          icons: [
            {
              src: `${base}icons/icon-192.png`,
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any'
            },
            {
              src: `${base}icons/icon-512.png`,
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any'
            },
            {
              src: `${base}icons/icon-512.png`,
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable'
            },
            {
              src: `${base}icons/icon.svg`,
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any'
            }
          ]
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2,onnx}'],
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          cleanupOutdatedCaches: true
        }
      })
    ];

    return {
      base,
      server: {
        port: 3000,
        host: '0.0.0.0',
        watch: {
          ignored: ['**/src-tauri/target/**', '**/doc/**', '**/docs/**', '**/*.md', '**/*.mdx'],
        },
      },
      plugins,
      resolve: {
        alias: {
          '@': path.resolve(__dirname, 'src'),
        }
      }
    };
});
