import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the page and the API share one origin through this proxy, exactly as CloudFront does in AWS.
export default defineConfig(({ command }) => {
  // A build is always a production build, even when the shell has NODE_ENV=development set (some machines do).
  if (command === 'build') process.env.NODE_ENV = 'production';
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: { '/api': process.env.API_URL ?? 'http://localhost:3000' },
    },
    preview: { port: 4173, proxy: { '/api': process.env.API_URL ?? 'http://localhost:3000' } },
    build: { sourcemap: false },
  };
});
