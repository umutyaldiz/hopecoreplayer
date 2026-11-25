import { defineConfig, transformWithEsbuild, type Plugin } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string };

/** Klasör adı seçenek adıyla aynı değilse (ör. plugins/rewarded → `rewardedUnlock`). */
const OPTION_NAMES: Record<string, string> = {
    rewarded: 'rewardedUnlock',
    live: 'liveWallClock',
    stats: 'statsPanel',
    debug: 'debugPanel',
};
/** Eklenti klasörü dışındaki parçalar (dosya adına göre). */
const FILE_NAMES: Record<string, string> = {
    index: 'player',
    VideoPrebid: 'prebid',
    loadGpt: 'gpt',
    ScratchSound: 'audioScratchSound',
    'hls.light': 'hlsLight',
    PluginHost: 'pluginHost',
    dashEngine: 'dash',
};
const camel = (s: string): string => s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

function chunkName(name: string, facade: string | null): string {
    const plugin = /[\\/]plugins[\\/]([^\\/]+)[\\/]index\.ts$/.exec(facade ?? '');
    if (plugin) return OPTION_NAMES[plugin[1]!] ?? camel(plugin[1]!);
    // src/ altındaki diğer klasör girişleri (ör. scte35/index.ts) klasör adını alır — "player" değil.
    const folder = /[\\/]src[\\/]([^\\/]+)[\\/]index\.ts$/.exec(facade ?? '');
    if (folder) return camel(folder[1]!);
    return FILE_NAMES[name] ?? name;
}

/**
 * Tüm parçaları küçült: Vite kütüphane modunda (es) boşlukları küçültmüyor. Kendi kodumuz da küçültülür (ilk yükleme
 * ~81 → ~63 KB gzip, PageSpeed "Minify JavaScript"); hata ayıklama için kaynak haritaları üretilir.
 */
const minifyChunks = (): Plugin => ({
    name: 'hope:minify',
    // order 'post': Vite'in kendi renderChunk'ı (es kütüphanede boşlukları koruyarak) kodu yeniden biçimlendiriyor —
    // ondan sonra küçültmek gerek. renderChunk'ta olduğu için dosya adındaki hash küçültülmüş içerikten hesaplanır.
    renderChunk: {
        order: 'post',
        async handler(code, chunk) {
            const out = await transformWithEsbuild(code, chunk.fileName, { minify: true, sourcemap: true, target: 'esnext', legalComments: 'none' });
            return { code: out.code, map: out.map };
        },
    },
});

export default defineConfig({
    plugins: [tailwindcss(), minifyChunks()],
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
                // Parça adı = açan seçeneğin adı (adTriggers-…, redirectScreen-…, player-…) — hepsi "index-…" görünüp ağ
                // sekmesinde / boyut raporunda ayırt edilemiyordu. Sondaki hash içerikten gelir: içerik değişince ad da
                // değişir (yeni sürümde eski parça önbellekten gelmez), değişmeyen parça önbellekte kalır.
                chunkFileNames: (chunk) => `chunks/${chunkName(chunk.name, chunk.facadeModuleId)}-[hash].js`,
            },
        },
        sourcemap: true,
        emptyOutDir: true,
    },
});
