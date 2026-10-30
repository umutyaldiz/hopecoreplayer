// Google IMA SDK mock'u — window.google.ima gerçek <script> yüklemesinden
// ÖNCE bu objeyi tanımladığı için loadImaSdk() gerçek ağ isteği hiç yapmıyor
// (bkz. packages/core/src/plugins/ads/loadImaSdk.ts: `if (window.google?.ima) ...`).
// ads.e2e.mjs ve screenshot-ad.mjs tarafından page.addInitScript ile paylaşılıyor.
window.__adsLog = [];
window.__mockIma = {
  adsLoaderInstances: [],
  adsManagerInstances: [],
};

class AdError {
  constructor(message) { this._m = message; }
  getMessage() { return this._m; }
  getErrorCode() { return 1005; }
}
class AdErrorEvent {
  constructor(message) { this._err = new AdError(message); }
  getError() { return this._err; }
}
AdErrorEvent.Type = { AD_ERROR: 'adError' };

class Ad {
  getAdPodInfo() { return { getAdPosition: () => 1, getTotalAds: () => 1, getPodIndex: () => 0 }; }
}

class AdEvent {
  constructor(type) { this.type = type; }
  getAd() { return new Ad(); }
}
AdEvent.Type = {
  CONTENT_PAUSE_REQUESTED: 'contentPauseRequested',
  CONTENT_RESUME_REQUESTED: 'contentResumeRequested',
  LOADED: 'loaded',
  STARTED: 'started',
  COMPLETE: 'complete',
  ALL_ADS_COMPLETED: 'allAdsCompleted',
  SKIPPED: 'skipped',
  CLICK: 'click',
  PAUSED: 'pause',
  RESUMED: 'resume',
  USER_CLOSE: 'userClose',
};

class AdDisplayContainer {
  constructor(containerEl, videoEl) { this.containerEl = containerEl; this.videoEl = videoEl; }
  initialize() { window.__adsLog.push({ ev: 'displayContainer.initialize' }); }
  destroy() {}
}

class AdsRequest {
  setAdWillAutoPlay(v) { this.adWillAutoPlay = v; }
  setAdWillPlayMuted(v) { this.adWillPlayMuted = v; }
  setContinuousPlayback(v) { this.continuousPlayback = v; }
}

class AdsManager {
  constructor() { this._listeners = {}; this._volume = 1; }
  addEventListener(type, listener) {
    (this._listeners[type] ??= []).push(listener);
  }
  dispatch(type, event) { (this._listeners[type] || []).forEach((l) => l(event)); }
  init(w, h, viewMode) { window.__adsLog.push({ ev: 'adsManager.init', w, h, viewMode }); }
  start() { window.__adsLog.push({ ev: 'adsManager.start' }); }
  resize() {}
  destroy() { window.__adsLog.push({ ev: 'adsManager.destroy' }); }
  pause() { window.__adsLog.push({ ev: 'adsManager.pause' }); }
  resume() { window.__adsLog.push({ ev: 'adsManager.resume' }); }
  setVolume(v) { this._volume = v; window.__adsLog.push({ ev: 'adsManager.setVolume', v }); }
  getVolume() { return this._volume; }
  getRemainingTime() { return 0; }
}

class AdsManagerLoadedEvent {
  constructor(adsManager) { this._mgr = adsManager; }
  getAdsManager(videoEl, renderingSettings) {
    window.__lastAdsRenderingSettings = renderingSettings;
    return this._mgr;
  }
}
AdsManagerLoadedEvent.Type = { ADS_MANAGER_LOADED: 'adsManagerLoaded' };

class AdsLoader {
  constructor(adDisplayContainer) {
    this.adDisplayContainer = adDisplayContainer;
    this._listeners = {};
    window.__mockIma.adsLoaderInstances.push(this);
  }
  addEventListener(type, listener) { (this._listeners[type] ??= []).push(listener); }
  dispatch(type, event) { (this._listeners[type] || []).forEach((l) => l(event)); }
  requestAds(request) {
    window.__adsLog.push({ ev: 'requestAds', adTagUrl: request.adTagUrl });
    window.__lastRequest = request;
  }
  contentComplete() { window.__adsLog.push({ ev: 'contentComplete' }); }
  destroy() {}
}

const ViewMode = { NORMAL: 'normal', FULLSCREEN: 'fullscreen' };
const settings = {
  setLocale() {},
  setPpid() {},
  setDisableCustomPlaybackForIOS10Plus(v) { window.__adsLog.push({ ev: 'setDisableCustomPlaybackForIOS10Plus', v }); },
  setVpaidMode(v) { window.__adsLog.push({ ev: 'setVpaidMode', v }); },
  setNumRedirects(v) { window.__adsLog.push({ ev: 'setNumRedirects', v }); },
  setPrivacySettings(value) { window.__adsLog.push({ ev: 'setPrivacySettings', value }); },
};
const ImaSdkSettings = { VpaidMode: { DISABLED: 0, ENABLED: 1, INSECURE: 2 } };
const OmidAccessMode = { LIMITED: 'limited', DOMAIN: 'domain', FULL: 'full' };
const OmidVerificationVendor = { OTHER: 1, MOAT: 2, DOUBLEVERIFY: 3, INTEGRAL_AD_SCIENCE: 4, PIXELATE: 5, NIELSEN: 6, COMSCORE: 7, MEETRICS: 8, GOOGLE: 9 };

window.google = {
  ima: {
    AdDisplayContainer, AdsLoader, AdsRequest, AdsManager, AdsManagerLoadedEvent,
    AdError, AdErrorEvent, Ad, AdEvent, ViewMode, ImaSdkSettings, settings, OmidAccessMode, OmidVerificationVendor,
  },
};
