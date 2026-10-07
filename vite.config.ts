import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base is /Outbreak/ for production (GitHub Pages) and / for development.
export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/Outbreak/' : '/',
  plugins: [react()],
  worker: { format: 'es' },
  build: { outDir: 'dist', chunkSizeWarningLimit: 3000 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
}));
