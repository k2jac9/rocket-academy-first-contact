import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'FIRST_CONTACT_');
  const port = Number(env.FIRST_CONTACT_API_PORT || 8787);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('FIRST_CONTACT_API_PORT must be an integer from 1024 to 65535.');
  const apiProxy = { target: `http://127.0.0.1:${port}`, changeOrigin: true };
  return {
    plugins: [react()],
    server: { proxy: { '/api': apiProxy } },
    preview: { proxy: { '/api': apiProxy } },
    test: { include: ['src/**/*.test.ts', 'server/**/*.test.ts'], environment: 'node' },
    build: { chunkSizeWarningLimit: 1000 },
  };
});
