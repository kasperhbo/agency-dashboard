import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    watch: { ignored: ['**/docs/**', '**/test-results/**', '**/playwright-report/**', '**/.agency/**', '**/.remember/**'] },
    proxy: { '/api': 'http://127.0.0.1:4318' },
  },
});
