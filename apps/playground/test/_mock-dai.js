// window.google.ima.dai mock — Google DAI SDK (ima3_dai.js) yerine.
// loadDaiSdk() window.google.ima.dai zaten varsa gerçek script'i hiç
// yüklemiyor (bkz. plugins/dai/loadDaiSdk.ts).
window.__daiLog = [];
window.__mockDai = { streamManagerInstances: [] };

class MockLiveStreamRequest {}

class MockStreamEvent {
  constructor(type, streamData) {
    this.type = type;
    this._streamData = streamData;
  }
  getStreamData() {
    return this._streamData;
  }
}
MockStreamEvent.Type = {
  LOADED: 'loaded',
  ERROR: 'error',
  AD_BREAK_STARTED: 'adBreakStarted',
  AD_BREAK_ENDED: 'adBreakEnded',
  AD_PERIOD_STARTED: 'adPeriodStarted',
  AD_PERIOD_ENDED: 'adPeriodEnded',
  CUEPOINTS_CHANGED: 'cuepointsChanged',
  STARTED: 'started',
  SKIPPABLE_STATE_CHANGED: 'skippableStateChanged',
  CLICK: 'click',
};

class MockStreamManager {
  constructor(videoEl, adUiEl) {
    this.videoEl = videoEl;
    this.adUiEl = adUiEl;
    this._listeners = {};
    window.__mockDai.streamManagerInstances.push(this);
  }
  addEventListener(types, listener) {
    (Array.isArray(types) ? types : [types]).forEach((t) => {
      (this._listeners[t] ??= []).push(listener);
    });
  }
  removeEventListener() {}
  dispatch(type, event) {
    (this._listeners[type] || []).forEach((l) => l(event));
  }
  requestStream(request) {
    window.__daiLog.push({ ev: 'requestStream', assetKey: request.assetKey, apiKey: request.apiKey });
  }
  processMetadata(type, payload, timestamp) {
    window.__daiLog.push({ ev: 'processMetadata', type, payload, timestamp });
  }
  reset() {
    window.__daiLog.push({ ev: 'reset' });
  }
}

window.google = window.google || {};
window.google.ima = window.google.ima || {};
window.google.ima.dai = {
  api: {
    StreamManager: MockStreamManager,
    LiveStreamRequest: MockLiveStreamRequest,
    StreamEvent: MockStreamEvent,
  },
};
