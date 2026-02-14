import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    let base = env.VITE_BASE || '/';
    if (!base.endsWith('/')) {
      base += '/';
    }
    return {
      base,
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        react(),
        tailwindcss(),
        VitePWA({
          registerType: 'autoUpdate',
          injectRegister: 'auto',
          manifest: {
            name: 'CoverFlow Designer',
            short_name: 'CoverFlow',
            description: 'CoverFlow - Professional SVG cover designer',
            start_url: base,
            scope: base,
            display: 'standalone',
            background_color: '#0f172a',
            theme_color: '#0f172a',
            icons: [
              {
                src: `${base}icons/icon-192.png`,
                sizes: '192x192',
                type: 'image/png'
              },
              {
                src: `${base}icons/icon-512.png`,
                sizes: '512x512',
                type: 'image/png'
              }
            ]
          }
        })
      ],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
