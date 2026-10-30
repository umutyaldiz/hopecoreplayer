import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string };

export default defineConfig({
    // Varsayılan core adresi bu paketle aynı sürüme sabitlenir (jsDelivr) — package.json'dan, elle güncellenmez.
    define: { __HOPE_VERSION__: JSON.stringify(pkg.version) },
    build: {
        lib: {
            // player-html: React Native'e bağımlı olmayan köprü sayfası — kendi WebView kurulumunu yapanlar ve testler için.
            entry: { 'hope-player-react-native': resolve(__dirname, 'src/index.ts'), 'player-html': resolve(__dirname, 'src/playerHtml.ts') },
            formats: ['es'],
            fileName: (_format, name) => `${name}.js`,
        },
        rollupOptions: {
            // react / react-native / react-native-webview tüketicinin kendi kopyasından gelir — gömülmez.
            external: ['react', 'react/jsx-runtime', 'react-native', 'react-native-webview', '@hopeplayer/core'],
        },
        sourcemap: true,
        emptyOutDir: true,
    },
});
