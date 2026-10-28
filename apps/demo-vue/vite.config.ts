import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
    plugins: [vue()],
    // hls.js (~860 kB) yalnızca HLS kaynakta isteğe bağlı yüklenen ayrı bir chunk — boyut uyarısı beklenen durum.
    build: { chunkSizeWarningLimit: 1000 },
});
