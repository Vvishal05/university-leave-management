import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.DEV_API_PROXY_TARGET;
  return {
    plugins: [react()],
    server: target ? {
      proxy: {
        '/api': { target, changeOrigin: true },
        '/uploads': { target, changeOrigin: true }
      }
    } : undefined
  };
});
