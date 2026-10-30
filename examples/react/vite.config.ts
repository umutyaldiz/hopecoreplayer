import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    // hls.js yalnızca HLS kaynakta isteğe bağlı yüklenen ayrı bir chunk — boyut uyarısı beklenen durum.
    build: { chunkSizeWarningLimit: 1000 },
});
