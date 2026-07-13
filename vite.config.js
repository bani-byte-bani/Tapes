import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Cloudflare Pages Functions (functions/api/...) はビルド対象に含めない。
// vite build は src 以下だけを dist/ に出力し、
// functions/ は Cloudflare Pages が自動的にそのままデプロイする。
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
});
