import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string };

export default defineConfig({
    plugins: [tailwindcss()],
    // Sağ tık menüsü / istatistik paneli sürümü — package.json'dan, elle güncellenmez.
    define: { __HOPE_VERSION__: JSON.stringify(pkg.version) },
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
