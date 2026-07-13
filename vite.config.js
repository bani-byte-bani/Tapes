import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// vite build は src 以下だけを dist/ に出力する。
// API(/api/...)は worker/index.js が担当し、wrangler.toml の [assets] 設定で
// dist/ を静的アセットとして配信する(詳細はwrangler.toml参照)。
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
});
