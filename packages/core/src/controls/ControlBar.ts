import { SeekBar } from './SeekBar';
import { VolumePanel, type VolumePanelAdHooks } from './VolumePanel';
import { SettingsMenu, type SettingsCaptionOption, type SettingsQualityOption } from './SettingsMenu';
import { formatTime } from '../utils/format-time';
import { seekBy } from '../utils/seek-by';
import { createIcon, setIconName } from '../icons/Icon';
import type { HopeLocaleStrings } from '../i18n/types';

/** `title` bilerek set edilmiyor — tooltip'i Tooltip.ts gösteriyor, native tooltip üstüne binmesin. */
/** Canlı uçtan bu kadar saniyeden fazla gerideyse rozet "geride" (gri) sayılır — HLS'in doğal gecikmesi (birkaç segment) bunun altında kalır. */
const LIVE_EDGE_TOLERANCE_SEC = 15;
/** Player bu genişliğin (px) altındaysa kompakt (mobil) düzen: sağ grup üst sağa, tam ekran altta. */
const COMPACT_MAX_WIDTH = 480;
/** Bundan kısa beklemelerde (ms) yükleme halkası hiç görünmez — kısa takılmalarda yanıp sönmesin. */
const LOADING_RING_DELAY_MS = 150;

/** Sarma butonu: yuvarlak ok ikonu + ortasında süre. */
const LOADING_START_EVENTS = ['waiting', 'seeking'] as const;
const LOADING_END_EVENTS = ['playing', 'canplay', 'canplaythrough', 'seeked', 'pause', 'error', 'emptied'] as const;

function skipButton(direction: 'back' | 'forward', part: string): { btn: HTMLButtonElement; num: HTMLSpanElement } {
    const { btn } = iconButton('', `skip-${direction}`);
    btn.classList.add('hp-skip-btn');
    btn.setAttribute('part', part);
    const num = document.createElement('span');
    num.className = 'hp-skip-num';
    num.setAttribute('aria-hidden', 'true');
    btn.appendChild(num);
    btn.style.display = 'none';
    return { btn, num };
}

function setButtonLabel(btn: HTMLButtonElement, label: string): void {
    btn.setAttribute('aria-label', label);
}

/** `shortcut`: Tooltip.ts'in gösterdiği küçük "pill" (ör. "F") — yalnızca `KeyboardController`'daki GERÇEK bir tuşla birebir eşleşiyorsa veriliyor, uydurma değil. */
function iconButton(label: string, iconName: string, shortcut?: string): { btn: HTMLButtonElement; icon: HTMLElement } {
    const btn = document.createElement('button');
    btn.type = 'button';
    setButtonLabel(btn, label);
    if (shortcut) btn.dataset.shortcut = shortcut;
    // hp-chip: tema yüzeyi; boyut --hp-ctrl-* token'larından (fullscreen/dokunmatikte büyür).
    btn.className =
        'hp-chip hp:flex hp:items-center hp:justify-center hp:w-[var(--hp-ctrl-btn-size)] hp:h-[var(--hp-ctrl-btn-size)] hp:cursor-pointer hp:shrink-0';
    const icon = createIcon(iconName, 'hp:text-[length:var(--hp-ctrl-icon-size)]');
    btn.appendChild(icon);
    return { btn, icon };
}

export interface ControlBarCallbacks {
    onRequestFullscreen: () => void;
    onExitFullscreen: () => void;
    isFullscreen: () => boolean;
    /** Reklam modunda oynat/duraklat reklamı yönetir — IMA reklamı içerikten ayrı bir video'da oynatır. */
    isAdActive: () => boolean;
    adTogglePlay: () => void;
    adIsPaused: () => boolean;
    adVolume: VolumePanelAdHooks;
    /** hls.js'in hedef canlı konumu (canlı ucun ~3 segment gerisi) — rozet "geride" kararı ve "canlıya dön" için. */
    liveSyncPosition?(): number | null;
    /**
     * Oynat/duraklat butonu ve klavyeden önce sorulur — true dönerse tıklama orada işlenmiştir.
     * Preroll beklenirken basılan "duraklat" beklemeyi iptal eder (video zaten duraklatılmış durumda).
     */
    interceptTogglePlay?(): boolean;
    /** Yükleme halkası (medya takılması ya da preroll beklemesi) açıldı / kapandı — kontroller bu sırada gizlenmesin. */
    onLoadingChange?(loading: boolean): void;
}

/** Alt kontrol çubuğunu kurar; alt bileşenleri (SeekBar/VolumePanel/SettingsMenu) birleştirir. */
export class ControlBar {
    readonly el: HTMLDivElement;
    readonly seekBar: SeekBar;
    readonly volumePanel: VolumePanel;
    readonly settingsMenu: SettingsMenu;

    private readonly video: HTMLVideoElement;
    private readonly labels: HopeLocaleStrings;
    private readonly playButton: HTMLButtonElement;
    private readonly playIcon: HTMLElement;
    private readonly pipButton: HTMLButtonElement;
    private readonly skipBack: { btn: HTMLButtonElement; num: HTMLSpanElement };
    private readonly skipForward: { btn: HTMLButtonElement; num: HTMLSpanElement };
    /** Etkin sarma süreleri (sn); null = buton gizli. */
    private skipSeconds: { back: number | null; forward: number | null } = { back: null, forward: null };
    private seekingEnabled = true;
    private readonly leftGroup: HTMLDivElement;
    private loadingTimer: ReturnType<typeof setTimeout> | null = null;
    /** Halkayı açık tutan sebepler: 'media' (buffer bekleniyor) ve player'ın verdikleri (ör. 'preroll'). */
    private readonly loadingReasons = new Set<string>();
    /** Preroll beklenirken video duraklatılmış olsa da kullanıcı oynatmak istedi — buton "duraklat" görünür. */
    private pendingPlay = false;
    /** Sarma butonuyla sarıldığında (sn, negatif = geri) — sarma bildirimi için. */
    onSkip: ((delta: number) => void) | null = null;
    private readonly fullscreenButton: HTMLButtonElement;
    private readonly fullscreenIcon: HTMLElement;
    private readonly timeLabel: HTMLButtonElement;
    /** Reklam sırasında süre etiketinin yerinde: "Reklam 2/3 · 0:12". */
    private readonly adInfoEl: HTMLSpanElement;
    private showRemaining = false;
    /** Kompakt düzende (player < 480px) sağ grubun taşındığı üst bar; tam ekran altta kalır. */
    readonly topEl: HTMLDivElement;
    private readonly bottomRow: HTMLDivElement;
    private readonly rightGroup: HTMLDivElement;
    private readonly fullscreenSlot: HTMLDivElement;
    private compact = false;
    private readonly resizeObserver: ResizeObserver;
    private readonly liveBadge: HTMLButtonElement;
    private readonly liveText: HTMLSpanElement;
    private adMode = false;
    private readonly callbacks: ControlBarCallbacks;
    private row!: HTMLDivElement;
    private extraButtonAnchor!: HTMLElement;

    constructor(video: HTMLVideoElement, playbackRates: number[], callbacks: ControlBarCallbacks, labels: HopeLocaleStrings) {
        this.video = video;
        this.callbacks = callbacks;
        this.labels = labels;

        this.el = document.createElement('div');
        this.el.setAttribute('part', 'control-bar');
        // pointer-events-none: kapsayıcı alt şeridin tamamını kaplıyor; açık olsaydı boş alanlar reklamın
        // "Reklamı Geç" butonu dahil alttaki tıklamaları yutardı. Yalnızca gerçek yüzeyler pointer-events-auto.
        this.el.className =
            'hp:absolute hp:inset-x-0 hp:bottom-0 hp:flex hp:flex-col hp:gap-1 hp:px-3 hp:pb-2 hp:pt-6 hp:pointer-events-none ' +
            'hp:transition-opacity hp:duration-200';

        this.seekBar = new SeekBar(video, labels);
        this.seekBar.el.classList.add('hp:pointer-events-auto');
        this.el.appendChild(this.seekBar.el);

        const row = document.createElement('div');
        row.className = 'hp:flex hp:items-center hp:gap-2';
        this.el.appendChild(row);
        this.bottomRow = row;

        // Sol küme: oynat/duraklat + ses + süre — kendi transparan "pill"
        // yüzeyini paylaşıyor (`.hp-group`, theme/tailwind.css).
        const leftGroup = document.createElement('div');
        leftGroup.className = 'hp-group hp-group-left hp:flex hp:items-center hp:gap-1 hp:px-1.5 hp:py-1 hp:shrink-0 hp:pointer-events-auto';
        row.appendChild(leftGroup);
        this.leftGroup = leftGroup;

        // Yükleme halkası: medya beklenirken grubun kenarında dolaşan ışık (tailwind.css `.hp-loading-ring`).
        const ring = document.createElement('span');
        ring.className = 'hp-loading-ring';
        ring.setAttribute('aria-hidden', 'true');
        // Dış katman parıltı (filter), iç katman kenara kırpan maske — filter maskeden önce uygulandığı için ayrı.
        const ringMask = document.createElement('span');
        ringMask.className = 'hp-loading-ring-mask';
        ringMask.appendChild(document.createElement('span'));
        ring.appendChild(ringMask);
        leftGroup.appendChild(ring);

        const play = iconButton(labels.play, 'play', 'K');
        this.playButton = play.btn;
        this.playIcon = play.icon;
        this.playButton.setAttribute('part', 'play-pause-button');
        this.playButton.addEventListener('click', () => this.togglePlay());
        leftGroup.appendChild(this.playButton);

        this.skipBack = skipButton('back', 'skip-back-button');
        this.skipBack.btn.addEventListener('click', () => this.skip(-(this.skipSeconds.back ?? 0)));
        this.skipForward = skipButton('forward', 'skip-forward-button');
        this.skipForward.btn.addEventListener('click', () => this.skip(this.skipSeconds.forward ?? 0));
        leftGroup.append(this.skipBack.btn, this.skipForward.btn);

        this.volumePanel = new VolumePanel(video, labels, callbacks.adVolume);
        leftGroup.appendChild(this.volumePanel.el);

        this.timeLabel = document.createElement('button');
        this.timeLabel.type = 'button';
        this.timeLabel.setAttribute('part', 'time-display');
        this.timeLabel.className =
            'hp:text-xs hp:text-on-surface hp:tabular-nums hp:whitespace-nowrap hp:px-1 hp:bg-transparent hp:border-0 hp:cursor-pointer hp:select-none hp:p-0 hp:hover:opacity-80 hp:transition-opacity hp:focus-visible:outline-none hp:focus-visible:ring-1 hp:focus-visible:ring-accent hp:rounded';
        this.timeLabel.textContent = '0:00 / 0:00';
        this.timeLabel.addEventListener('click', this.onTimeClick);
        leftGroup.appendChild(this.timeLabel);

        this.adInfoEl = document.createElement('span');
        this.adInfoEl.setAttribute('part', 'ad-countdown');
        this.adInfoEl.className = 'hp:text-xs hp:text-on-surface hp:tabular-nums hp:whitespace-nowrap hp:px-1 hp:select-none';
        this.adInfoEl.setAttribute('aria-live', 'off');
        this.adInfoEl.style.display = 'none';

        // Canlı yayında (duration === Infinity) süre etiketinin YERİNE —
        // YouTube tarzı "● CANLI": canlı uçtayken nokta kırmızı, geriye
        // sarılmışsa gri ve tıklayınca canlı uca döner.
        this.liveBadge = document.createElement('button');
        this.liveBadge.type = 'button';
        this.liveBadge.className = 'hp-live-badge';
        this.liveBadge.setAttribute('part', 'live-badge');
        this.liveBadge.setAttribute('aria-label', labels.goToLive);
        const liveDot = document.createElement('span');
        liveDot.className = 'hp-live-dot';
        this.liveText = document.createElement('span');
        this.liveText.textContent = labels.live;
        this.liveBadge.append(liveDot, this.liveText);
        this.liveBadge.style.display = 'none';
        this.liveBadge.addEventListener('click', this.goToLive);
        leftGroup.appendChild(this.liveBadge);
        // Süre etiketi / canlı rozetinden sonra (reklam sırasında ikisi de gizli, gösterge onların yerinde görünür).
        leftGroup.appendChild(this.adInfoEl);

        const spacer = document.createElement('div');
        spacer.className = 'hp:flex-1';
        row.appendChild(spacer);

        // Sağ küme: ayarlar + plugin'lerin addButton/addElement ile eklediği
        // kendi butonları (ayarlardan ÖNCE eklenir) + PIP + tam ekran — aynı
        // pill yüzeyi.
        const rightGroup = document.createElement('div');
        rightGroup.className = 'hp-group hp:flex hp:items-center hp:gap-1 hp:px-1.5 hp:py-1 hp:shrink-0 hp:pointer-events-auto';
        row.appendChild(rightGroup);
        this.rightGroup = rightGroup;

        this.settingsMenu = new SettingsMenu(video, playbackRates, labels);
        rightGroup.appendChild(this.settingsMenu.el);
        this.extraButtonAnchor = this.settingsMenu.el;
        this.row = rightGroup;

        const pip = iconButton(labels.pip, 'pip');
        this.pipButton = pip.btn;
        this.pipButton.addEventListener('click', () => this.togglePip());
        if (!document.pictureInPictureEnabled) this.pipButton.style.display = 'none';
        rightGroup.appendChild(this.pipButton);

        const fullscreen = iconButton(labels.fullscreenEnter, 'fullscreen-enter', 'F');
        this.fullscreenButton = fullscreen.btn;
        this.fullscreenIcon = fullscreen.icon;
        this.fullscreenButton.addEventListener('click', () => this.toggleFullscreen());
        rightGroup.appendChild(this.fullscreenButton);

        this.topEl = document.createElement('div');
        this.topEl.className = 'hp-top-bar';
        this.topEl.setAttribute('part', 'top-bar');
        this.fullscreenSlot = document.createElement('div');
        this.fullscreenSlot.className = 'hp-group hp:items-center hp:px-1.5 hp:py-1 hp:shrink-0 hp:pointer-events-auto';
        this.fullscreenSlot.style.display = 'none';
        row.appendChild(this.fullscreenSlot);

        this.resizeObserver = new ResizeObserver(() => this.updateLayout());
        this.resizeObserver.observe(this.el);

        video.addEventListener('play', this.renderPlayState);
        video.addEventListener('pause', this.renderPlayState);
        video.addEventListener('timeupdate', this.renderTime);
        video.addEventListener('loadedmetadata', this.renderTime);
        video.addEventListener('durationchange', this.renderTime);
        video.addEventListener('progress', this.renderTime);
        // Kaynak değişince süre NaN'a döner ama durationchange gelmez — önceki videonun "0:00 / 0:15"u kalmasın.
        video.addEventListener('emptied', this.renderTime);
        for (const ev of LOADING_START_EVENTS) video.addEventListener(ev, this.onLoadingStart);
        for (const ev of LOADING_END_EVENTS) video.addEventListener(ev, this.onLoadingEnd);
        this.renderPlayState();
        this.renderTime();
    }

    /** Player genişliğine göre normal / kompakt (mobil) düzen arasında geçiş — yalnızca eşik geçilince DOM taşınır. */
    private updateLayout(): void {
        const width = this.el.getBoundingClientRect().width;
        if (width === 0) return;
        const compact = width < COMPACT_MAX_WIDTH;
        if (compact === this.compact) return;
        this.compact = compact;
        this.settingsMenu.closeMenu();
        this.el.toggleAttribute('data-compact', compact);
        // Video alanı da bilsin — altyazı boyutu küçük player'da küçülüyor (tailwind.css `.video-area[data-compact]`).
        this.el.closest('.video-area')?.toggleAttribute('data-compact', compact);
        if (compact) {
            this.fullscreenSlot.appendChild(this.fullscreenButton);
            this.fullscreenSlot.style.display = this.adMode ? 'none' : 'flex';
            this.topEl.appendChild(this.rightGroup);
        } else {
            this.rightGroup.appendChild(this.fullscreenButton);
            this.bottomRow.insertBefore(this.rightGroup, this.fullscreenSlot);
            this.fullscreenSlot.style.display = 'none';
        }
    }

    setFullscreenState(isFullscreen: boolean): void {
        setIconName(this.fullscreenIcon, isFullscreen ? 'fullscreen-exit' : 'fullscreen-enter');
        setButtonLabel(this.fullscreenButton, isFullscreen ? this.labels.fullscreenExit : this.labels.fullscreenEnter);
    }

    /** Dil sonradan değişince (`options.locale`/`labels`) statik (reaktif olarak yeniden render edilmeyen) etiketleri tazeler. */
    /** Geri/ileri sarma butonları — `null` süre o butonu gizler. */
    setSkipButtons(back: number | null, forward: number | null): void {
        this.skipSeconds = { back, forward };
        this.renderSkipButtons();
    }

    /** DAI reklam arasında seek kapalıyken sarma butonları da devre dışı. */
    setSeekingEnabled(enabled: boolean): void {
        this.seekingEnabled = enabled;
        this.skipBack.btn.disabled = !enabled;
        this.skipForward.btn.disabled = !enabled;
    }

    private renderSkipButtons(): void {
        const render = (b: { btn: HTMLButtonElement; num: HTMLSpanElement }, seconds: number | null, label: (s: number) => string): void => {
            b.btn.style.display = seconds === null || this.adMode ? 'none' : '';
            if (seconds === null) return;
            b.num.textContent = String(seconds);
            b.num.toggleAttribute('data-long', String(seconds).length > 2);
            setButtonLabel(b.btn, label(seconds));
        };
        render(this.skipBack, this.skipSeconds.back, this.labels.skipBack);
        render(this.skipForward, this.skipSeconds.forward, this.labels.skipForward);
    }

    private skip(delta: number): void {
        if (!delta || !this.seekingEnabled) return;
        seekBy(this.video, delta);
        this.onSkip?.(delta);
    }

    refreshLabels(): void {
        this.renderPlayState();
        this.renderSkipButtons();
        setButtonLabel(this.pipButton, this.labels.pip);
        setButtonLabel(this.liveBadge, this.labels.goToLive);
        this.liveText.textContent = this.labels.live;
        this.setFullscreenState(this.callbacks.isFullscreen());
        this.seekBar.refreshLabels();
        this.volumePanel.refreshLabels();
        this.settingsMenu.refreshLabels();
    }

    /** Reklam modu: seek bar, süre ve sağ grup gizlenir; oynat/duraklat + ses kalır. */
    setAdMode(active: boolean): void {
        const display = active ? 'none' : '';
        this.adMode = active;
        this.renderSkipButtons();
        this.seekBar.el.style.display = display;
        this.row.style.display = display;
        if (this.compact) this.fullscreenSlot.style.display = active ? 'none' : 'flex';
        // Süre etiketi / canlı rozeti hangisinin görüneceğine renderTime karar veriyor (ad modunda ikisi de gizli).
        this.renderTime();
        if (!active) this.setAdInfo(null);
        // Oynat/duraklat ikonu + ses göstergesi, ad moduna girer/çıkarken
        // doğru kaynağı (reklam ya da içerik) hemen yansıtsın.
        this.renderPlayState();
        this.volumePanel.refreshForAdMode();
    }

    /**
     * Reklam geri sayımı + pod göstergesi ("Reklam 2/3 · 0:12"). `null` → gizle. Pod tek reklamsa yalnızca "Reklam · 0:12";
     * kalan süre bilinmiyorsa (bazı VPAID reklamları) yalnızca etiket.
     */
    setAdInfo(info: { remaining: number; position: number; total: number } | null): void {
        if (!info || !this.adMode) {
            this.adInfoEl.style.display = 'none';
            this.adInfoEl.textContent = '';
            return;
        }
        const pod = info.total > 1 ? ` ${info.position}/${info.total}` : '';
        const time = info.remaining >= 0 ? ` · ${formatTime(Math.ceil(info.remaining))}` : '';
        this.adInfoEl.textContent = `${this.labels.adLabel}${pod}${time}`;
        this.adInfoEl.style.display = '';
    }

    /** `AdsController`'ın IMA'nın KENDİ UI'ı üzerinden (ör. reklam video'suna tıklama) gelen PAUSED/RESUMED event'leri için — oynat/duraklat ikonunu tazeler. */
    refreshAdPlayState(): void {
        this.renderPlayState();
    }

    setQualities(options: SettingsQualityOption[], activeLabel: string): void {
        this.settingsMenu.setQualities(options, activeLabel);
    }

    setCaptions(options: SettingsCaptionOption[], activeLabel: string): void {
        this.settingsMenu.setCaptions(options, activeLabel);
    }

    /** Plugin'lerin (loop-section vb.) kontrol çubuğuna kendi butonlarını eklemesi için — ayarlar menüsünden önce yerleştirilir. */
    addButton(label: string, iconName: string, onClick: () => void): { btn: HTMLButtonElement; icon: HTMLElement } {
        const { btn, icon } = iconButton(label, iconName);
        btn.addEventListener('click', onClick);
        this.row.insertBefore(btn, this.extraButtonAnchor);
        return { btn, icon };
    }

    /** Süre etiketine tıklama: geçen süre ↔ kalan süre. */
    private readonly onTimeClick = (e: MouseEvent): void => {
        e.stopPropagation();
        this.toggleTimeMode();
    };

    toggleTimeMode(): void {
        this.showRemaining = !this.showRemaining;
        this.renderTime();
    }

    setShowRemaining(show: boolean): void {
        if (this.showRemaining === show) return;
        this.showRemaining = show;
        this.renderTime();
    }

    getShowRemaining(): boolean {
        return this.showRemaining;
    }

    /** Plugin'lerin (live-wall-clock vb.) kontrol çubuğuna buton olmayan bir element (ör. saat göstergesi) eklemesi için. */
    addElement(el: HTMLElement): void {
        this.row.insertBefore(el, this.extraButtonAnchor);
    }

    private togglePlay(): void {
        if (this.callbacks.interceptTogglePlay?.()) {
            this.renderPlayState();
            return;
        }
        if (this.callbacks.isAdActive()) {
            this.callbacks.adTogglePlay();
            this.renderPlayState();
            return;
        }
        if (this.video.paused) void this.video.play();
        else this.video.pause();
    }

    private async togglePip(): Promise<void> {
        try {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
            } else {
                await this.video.requestPictureInPicture();
            }
        } catch {
            // PIP desteklenmiyor/izin verilmedi — sessizce yoksay.
        }
    }

    private toggleFullscreen(): void {
        if (this.callbacks.isFullscreen()) this.callbacks.onExitFullscreen();
        else this.callbacks.onRequestFullscreen();
    }

    /** Preroll beklemesi: video duraklatılmış ama oynatma istendi — buton "duraklat" görünsün. */
    setPendingPlay(pending: boolean): void {
        this.pendingPlay = pending;
        this.renderPlayState();
    }

    /** Player'ın kendi bekleme durumları (ör. 'preroll') için yükleme halkası — medya takılmasından bağımsız. */
    setLoading(reason: string, on: boolean): void {
        if (on) this.loadingReasons.add(reason);
        else this.loadingReasons.delete(reason);
        this.renderLoading();
    }

    get isLoading(): boolean {
        return this.loadingReasons.size > 0;
    }

    private renderLoading(): void {
        const loading = this.loadingReasons.size > 0;
        if (loading === this.leftGroup.hasAttribute('data-loading')) return;
        this.leftGroup.toggleAttribute('data-loading', loading);
        this.callbacks.onLoadingChange?.(loading);
    }

    private readonly renderPlayState = (): void => {
        const paused = this.callbacks.isAdActive() ? this.callbacks.adIsPaused() : this.video.paused && !this.pendingPlay;
        setIconName(this.playIcon, paused ? 'play' : 'pause');
        setButtonLabel(this.playButton, paused ? this.labels.play : this.labels.pause);
    };

    /** Canlı uç (media-time) — seekable sonu; native HLS'te DVR'sız canlıda seekable boş kalabildiği için buffered sonu (bkz. LiveWallClock.isLive notu). */
    private liveEdge(): number | null {
        const { seekable, buffered } = this.video;
        if (seekable.length) return seekable.end(seekable.length - 1);
        if (buffered.length) return buffered.end(buffered.length - 1);
        return null;
    }

    private readonly renderTime = (): void => {
        const isLive = this.video.duration === Infinity;
        this.timeLabel.style.display = this.adMode || isLive ? 'none' : '';
        this.liveBadge.style.display = !this.adMode && isLive ? '' : 'none';

        if (!isLive) {
            const duration = this.video.duration;
            const current = this.video.currentTime;
            if (this.showRemaining) {
                // Görünen tam saniyelerden: ⌊süre⌋ − ⌊geçen⌋ — iki modda gösterilen değerlerin toplamı her zaman görünen süreyi tutar.
                const total = Number.isFinite(duration) ? Math.floor(duration) : 0;
                const remaining = Math.max(0, total - Math.floor(current));
                this.timeLabel.textContent = `-${formatTime(remaining)} / ${formatTime(duration)}`;
            } else {
                this.timeLabel.textContent = `${formatTime(current)} / ${formatTime(duration)}`;
            }
            return;
        }
        // Canlı konumdan LIVE_EDGE_TOLERANCE_SEC'ten fazla gerideyse "geride" (gri nokta, tıklanınca uca döner). hls.js
        // yayını bilerek uçtan ~3 segment geride oynatır — ölçü onun hedef konumu, yoksa seekable sonu.
        const target = this.callbacks.liveSyncPosition?.() ?? this.liveEdge();
        const behind = target !== null && target - this.video.currentTime > LIVE_EDGE_TOLERANCE_SEC;
        this.liveBadge.toggleAttribute('data-behind', behind);
    };

    /** Buffer bekleniyor (oynarken takılma ya da buffer'lanmamış bir yere atlama). */
    private readonly onLoadingStart = (e: Event): void => {
        // Buffer'lı bir yere atlarken (veri hazır) halka gösterilmez.
        if (e.type === 'seeking' && this.video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return;
        if (this.loadingTimer || this.loadingReasons.has('media')) return;
        this.loadingTimer = setTimeout(() => {
            this.loadingTimer = null;
            this.setLoading('media', true);
        }, LOADING_RING_DELAY_MS);
    };

    private readonly onLoadingEnd = (e: Event): void => {
        // seeked geldiğinde veri hâlâ yoksa bekleme sürüyor (waiting/canplay kararı verir).
        if (e.type === 'seeked' && this.video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA && !this.video.paused) return;
        if (this.loadingTimer) clearTimeout(this.loadingTimer);
        this.loadingTimer = null;
        this.setLoading('media', false);
    };

    private readonly goToLive = (): void => {
        const sync = this.callbacks.liveSyncPosition?.();
        const edge = this.liveEdge();
        if (edge === null && sync == null) return;
        // hls.js'in hedef canlı konumu; yoksa tam uca değil biraz gerisine — en sona seek edince oynatma takılabiliyor.
        this.video.currentTime = sync ?? Math.max(0, edge! - 1);
        if (this.video.paused) void this.video.play().catch(() => {});
        this.renderTime();
    };

    destroy(): void {
        this.timeLabel.removeEventListener('click', this.onTimeClick);
        this.video.removeEventListener('play', this.renderPlayState);
        this.video.removeEventListener('pause', this.renderPlayState);
        this.video.removeEventListener('timeupdate', this.renderTime);
        this.video.removeEventListener('loadedmetadata', this.renderTime);
        this.video.removeEventListener('durationchange', this.renderTime);
        this.video.removeEventListener('progress', this.renderTime);
        this.video.removeEventListener('emptied', this.renderTime);
        for (const ev of LOADING_START_EVENTS) this.video.removeEventListener(ev, this.onLoadingStart);
        for (const ev of LOADING_END_EVENTS) this.video.removeEventListener(ev, this.onLoadingEnd);
        if (this.loadingTimer) clearTimeout(this.loadingTimer);
        this.resizeObserver.disconnect();
        this.topEl.remove();
        this.seekBar.destroy();
        this.settingsMenu.destroy();
    }
}
