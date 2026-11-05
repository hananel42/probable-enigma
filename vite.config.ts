import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    // Bind locally by default; opt-in network exposure should be deliberate.
    host: '127.0.0.1',
    strictPort: true
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true
  },
  build: {
    // Source maps are not published unless a release explicitly opts in.
    sourcemap: false
  }
});
