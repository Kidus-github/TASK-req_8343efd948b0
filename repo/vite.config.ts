import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'node:path';

export default defineConfig({
  plugins: [svelte({ hot: !process.env.VITEST })],
  resolve: {
    alias: {
      $lib: path.resolve(__dirname, 'src/lib')
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          'face-api': ['face-api.js']
        }
      }
    }
  },
  worker: {
    format: 'es'
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html']
    }
  }
});
