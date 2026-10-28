import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';

export default defineConfig({
    plugins: [
        vue({
            template: {
                compilerOptions: {
                    // Açıkça verilmeli: yoksa derleyici hope-player'ı component olarak çözmeye çalışıp
                    // sonsuz döngüye giriyor ("Maximum call stack size exceeded").
                    isCustomElement: (tag) => tag === 'hope-player',
                },
            },
        }),
    ],
    build: {
        lib: {
            entry: resolve(__dirname, 'src/index.ts'),
            name: 'HopePlayerVue',
            fileName: () => 'hope-player-vue.js',
            formats: ['es'],
        },
        rollupOptions: {
            // vue ve core tüketicinin kendi kopyasından gelir — gömülmez.
            external: ['vue', '@hopeplayer/core'],
        },
        sourcemap: true,
        emptyOutDir: true,
    },
});
