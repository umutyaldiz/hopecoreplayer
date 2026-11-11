import { HopePlayerElement, HOPE_PLAYER_VERSION } from './HopePlayerElement';

if (typeof window !== 'undefined' && !customElements.get('hope-player')) {
    customElements.define('hope-player', HopePlayerElement);
}

export { HopePlayerElement, HOPE_PLAYER_VERSION };
export { definePlugin, registerPlugin } from './plugin-api/registry';
export { PLUGIN_API_VERSION } from './plugin-api/types';
export type {
    HopePlugin,
    PlayerApi,
    PluginEntry,
    PluginLoader,
    PluginCleanup,
    PluginLabel,
    PluginButtonOptions,
    PluginButtonHandle,
    PluginLayerOptions,
    PluginLayerHandle,
    PluginLayerPosition,
    PluginUiApi,
    PluginSettingsApi,
    PluginSettingsHandle,
    PluginSettingsItem,
    PluginKeysApi,
    PluginI18nApi,
    PluginStorageApi,
    PluginInstanceHandle,
} from './plugin-api/types';
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
    SpriteLowResOptions,
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
