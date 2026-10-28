/** .m3u8: Safari/iOS'ta native HLS; diğerlerinde hls.js yalnızca gerektiğinde dinamik import edilir. */
export interface HlsQualityLevel {
    index: number;
    height: number;
    bitrate: number;
}

type HlsModule = typeof import('hls.js');
type HlsInstance = InstanceType<HlsModule['default']>;

function isHlsSource(src: string, type?: string): boolean {
    if (type === 'application/x-mpegURL' || type === 'application/vnd.apple.mpegurl') return true;
    return /\.m3u8($|\?)/i.test(src);
}

export class SourceManager {
    private hls: HlsInstance | null = null;
    private readonly video: HTMLVideoElement;
    private readonly onLevelsChanged: (levels: HlsQualityLevel[], activeIndex: number) => void;

    constructor(video: HTMLVideoElement, onLevelsChanged: (levels: HlsQualityLevel[], activeIndex: number) => void) {
        this.video = video;
        this.onLevelsChanged = onLevelsChanged;
    }

    async load(src: string, type?: string): Promise<void> {
        this.destroy();

        if (!isHlsSource(src, type)) {
            this.video.src = src;
            return;
        }

        // Safari/iOS: native HLS, hls.js'e hiç gerek yok.
        if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
            this.video.src = src;
            return;
        }

        const { default: Hls } = await import('hls.js');
        if (!Hls.isSupported()) {
            // Son çare: tarayıcı ne native ne hls.js destekliyor — yine de dene.
            this.video.src = src;
            return;
        }

        const hls = new Hls({ enableWorker: true });
        this.hls = hls;
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            const levels: HlsQualityLevel[] = hls.levels.map((l, index) => ({
                index,
                height: l.height,
                bitrate: l.bitrate,
            }));
            this.onLevelsChanged(levels, hls.currentLevel);
        });
        hls.on(Hls.Events.LEVEL_SWITCHED, (_evt, data) => {
            this.onLevelsChanged(
                hls.levels.map((l, index) => ({ index, height: l.height, bitrate: l.bitrate })),
                data.level
            );
        });
        hls.attachMedia(this.video);
        hls.loadSource(src);
    }

    /** -1 = otomatik (ABR). */
    setLevel(index: number): void {
        if (this.hls) this.hls.currentLevel = index;
    }

    destroy(): void {
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
    }
}
