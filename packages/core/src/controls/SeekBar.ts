import type { HopeLocaleStrings } from '../i18n/types';
import { formatTime } from '../utils/format-time';

/**
 * Div tabanlı scrubber (role="slider"). Çizim transform ile (layout tetiklemez), oynarken rAF döngüsü.
 * Chapter modunda zaman ↔ piksel eşlemesi parçaların ölçülmüş geometrisinden.
 */
export interface SeekBarChapterRange {
    /** 0–1 arası oran. */
    start: number;
    end: number;
    /** Bu bölümün oynatılmış dolgusunun rengi — verilmezse tema accent'i. */
    color?: string;
}

interface ChapterState extends SeekBarChapterRange {
    el: HTMLDivElement;
    bufferedEl: HTMLDivElement;
    playedEl: HTMLDivElement;
    /** seek bar'ın sol kenarına göre px — measureChapters() dolduruyor. */
    left: number;
    width: number;
}

/** Canlıda geri sarılabilir pencere bundan kısaysa (sn) yayın DVR'sız sayılır — seek bar pasif. */
const MIN_LIVE_WINDOW_SEC = 10;
/** Canlıda seek bar'ın en sağına tıklanınca canlı ucun bu kadar gerisine gidilir (sn). */
const LIVE_EDGE_SAFETY_SEC = 1;

export class SeekBar {
    readonly el: HTMLDivElement;
    private readonly trackEl: HTMLDivElement;
    private chaptersEl: HTMLDivElement | null = null;
    private chapters: ChapterState[] = [];
    /** İmlecin üstündeki zaman (varsayılan, plugin gerektirmez) — kendi zamanını gösteren plugin'ler `suppressHoverTime` ile gizler. */
    private readonly hoverTimeEl: HTMLDivElement;
    private readonly hoverTimeSuppressors = new Set<string>();
    private readonly playedEl: HTMLDivElement;
    private readonly bufferedEl: HTMLDivElement;
    private readonly thumbEl: HTMLDivElement;
    private readonly hoverDotEl: HTMLDivElement;
    private readonly video: HTMLVideoElement;
    private readonly labels: HopeLocaleStrings;
    private dragging = false;
    private readonly markerEls: HTMLDivElement[] = [];
    private trackWidth = 0;
    private readonly resizeObserver: ResizeObserver;
    private rafId: number | null = null;

    constructor(video: HTMLVideoElement, labels: HopeLocaleStrings) {
        this.video = video;
        this.labels = labels;

        this.el = document.createElement('div');
        this.el.setAttribute('part', 'seek-bar');
        // Tıklama alanı (--hp-seek-hit-h) görünür track'ten büyük.
        this.el.className =
            'hp-seekbar hp:relative hp:h-[var(--hp-seek-hit-h)] hp:flex hp:items-center hp:cursor-pointer hp:group hp:touch-none';
        this.el.setAttribute('role', 'slider');
        this.el.setAttribute('tabindex', '0');
        this.el.setAttribute('aria-label', labels.seekBar);
        this.el.setAttribute('aria-valuemin', '0');

        const track = document.createElement('div');
        track.className =
            'hp:absolute hp:inset-x-0 hp:h-[var(--hp-seek-track-h)] hp:rounded-full hp:bg-on-surface/25 ' +
            'hp:group-hover:h-[var(--hp-seek-track-h-hover)] hp:transition-[height] hp:duration-150';
        this.el.appendChild(track);
        this.trackEl = track;

        this.bufferedEl = document.createElement('div');
        this.bufferedEl.className = 'hp:absolute hp:inset-0 hp:rounded-full hp:bg-on-surface/40';
        this.bufferedEl.style.transformOrigin = 'left';
        this.bufferedEl.style.willChange = 'transform';
        track.appendChild(this.bufferedEl);

        this.playedEl = document.createElement('div');
        this.playedEl.className = 'hp:absolute hp:inset-0 hp:rounded-full hp:bg-accent';
        this.playedEl.style.transformOrigin = 'left';
        this.playedEl.style.willChange = 'transform';
        track.appendChild(this.playedEl);

        // Boyut/ölçek tailwind.css'te (.hp-seek-thumb): her zaman görünür ve küçük, seek bar hover'ında büyür.
        this.thumbEl = document.createElement('div');
        this.thumbEl.className = 'hp-seek-thumb';
        this.thumbEl.setAttribute('part', 'seek-thumb');
        this.el.appendChild(this.thumbEl);

        // İmlecin altındaki küçük nokta — nereye tıklanacağını gösterir.
        this.hoverDotEl = document.createElement('div');
        this.hoverDotEl.className = 'hp-seek-hover-dot';
        this.hoverDotEl.setAttribute('part', 'seek-hover-dot');
        this.el.appendChild(this.hoverDotEl);

        this.hoverTimeEl = document.createElement('div');
        this.hoverTimeEl.className = 'hp-seek-time';
        this.hoverTimeEl.setAttribute('part', 'seek-time');
        this.el.appendChild(this.hoverTimeEl);

        this.el.addEventListener('pointerdown', this.onPointerDown);
        this.el.addEventListener('pointermove', this.onHoverMove);
        this.el.addEventListener('pointerleave', this.onHoverLeave);
        this.el.addEventListener('keydown', this.onKeyDown);
        video.addEventListener('play', this.startLoop);
        video.addEventListener('pause', this.stopLoop);
        video.addEventListener('ended', this.stopLoop);
        // rAF döngüsü yalnızca OYNARKEN çalışır — duraklıyken/scrub ederken
        // (ör. seek sonrası henüz play tetiklenmeden) konum hâlâ güncel
        // kalsın diye timeupdate/progress/loadedmetadata da dinleniyor.
        video.addEventListener('timeupdate', this.render);
        video.addEventListener('progress', this.render);
        video.addEventListener('loadedmetadata', this.render);
        if (!video.paused) this.startLoop();

        this.resizeObserver = new ResizeObserver(() => {
            this.trackWidth = this.layoutWidth();
            this.measureChapters();
            this.render();
        });
        this.resizeObserver.observe(this.el);
        this.trackWidth = this.layoutWidth();
    }

    /** Canlıda hover zamanını başka bir bileşen gösteriyor mu (live-wall-clock tooltip'i) — üst üste binmesin. */
    liveHoverHandled = false;

    /**
     * Seek bar'ın temsil ettiği zaman aralığı: VOD'da 0 → süre; canlıda (duration Infinity) yayının izin verdiği
     * geri sarma penceresi (seekable başı → canlı uç). Pencere çok kısaysa (DVR yok) ya da süre bilinmiyorsa null.
     */
    private timeline(): { start: number; end: number; live: boolean } | null {
        const duration = this.video.duration;
        if (Number.isFinite(duration) && duration > 0) return { start: 0, end: duration, live: false };
        if (duration !== Infinity) return null;
        const { seekable } = this.video;
        if (!seekable.length) return null;
        const start = seekable.start(0);
        const end = seekable.end(seekable.length - 1);
        return end - start >= MIN_LIVE_WINDOW_SEC ? { start, end, live: true } : null;
    }

    /** Kendi zamanını gösteren plugin'ler (sprite/segments) varsayılan hover zamanını gizler — keyed set. */
    suppressHoverTime(key: string, suppressed: boolean): void {
        if (suppressed) this.hoverTimeSuppressors.add(key);
        else this.hoverTimeSuppressors.delete(key);
        if (suppressed) this.hoverTimeEl.removeAttribute('data-visible');
    }

    private readonly onHoverMove = (e: PointerEvent): void => {
        const tl = this.timeline();
        const ratio = this.ratioAtClientX(e.clientX);

        // Hover noktası: sürüklerken gösterilmez (thumb zaten imlecin altında); geri sarılamayan canlıda konum yok.
        if (tl && !this.dragging) {
            this.hoverDotEl.style.transform = `translate(${this.xAtRatio(ratio)}px, -50%) translateX(-50%)`;
            this.hoverDotEl.setAttribute('data-visible', '');
        } else {
            this.hoverDotEl.removeAttribute('data-visible');
        }

        if (this.hoverTimeSuppressors.size || !tl || (tl.live && this.liveHoverHandled)) {
            this.hoverTimeEl.removeAttribute('data-visible');
            return;
        }
        const time = tl.start + ratio * (tl.end - tl.start);
        // Canlıda mutlak zaman anlamsız — canlı uçtan ne kadar geride ("-1:24").
        this.hoverTimeEl.textContent = tl.live ? `-${formatTime(tl.end - time)}` : formatTime(time);
        this.hoverTimeEl.setAttribute('data-visible', '');
        // İmleci ortala, seek bar kenarlarından taşma.
        const w = this.hoverTimeEl.offsetWidth;
        const x = Math.min(Math.max(this.layoutXAtClientX(e.clientX) - w / 2, 0), Math.max(this.trackWidth - w, 0));
        this.hoverTimeEl.style.transform = `translateX(${x}px)`;
    };

    private readonly onHoverLeave = (): void => {
        this.hoverTimeEl.removeAttribute('data-visible');
        this.hoverDotEl.removeAttribute('data-visible');
    };

    private ratioFromEvent(e: PointerEvent): number {
        return this.ratioAtClientX(e.clientX);
    }

    /** Ekran x koordinatını 0–1 zaman oranına çevirir — chapter modunda parça boşluklarını hesaba katar (segments plugin'inin hover popup'ı da bunu kullanıyor). */
    ratioAtClientX(clientX: number): number {
        const x = this.layoutXAtClientX(clientX);
        if (!this.chapters.length) return this.trackWidth > 0 ? Math.min(1, Math.max(0, x / this.trackWidth)) : 0;

        for (let i = 0; i < this.chapters.length; i++) {
            const c = this.chapters[i]!;
            const next = this.chapters[i + 1];
            // Parçanın kendisi + ardından gelen boşluk bu parçaya ait sayılıyor.
            const zoneEnd = next ? next.left : Infinity;
            if (x < zoneEnd || !next) {
                const local = c.width > 0 ? Math.min(1, Math.max(0, (x - c.left) / c.width)) : 0;
                return c.start + local * (c.end - c.start);
            }
        }
        return 1;
    }

    /** 0–1 zaman oranının seek bar üzerindeki px konumu (thumb için). */
    private xAtRatio(ratio: number): number {
        if (!this.chapters.length) return ratio * this.trackWidth;
        const c = this.chapters.find((ch) => ratio < ch.end) ?? this.chapters[this.chapters.length - 1]!;
        const span = c.end - c.start;
        const local = span > 0 ? Math.min(1, Math.max(0, (ratio - c.start) / span)) : 0;
        return c.left + local * c.width;
    }

    /** Track'i sıralı, 0→1'i kesintisiz kapsayan oran aralıklarına göre ayrı parçalara böler. */
    setChapters(ranges: SeekBarChapterRange[]): HTMLDivElement[] {
        this.clearChapters();
        if (!ranges.length) return [];

        const container = document.createElement('div');
        container.className = 'hp-chapters';
        this.chapters = ranges.map((r) => {
            const el = document.createElement('div');
            el.className = 'hp-chapter';
            el.setAttribute('part', 'segment-band');
            el.style.flex = `${Math.max(r.end - r.start, 0)} 1 0px`;

            const bufferedEl = document.createElement('div');
            bufferedEl.className = 'hp-chapter-fill hp-chapter-buffered';
            const playedEl = document.createElement('div');
            playedEl.className = 'hp-chapter-fill hp-chapter-played';
            if (r.color) playedEl.style.background = r.color;
            el.append(bufferedEl, playedEl);
            container.appendChild(el);
            return { ...r, el, bufferedEl, playedEl, left: 0, width: 0 };
        });

        // Tek track gizleniyor, parçalar onun yerini alıyor (thumb/marker'lar üstte kalsın diye track'ten hemen sonra).
        this.trackEl.style.display = 'none';
        this.trackEl.after(container);
        this.chaptersEl = container;
        this.measureChapters();
        this.render();
        return this.chapters.map((c) => c.el);
    }

    clearChapters(): void {
        this.chaptersEl?.remove();
        this.chaptersEl = null;
        this.chapters = [];
        this.trackEl.style.display = '';
        this.render();
    }

    /**
     * Seek bar'ın DÜZEN genişliği (px). getBoundingClientRect() ata elementlerin CSS transform'undan etkilenir: player
     * ölçekli bir giriş animasyonuyla (ör. scale(0.985)) gösterilirken ölçülürse genişlik küçük kalıyor, animasyon
     * bitince düzen boyutu değişmediği için ResizeObserver tekrar tetiklenmiyor ve thumb dolu kısmın gerisinde kalıyordu.
     */
    /** Ekran x koordinatının seek bar içindeki DÜZEN px'i (ata transform'u ölçekliyorsa ona göre düzeltilmiş). */
    private layoutXAtClientX(clientX: number): number {
        const rect = this.el.getBoundingClientRect();
        return rect.width > 0 ? ((clientX - rect.left) * this.trackWidth) / rect.width : 0;
    }

    private layoutWidth(): number {
        return parseFloat(getComputedStyle(this.el).width) || this.el.offsetWidth;
    }

    private measureChapters(): void {
        if (!this.chapters.length) return;
        const bar = this.el.getBoundingClientRect();
        // Ekran px'ini düzen px'ine çevir (ata transform'u varsa) — thumb `translate` düzen px'inde konumlanıyor.
        const k = bar.width > 0 ? this.trackWidth / bar.width : 1;
        for (const c of this.chapters) {
            const r = c.el.getBoundingClientRect();
            c.left = (r.left - bar.left) * k;
            c.width = r.width * k;
        }
    }

    private readonly onPointerDown = (e: PointerEvent): void => {
        this.dragging = true;
        this.hoverDotEl.removeAttribute('data-visible');
        this.el.setPointerCapture(e.pointerId);
        this.seekToRatio(this.ratioFromEvent(e));
        this.el.addEventListener('pointermove', this.onPointerMove);
        this.el.addEventListener('pointerup', this.onPointerUp);
    };

    private readonly onPointerMove = (e: PointerEvent): void => {
        if (!this.dragging) return;
        this.seekToRatio(this.ratioFromEvent(e));
    };

    private readonly onPointerUp = (e: PointerEvent): void => {
        this.dragging = false;
        this.el.releasePointerCapture(e.pointerId);
        this.el.removeEventListener('pointermove', this.onPointerMove);
        this.el.removeEventListener('pointerup', this.onPointerUp);
    };

    /** Odaktayken ←/→ sarma süresi (sn) — player'ın klavye kısayoluyla aynı (options.keyboardSeekStep). */
    keyboardStep = 5;
    /** Odaktayken ok tuşuyla sarıldığında (sn, negatif = geri) — sarma bildirimi için. */
    onKeyboardSeek: ((delta: number) => void) | null = null;

    private readonly onKeyDown = (e: KeyboardEvent): void => {
        const tl = this.timeline();
        if (!tl) return;

        if (e.key === 'ArrowRight') {
            this.video.currentTime = Math.min(tl.end, this.video.currentTime + this.keyboardStep);
            this.onKeyboardSeek?.(this.keyboardStep);
            e.preventDefault();
        } else if (e.key === 'ArrowLeft') {
            this.video.currentTime = Math.max(tl.start, this.video.currentTime - this.keyboardStep);
            this.onKeyboardSeek?.(-this.keyboardStep);
            e.preventDefault();
        }
    };

    private seekToRatio(ratio: number): void {
        const tl = this.timeline();
        if (!tl) return;
        const time = tl.start + ratio * (tl.end - tl.start);
        // Canlıda tam uca değil biraz gerisine — en son segmentin sonuna seek edince oynatma takılabiliyor.
        this.video.currentTime = tl.live ? Math.min(time, tl.end - LIVE_EDGE_SAFETY_SEC) : time;
        // video'nun kendi 'timeupdate'i asenkron/gecikmeli olabilir —
        // sürüklerken parmak/imleçle thumb arasında gecikme hissi
        // bırakmamak için konumu HEMEN, burada çiziyoruz.
        this.render();
    }

    private readonly startLoop = (): void => {
        if (this.rafId !== null) return;
        const tick = (): void => {
            this.render();
            this.rafId = requestAnimationFrame(tick);
        };
        this.rafId = requestAnimationFrame(tick);
    };

    private readonly stopLoop = (): void => {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.render();
    };

    private readonly render = (): void => {
        const tl = this.timeline();
        // Zaman aralığı yoksa (geri sarılamayan canlı / henüz metadata yok) thumb gizlenir — CSS `.hp-seekbar[data-no-duration]`.
        this.el.toggleAttribute('data-no-duration', !tl);
        this.el.toggleAttribute('data-live', !!tl?.live);
        if (!tl) {
            this.hoverTimeEl.removeAttribute('data-visible');
            this.hoverDotEl.removeAttribute('data-visible');
            this.playedEl.style.transform = 'scaleX(0)';
            this.thumbEl.style.translate = '-50% 0';
            this.bufferedEl.style.transform = 'scaleX(0)';
            return;
        }
        const span = tl.end - tl.start;
        const toRatio = (t: number): number => Math.min(1, Math.max(0, (t - tl.start) / span));

        const playedRatio = toRatio(this.video.currentTime);
        // `translate` (transform DEĞİL): CSS'teki `scale` transform'u da ölçekleyip konumu kaydırırdı.
        this.thumbEl.style.translate = `calc(${this.xAtRatio(playedRatio)}px - 50%) 0`;

        let bufferedEnd = 0;
        for (let i = 0; i < this.video.buffered.length; i++) {
            if (this.video.buffered.start(i) <= this.video.currentTime) {
                bufferedEnd = Math.max(bufferedEnd, this.video.buffered.end(i));
            }
        }
        const bufferedRatio = toRatio(bufferedEnd);

        if (this.chapters.length) {
            // Her parça kendi yerel oranıyla dolar: önceki parçalar tam, sonrakiler boş.
            for (const c of this.chapters) {
                const span = c.end - c.start;
                const local = (r: number): number => (span > 0 ? Math.min(1, Math.max(0, (r - c.start) / span)) : 0);
                c.playedEl.style.transform = `scaleX(${local(playedRatio)})`;
                c.bufferedEl.style.transform = `scaleX(${local(bufferedRatio)})`;
            }
        } else {
            this.playedEl.style.transform = `scaleX(${playedRatio})`;
            this.bufferedEl.style.transform = `scaleX(${bufferedRatio})`;
        }

        this.el.setAttribute('aria-valuemin', String(Math.floor(tl.start)));
        this.el.setAttribute('aria-valuemax', String(Math.floor(tl.end)));
        this.el.setAttribute('aria-valuenow', String(Math.floor(this.video.currentTime)));
    };

    /** 0–1 arası oranda, seek bar üzerine ince bir işaret çizgisi ekler (ör. loop A/B noktaları). */
    addMarker(ratio: number, extraClass = ''): HTMLDivElement {
        const marker = document.createElement('div');
        marker.className = `hp:absolute hp:top-0 hp:bottom-0 hp:w-0.5 hp:bg-on-surface hp:pointer-events-none ${extraClass}`;
        marker.style.left = `${Math.min(1, Math.max(0, ratio)) * 100}%`;
        this.el.appendChild(marker);
        this.markerEls.push(marker);
        return marker;
    }

    clearMarkers(): void {
        this.markerEls.forEach((m) => m.remove());
        this.markerEls.length = 0;
    }

    refreshLabels(): void {
        this.el.setAttribute('aria-label', this.labels.seekBar);
    }

    destroy(): void {
        if (this.rafId !== null) cancelAnimationFrame(this.rafId);
        this.resizeObserver.disconnect();
        this.el.removeEventListener('pointermove', this.onHoverMove);
        this.el.removeEventListener('pointerleave', this.onHoverLeave);
        this.video.removeEventListener('play', this.startLoop);
        this.video.removeEventListener('pause', this.stopLoop);
        this.video.removeEventListener('ended', this.stopLoop);
        this.video.removeEventListener('timeupdate', this.render);
        this.video.removeEventListener('progress', this.render);
        this.video.removeEventListener('loadedmetadata', this.render);
        this.clearMarkers();
        this.chaptersEl?.remove();
    }
}
