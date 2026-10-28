import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

export default defineConfig({
    plugins: [tailwindcss()],
    build: {
        lib: {
            entry: resolve(__dirname, 'src/index.ts'),
            name: 'HopePlayer',
            fileName: () => 'hope-player.js',
            formats: ['es'],
        },
        // hls.js external değil — kendi lazy chunk'ına gömülür, tüketen sitenin ayrıca kurmasına gerek yok.
        rollupOptions: {
            output: {
                // Dinamik import()'lar (plugin/hls.js) kendi chunk'larına ayrılır; hope-player.js küçük bir re-export shim'i, asıl kod hash'li chunk'ta.
                chunkFileNames: 'chunks/[name]-[hash].js',
            },
        },
        sourcemap: true,
        emptyOutDir: true,
    },
});
