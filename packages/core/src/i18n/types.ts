/** Player chrome'unun kullandığı tüm sabit metinler. */
export interface HopeLocaleStrings {
    play: string;
    pause: string;
    mute: string;
    unmute: string;
    volume: string;
    seekBar: string;
    settings: string;
    pip: string;
    skipBack: (seconds: number) => string;
    skipForward: (seconds: number) => string;
    /** Sarma bildirimindeki saniye kısaltması ("+15 sn"). */
    secondsShort: string;
    /** Ayarlar menüsünde yayının alternatif ses izleri (HLS). */
    audioTrack: string;
    statsTitle: string;
    statsClose: string;
    statsEngine: string;
    statsResolution: string;
    statsQuality: string;
    statsCodecs: string;
    statsBandwidth: string;
    statsBuffer: string;
    statsDropped: string;
    statsLatency: string;
    statsSpeedVolume: string;
    statsSource: string;
    statsVersion: string;
    /** Sağ tık menüsü + hata ayıklama penceresi (options.debug). */
    debugTitle: string;
    debugClose: string;
    debugCopy: string;
    debugCopied: string;
    debugClear: string;
    debugEmpty: string;
    debugFatal: string;
    debugSourceMedia: string;
    debugSourceStream: string;
    debugSourceAds: string;
    debugSourceSubtitles: string;
    debugSourcePlayer: string;
    /** Reklam sırasında toolbar'daki gösterge ("Reklam 2/3 · 0:12"). */
    adLabel: string;
    adReturnFullscreen: string;
    adReturnPip: string;
    audioVinyl: string;
    captionSettings: string;
    fullscreenEnter: string;
    fullscreenExit: string;
    playbackSpeed: string;
    normal: string;
    quality: string;
    captions: string;
    captionsOff: string;
    captionSize: string;
    captionSizeSmall: string;
    captionSizeNormal: string;
    captionSizeLarge: string;
    captionResetPosition: string;
    captionBgColor: string;
    captionTextColor: string;
    /** Sürüklenebilir altyazı balonunun aria-label'ı — YouTube tarzı, tutup yukarı/aşağı taşıma. */
    captionDragHandle: string;
    autoQuality: string;
    loop: string;
    close: string;
    retry: string;
    errorAborted: string;
    errorNetwork: string;
    errorDecode: string;
    errorSrcNotSupported: string;
    errorGeneric: string;
    /** Hata ekranındaki kod satırının öneki (ör. "Hata kodu 4"). */
    errorCode: string;
    countdownRemaining: string;
    geoDefaultWarning: string;
    geoUnknownCountry: string;
    redirectCancel: string;
    redirectPlayNow: string;
    redirectCountdown: (seconds: number) => string;
    redirectNowPlaying: string;
    qrResumeTitle: string;
    qrResumeDontShowAgain: string;
    qrResumeContinue: string;
    /** Ayarlar menüsündeki aç/kapa satırı — "Bir daha gösterme" ile kapatılmış kullanıcının özelliği sonradan tekrar açabilmesi için. */
    qrResumeMenuLabel: string;
    qrResumeOn: string;
    qrResumeOff: string;
    pauseAdLabel: string;
    pauseAdClose: string;
    pauseAdResume: string;
    markerLearnMore: string;
    markerContinue: string;
    playlistTitle: string;
    playlistPrev: string;
    playlistNext: string;
    videoFallbackTitle: (index: number) => string;
    storyPrev: string;
    storyNext: string;
    storyAllVideos: string;
    dubbingTitle: string;
    liveClock: string;
    /** Canlı yayında süre etiketinin yerine gösterilen rozet metni. */
    live: string;
    /** Canlı rozetine tıklayınca canlı uca dönüş — rozetin aria-label'ı/tooltip'i. */
    goToLive: string;
}

/** Hazır gelen diller — herhangi bir string de geçerli (bkz. HopePlayerOptions.locale). */
export type HopeLocale = 'tr' | 'en' | (string & {});
