import { defineConfig } from 'vite';

export default defineConfig({
    // hls.js yalnızca HLS kaynakta isteğe bağlı yüklenen ayrı bir chunk — boyut uyarısı beklenen durum.
    build: { chunkSizeWarningLimit: 1000 },
});
