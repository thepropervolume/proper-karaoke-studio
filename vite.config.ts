import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { desktopDocumentation } from './scripts/desktop-documentation.mts';

const root = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  plugins: [react(), desktopDocumentation(root)],
  base: './',
  build: {
    outDir: 'dist', emptyOutDir: true,
    rolldownOptions: { input: { studio: 'index.html', documentation: 'src/help/index.html', splash: 'src/splash/index.html' } },
  },
});
