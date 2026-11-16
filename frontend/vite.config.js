import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the browser talks to Vite, and Vite forwards /api to the Flask server.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.EDUFIN_API || 'http://localhost:5050', changeOrigin: true } },
  },
});
