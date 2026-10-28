// window.pbjs mock — Prebid.js'in gerçek davranışının basitleştirilmiş hali.
// que.push hemen (senkron) çalıştırılıyor (Prebid init olduktan sonraki
// gerçek davranışla aynı), requestBids bidsBackHandler'ı bir sonraki
// microtask/timeout'ta çağırıyor ki VideoPrebid'in Promise tabanlı akışı
// gerçekçi şekilde test edilsin.
window.__pbjsLog = [];
window.__mockPbjs = {
  // Testler bunu değiştirerek kazanan bid'i/GAM URL'ini kontrol eder.
  winningBid: { bidder: 'ix', cpm: 2.5, vastUrl: 'https://cache.example.com/cache?uuid=mock-uuid-1', videoCacheKey: 'mock-uuid-1' },
  gamBuildVideoUrl: (args) => `https://pubads.g.doubleclick.net/gampad/ads?iu=${encodeURIComponent(args.params.iu)}&output=vast&cust_params=hb_pb%3D2.50%2Chb_uuid%3Dmock-uuid-1`,
};

const que = [];
que.push = function (fn) {
  Array.prototype.push.call(this, fn);
  try { fn(); } catch (err) { console.error('[mock pbjs] que callback error', err); }
};

window.pbjs = {
  que,
  installedModules: ['ixBidAdapter'],
  aliasRegistry: {},
  _lastAdUnit: null,
  setConfig(config) {
    window.__pbjsLog.push({ ev: 'setConfig', config });
  },
  getConfig(key) {
    if (key === 'cache') return { url: 'https://cache.example.com/cache' };
    return undefined;
  },
  addAdUnits(units) {
    window.__pbjsLog.push({ ev: 'addAdUnits', units });
    window.pbjs._lastAdUnit = units[0];
  },
  removeAdUnit(code) {
    window.__pbjsLog.push({ ev: 'removeAdUnit', code });
  },
  requestBids({ adUnits, timeout, bidsBackHandler }) {
    window.__pbjsLog.push({ ev: 'requestBids', adUnitCode: adUnits[0].code, timeout });
    setTimeout(() => bidsBackHandler(), 10);
  },
  getHighestCpmBids(adUnitCode) {
    if (!window.__mockPbjs.winningBid) return [];
    return [{ ...window.__mockPbjs.winningBid }];
  },
  getBidResponsesForAdUnitCode(adUnitCode) {
    return { bids: window.__mockPbjs.winningBid ? [{ ...window.__mockPbjs.winningBid, responseTimestamp: Date.now(), ttl: 300 }] : [] };
  },
  adServers: {
    gam: {
      buildVideoUrl(args) {
        window.__pbjsLog.push({ ev: 'buildVideoUrl', iu: args.params.iu, custParams: args.params.cust_params });
        return window.__mockPbjs.gamBuildVideoUrl(args);
      },
    },
  },
};
