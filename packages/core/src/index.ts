import { HopePlayerElement } from './HopePlayerElement';

if (typeof window !== 'undefined' && !customElements.get('hope-player')) {
    customElements.define('hope-player', HopePlayerElement);
}

export { HopePlayerElement };
export type { PlaybackEngineInfo } from './hls/SourceManager';
export type {
    HopeThemePreset,
    HopeLocale,
    HopeLocaleStrings,
    HopePlayerOptions,
    HopePlayerEventMap,
    AdsOptions,
    AdsRetryOptions,
    PrebidOptions,
    PrebidBreakOptions,
    PrebidBidderConfig,
    GestureOptions,
    LoopSectionOptions,
    InViewAutoplayOptions,
    StickyOptions,
    StickyCorner,
    PlayableItem,
    PlaylistOptions,
    PlaylistUiOptions,
    StoryOptions,
    StoryUiOptions,
    StoryGestureOptions,
    MarkerPopupOptions,
    MarkerPingOptions,
    MarkerAction,
    MarkerItem,
    MarkersOptions,
    SegmentItem,
    SpriteThumbnailsOptions,
    CountdownScreenOptions,
    GeoCheckerOptions,
    RedirectScreenSuggestion,
    RedirectScreenOptions,
    QrResumeOptions,
    PauseAdOptions,
    DubbingTrack,
    DubbingOptions,
    LiveWallClockOptions,
    DaiOptions,
    LiveAdsOptions,
} from './types';
export type { SettingsSubmenuDef, SettingsSubmenuItem } from './controls/SettingsMenu';

declare global {
    interface HTMLElementTagNameMap {
        'hope-player': HopePlayerElement;
    }
}
