
/**
 * MP4: HTML5 video üzerinden doğrudan oynatılır.
 * M3U8: Safari/iOS'ta native HLS; diğer tarayıcılarda gerektiğinde hls.js.
 */
export interface HlsQualityLevel {
    index: number;
    height: number;
    bitrate: number;
}

type HlsModule = typeof import('hls.js');
type HlsInstance = InstanceType<HlsModule['default']>;

type MediaSourceType = 'hls' | 'mp4' | 'unknown';

/**
 * Kaynak türünü MIME type veya URL uzantısından belirler.
 * URL'deki query string ve fragment değerlerini de destekler.
 */
function detectSourceType(src: string, type?: string): MediaSourceType {
    const normalizedType = type
        ?.split(';')[0]
        ?.trim()
        .toLowerCase();

    // HLS / M3U8
    if (
        normalizedType === 'application/vnd.apple.mpegurl' ||
        normalizedType === 'application/x-mpegurl' ||
        /\.m3u8(?:$|[?#])/i.test(src)
    ) {
        return 'hls';
    }

    // MP4
    if (
        normalizedType === 'video/mp4' ||
        /\.mp4(?:$|[?#])/i.test(src)
    ) {
        return 'mp4';
    }

    return 'unknown';
}

export class SourceManager {
    private hls: HlsInstance | null = null;

    private readonly video: HTMLVideoElement;

    private readonly onLevelsChanged: (
        levels: HlsQualityLevel[],
        activeIndex: number
    ) => void;

    constructor(
        video: HTMLVideoElement,
        onLevelsChanged: (
            levels: HlsQualityLevel[],
            activeIndex: number
        ) => void
    ) {
        this.video = video;
        this.onLevelsChanged = onLevelsChanged;
    }

    async load(src: string, type?: string): Promise<void> {
        // Önce önceki HLS instance'ını kapat.
        this.destroy();

        // Önceki kaynağın video elementinde kalmasını önle.
        this.video.pause();
        this.video.removeAttribute('src');
        this.video.load();

        const sourceType = detectSourceType(src, type);

        // MP4 veya uzantısı belirlenemeyen doğrudan video kaynağı.
        if (sourceType !== 'hls') {
            this.video.src = src;
            this.video.load();
            return;
        }

        // Safari / iOS: native HLS desteği varsa hls.js kullanma.
        if (
            this.video.canPlayType('application/vnd.apple.mpegurl') !== ''
        ) {
            this.video.src = src;
            this.video.load();
            return;
        }

        // Diğer tarayıcılar: hls.js'i yalnızca gerektiğinde yükle.
        const { default: Hls } = await import('hls.js');

        // hls.js desteklenmiyorsa native oynatmayı dene.
        if (!Hls.isSupported()) {
            this.video.src = src;
            this.video.load();
            return;
        }

        const hls = new Hls({
            enableWorker: true,
        });

        this.hls = hls;

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            const levels: HlsQualityLevel[] = hls.levels.map(
                (level, index) => ({
                    index,
                    height: level.height,
                    bitrate: level.bitrate,
                })
            );

            this.onLevelsChanged(levels, hls.currentLevel);
        });

        hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
            const levels: HlsQualityLevel[] = hls.levels.map(
                (level, index) => ({
                    index,
                    height: level.height,
                    bitrate: level.bitrate,
                })
            );

            this.onLevelsChanged(levels, data.level);
        });

        hls.attachMedia(this.video);
        hls.loadSource(src);
    }

    /** -1 = otomatik kalite (ABR). */
    setLevel(index: number): void {
        if (this.hls) {
            this.hls.currentLevel = index;
        }
    }

    destroy(): void {
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
    }
}
