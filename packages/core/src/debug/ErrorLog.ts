/** Hata kaydının kaynağı — hata ayıklama ekranında etiket olarak görünür. */
export type PlayerLogSource = 'media' | 'stream' | 'ads' | 'subtitles' | 'player';

export interface PlayerLogEntry {
    /** `Date.now()` */
    time: number;
    source: PlayerLogSource;
    message: string;
    /** Oynatmayı durduran (kurtarılamayan) hata. */
    fatal?: boolean;
    /** Teknik ayrıntılar (hata kodu, URL, HTTP durumu…) — tanımsız değerler gösterilmez. */
    details?: Record<string, string | number | boolean | undefined>;
    /** Aynı hata kısa sürede tekrarlandıysa kaç kez (ör. hls.js buffer takılması) — tek satırda "×3". */
    count?: number;
}

/** Bu süre içinde tekrarlanan aynı hata yeni satır açmaz, sayacı artar. */
const REPEAT_WINDOW_MS = 3000;

const MAX_ENTRIES = 200;

/**
 * Player'ın tüm hatalarının (medya, yayın/hls.js, reklam, altyazı) anlık kaydı. Her zaman tutulur (birkaç yüz bayt);
 * hata ayıklama ekranı ve sağ tık menüsündeki giriş yalnızca `options.debug` açıkken görünür.
 */
export class ErrorLog {
    private readonly list: PlayerLogEntry[] = [];
    /** Kayıt eklenince / temizlenince (açık panel canlı güncellenir). */
    onChange: (() => void) | null = null;

    get entries(): readonly PlayerLogEntry[] {
        return this.list;
    }

    add(entry: Omit<PlayerLogEntry, 'time' | 'count'>): void {
        const now = Date.now();
        const last = this.list[this.list.length - 1];
        if (
            last &&
            now - last.time < REPEAT_WINDOW_MS &&
            last.source === entry.source &&
            last.message === entry.message &&
            JSON.stringify(last.details ?? {}) === JSON.stringify(entry.details ?? {})
        ) {
            last.count = (last.count ?? 1) + 1;
            last.time = now;
            this.onChange?.();
            return;
        }
        this.list.push({ time: now, ...entry });
        if (this.list.length > MAX_ENTRIES) this.list.splice(0, this.list.length - MAX_ENTRIES);
        this.onChange?.();
    }

    clear(): void {
        this.list.length = 0;
        this.onChange?.();
    }

    /** Destek ekibine yapıştırılabilir düz metin. */
    toText(): string {
        return this.list
            .map((e) => {
                const details = Object.entries(e.details ?? {})
                    .filter(([, v]) => v !== undefined && v !== '')
                    .map(([k, v]) => `${k}=${v}`)
                    .join(' ');
                const repeat = e.count && e.count > 1 ? ` (x${e.count})` : '';
                return `${new Date(e.time).toISOString()} [${e.source}]${e.fatal ? ' [fatal]' : ''} ${e.message}${repeat}${details ? ` | ${details}` : ''}`;
            })
            .join('\n');
    }
}
