import { HopePlayerElement, HOPE_PLAYER_VERSION } from './HopePlayerElement';

if (typeof window !== 'undefined' && !customElements.get('hope-player')) {
    customElements.define('hope-player', HopePlayerElement);
}

export { HopePlayerElement, HOPE_PLAYER_VERSION };
export type { PlaybackEngineInfo } from './hls/SourceManager';
export type {
    HopeThemePreset,
    HopeLocale,
    HopeLocaleStrings,
    HopePlayerOptions,
    HopeSourceOption,
    HopeSourceFormat,
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
    RedirectCardPosition,
    QrResumeOptions,
    PauseAdOptions,
    SkipButtonsOptions,
    HopeHlsOptions,
    ContextMenuOptions,
    TapGesture,
    TapGestureType,
    TapRegion,
    TapPointer,
    TapAction,
    DubbingTrack,
    DubbingOptions,
    LiveWallClockOptions,
    DaiOptions,
    LiveAdsOptions,
    OmidAccessMode,
    OmidVendor,
    AudioOptions,
    VinylOptions,
    RewardedUnlockOptions,
    RewardedProvider,
    RewardedResult,
    SponsorshipOptions,
    SponsorshipConfig,
    AdTriggersOptions,
    AdTriggersConfig,
    AdTriggerRule,
    AdTrigger,
    AdTriggerLayout,
    AdTriggerCustParams,
    CustParams,
    CastOptions,
    CastSource,
} from './types';
export type { SettingsSubmenuDef, SettingsSubmenuItem } from './controls/SettingsMenu';
export type { ErrorLog, PlayerLogEntry, PlayerLogSource } from './debug/ErrorLog';

declare global {
    interface HTMLElementTagNameMap {
        'hope-player': HopePlayerElement;
    }
}
