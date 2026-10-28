import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
    build: {
        lib: {
            entry: resolve(__dirname, 'src/index.ts'),
            name: 'HopePlayerReact',
            fileName: () => 'hope-player-react.js',
            formats: ['es'],
        },
        rollupOptions: {
            // react ve core tüketicinin kendi kopyasından gelir — gömülmez.
            external: ['react', 'react/jsx-runtime', '@hopeplayer/core'],
            output: {
                // Bundler "use client" direktifini atıyor — Next.js App Router için ilk satıra geri ekleniyor.
                banner: "'use client';",
            },
        },
        sourcemap: true,
        emptyOutDir: true,
    },
});
