import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the page and the API share one origin through this proxy, exactly as CloudFront does in AWS.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': process.env.API_URL ?? 'http://localhost:3000' },
  },
  preview: { port: 4173, proxy: { '/api': process.env.API_URL ?? 'http://localhost:3000' } },
  build: { sourcemap: false },
});
