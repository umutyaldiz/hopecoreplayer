import type { PrebidBidderConfig, PrebidBreakOptions, PrebidOptions } from '../../types';

/** window.pbjs yüzeyi — Prebid.js sayfaya <script> ile yüklenir, npm bağımlılığı değil. */
interface PbjsBid {
    bidder: string;
    cpm?: number;
    vastUrl?: string;
    vastXml?: string;
    videoCacheKey?: string;
    responseTimestamp?: number;
    ttl?: number;
}

interface Pbjs {
    que: Array<() => void>;
    requestBids(params: { adUnits: unknown[]; timeout: number; bidsBackHandler: () => void }): void;
    addAdUnits(units: unknown[]): void;
    removeAdUnit(code: string): void;
    setConfig(config: Record<string, unknown>): void;
    getConfig?(key: string): { url?: string } | undefined;
    installedModules?: string[];
    aliasRegistry?: Record<string, string>;
    getHighestCpmBids?(adUnitCode: string): PbjsBid[];
    getBidResponsesForAdUnitCode?(adUnitCode: string): { bids: PbjsBid[] };
    adServers?: {
        gam?: { buildVideoUrl(args: { adUnit: unknown; params: Record<string, string> }): string | null };
        dfp?: { buildVideoUrl(args: { adUnit: unknown; params: Record<string, string> }): string | null };
    };
    __hopeConsentApplied?: boolean;
}

declare global {
    interface Window {
        pbjs?: Pbjs;
    }
}

/** Prebid.js instream video header bidding (GAM ve direkt-VAST modları). */
export class VideoPrebid {
    private readonly timeout: number;
    private readonly adUnitCode: string;
    private readonly sizes: Array<[number, number]>;
    private readonly bidders: PrebidBidderConfig[];
    private readonly gamAdUnit: string | null;
    private readonly gpid: string | null;
    private readonly playbackMethod: number;
    private readonly skip: 0 | 1;
    private readonly skipafter: number;
    private readonly maxduration: number;
    private readonly minduration: number;
    private readonly api: number[];
    private readonly protocols: number[];
    private readonly mimes: string[];
    private readonly applyLossFactor: boolean;
    private readonly lossFactors: Record<string, number>;
    private readonly consentManagement: PrebidOptions['consentManagement'];

    private cacheWarned = false;
    private gamWarned = false;
    private cacheKeyWarned = false;

    constructor(opts: PrebidBreakOptions & { consentManagement?: PrebidOptions['consentManagement'] } = {}) {
        this.timeout = opts.timeout ?? 1500;
        this.adUnitCode = opts.adUnitCode || 'hope-video-preroll';
        this.sizes = opts.sizes || [[640, 360]];
        this.bidders = opts.bidders || [];
        this.gamAdUnit = opts.gamAdUnit ?? null;
        this.gpid = opts.gpid ?? this.gamAdUnit ?? null;
        this.playbackMethod = opts.playbackMethod ?? 2;
        this.skip = opts.skip ?? 0;
        this.skipafter = opts.skipafter ?? 5;
        this.maxduration = opts.maxduration ?? 30;
        this.minduration = opts.minduration ?? 1;
        this.api = opts.api || [2, 7];
        this.protocols = opts.protocols || [2, 3, 5, 6, 7, 8];
        this.mimes = opts.mimes || (this.api.includes(2)
            ? ['video/mp4', 'video/webm', 'application/javascript']
            : ['video/mp4', 'video/webm']);
        this.applyLossFactor = opts.applyLossFactor ?? false;
        this.lossFactors = opts.lossFactors || {};
        this.consentManagement = opts.consentManagement ?? null;
    }

    private applyConsentConfig(): void {
        const pbjs = window.pbjs;
        if (!this.consentManagement || !pbjs || pbjs.__hopeConsentApplied) return;
        try {
            pbjs.setConfig({ consentManagement: this.consentManagement });
            pbjs.__hopeConsentApplied = true;
        } catch (err) {
            console.warn('[VideoPrebid] consentManagement setConfig hatası:', err);
        }
    }

    isAvailable(): boolean {
        const pbjs = window.pbjs;
        if (!pbjs || typeof pbjs.requestBids !== 'function') return false;

        if (!this.cacheWarned) {
            const cacheUrl = pbjs.getConfig?.('cache')?.url;
            if (!cacheUrl) {
                console.warn(`[VideoPrebid] pbjs.setConfig({cache:{url}}) tanımlı değil. ${this.gamAdUnit ? 'GAM isteğinde hb_uuid boş kalacak, creative reklam döndüremeyecek.' : 'vastUrl boş dönecek, fallback tag kullanılacak.'}`);
            }
            this.cacheWarned = true;
        }

        const installed = pbjs.installedModules || [];
        if (!installed.length) return true;

        const aliasRegistry = pbjs.aliasRegistry || {};
        return this.bidders.some((b) => {
            if (installed.includes(`${b.bidder}BidAdapter`)) return true;
            const canonical = aliasRegistry[b.bidder];
            return canonical ? installed.includes(`${canonical}BidAdapter`) : false;
        });
    }

    runAuction(fallbackVastUrl: string): Promise<string> {
        return new Promise((resolve) => {
            if (!this.isAvailable()) {
                resolve(fallbackVastUrl);
                return;
            }
            const pbjs = window.pbjs!;

            const adUnit = this.buildAdUnit();
            const cleanup = () => {
                try {
                    pbjs.removeAdUnit(adUnit.code);
                } catch {
                    /* no-op */
                }
            };

            let settled = false;
            const done = (url: string) => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(url);
            };

            pbjs.que = pbjs.que || [];
            pbjs.que.push(() => {
                this.applyConsentConfig();
                pbjs.removeAdUnit(adUnit.code);
                pbjs.addAdUnits([adUnit]);

                // Prebid'in kendi timeoutBuffer default'u 400ms, +300 bidsBackHandler'dan
                // önce ateşleyebiliyordu — +500ms tampon bu yüzden.
                const failsafe = setTimeout(() => done(fallbackVastUrl), this.timeout + 500);

                pbjs.requestBids({
                    adUnits: [adUnit],
                    timeout: this.timeout,
                    bidsBackHandler: () => {
                        clearTimeout(failsafe);
                        done(this.resolveVastUrl(adUnit, fallbackVastUrl));
                    },
                });
            });
        });
    }

    private buildAdUnit(): { code: string; ortb2Imp: unknown; mediaTypes: unknown; bids: PrebidBidderConfig[] } {
        const bids: PrebidBidderConfig[] = typeof structuredClone === 'function'
            ? structuredClone(this.bidders)
            : (JSON.parse(JSON.stringify(this.bidders)) as PrebidBidderConfig[]);

        const stableId = this.gpid || this.adUnitCode;

        return {
            code: this.adUnitCode,
            ortb2Imp: {
                ext: {
                    gpid: stableId,
                    data: { pbadslot: stableId },
                },
            },
            mediaTypes: {
                video: {
                    context: 'instream',
                    playerSize: this.sizes,
                    mimes: this.mimes,
                    protocols: this.protocols,
                    api: this.api,
                    minduration: this.minduration,
                    maxduration: this.maxduration,
                    startdelay: 0,
                    playbackmethod: [this.playbackMethod],
                    linearity: 1,
                    plcmt: 1,
                    placement: 1,
                    skip: this.skip,
                    ...(this.skip ? { skipafter: this.skipafter } : {}),
                    pos: 1,
                },
            },
            bids,
        };
    }

    private getGamAdServer(): {
        buildVideoUrl(args: { adUnit: unknown; params: Record<string, string | Record<string, string>> }): string | null;
    } | null {
        const adServers = window.pbjs?.adServers;
        const gam = adServers?.gam || adServers?.dfp;
        return typeof gam?.buildVideoUrl === 'function' ? gam : null;
    }

    /** Fallback tag'in cust_params'ını objeye çevirir — buildVideoUrl URL'i sıfırdan kurduğu için ayrıca geçilmeli. */
    private extractCustParams(url: string): Record<string, string> {
        const result: Record<string, string> = {};
        try {
            const raw = new URL(url).searchParams.get('cust_params');
            if (!raw) return result;
            for (const pair of raw.split('&')) {
                const idx = pair.indexOf('=');
                if (idx <= 0) continue;
                const key = pair.slice(0, idx);
                if (key.startsWith('hb_')) continue;
                result[key] = pair.slice(idx + 1);
            }
        } catch (err) {
            console.warn('[VideoPrebid] fallback cust_params okunamadı:', err);
        }
        return result;
    }

    private pickWinningBid(adUnitCode: string): PbjsBid | undefined {
        const pbjs = window.pbjs!;
        if (!this.applyLossFactor) {
            return (pbjs.getHighestCpmBids?.(adUnitCode) || [])[0];
        }

        const responses = pbjs.getBidResponsesForAdUnitCode?.(adUnitCode)?.bids || [];
        if (!responses.length) return undefined;

        const now = Date.now();
        const valid = responses.filter((b) => !b.responseTimestamp || !b.ttl || b.responseTimestamp + b.ttl * 1000 > now);
        if (!valid.length) return undefined;

        let best: PbjsBid | undefined;
        let bestWeighted = -Infinity;
        for (const bid of valid) {
            const factor = this.lossFactors[bid.bidder] ?? 1;
            const weighted = (bid.cpm || 0) * factor;
            if (weighted > bestWeighted) {
                bestWeighted = weighted;
                best = bid;
            }
        }
        return best;
    }

    private resolveVastUrl(adUnit: { code: string }, fallback: string): string {
        const gam = this.gamAdUnit ? this.getGamAdServer() : null;

        if (this.gamAdUnit && !gam && !this.gamWarned) {
            console.warn('[VideoPrebid] pbjs.adServers.gam.buildVideoUrl bulunamadı — Prebid build\'inde "Google Ad Manager Video" (dfpAdServerVideo) modülü yok. GAM atlanıyor, kazanan bid\'in vastUrl\'i kullanılacak.');
            this.gamWarned = true;
        }

        const winner = this.pickWinningBid(adUnit.code);

        if (gam && !winner) {
            console.warn(`[VideoPrebid] Auction'dan kazanan bid çıkmadı — GAM isteği hb_pb/hb_bidder olmadan gidiyor, cust_params'ta hb_uuid=undefined görünecek. pbjs.getBidResponsesForAdUnitCode('${adUnit.code}') ve pbjs.getEvents() ile no-bid/timeout sebebine bakın.`);
        }

        if (gam && winner && !winner.videoCacheKey && !this.cacheKeyWarned) {
            console.warn(`[VideoPrebid] Kazanan bid'de videoCacheKey yok — GAM isteğine hb_uuid=undefined gidecek. VAST cache'e yazılmamış: pbjs.setConfig({cache:{url}}) auction'dan önce çalışıyor mu ve cache POST'u başarılı mı kontrol edin. (bidder: ${winner.bidder})`);
            this.cacheKeyWarned = true;
        }

        if (gam) {
            try {
                const url = gam.buildVideoUrl({
                    adUnit,
                    params: {
                        iu: this.gamAdUnit!,
                        output: 'vast',
                        description_url: window.location.href,
                        url: window.location.href,
                        cust_params: this.extractCustParams(fallback),
                    },
                });
                if (url) return url;
            } catch (err) {
                console.warn('[VideoPrebid] buildVideoUrl failed:', err);
            }
        }

        if (winner) {
            if (winner.vastUrl) return winner.vastUrl;
            if (winner.vastXml) {
                console.warn('[VideoPrebid] Kazanan bid vastXml içeriyor ancak Prebid cache yapılandırılmamış. pbjs.setConfig({cache:{url}}) ekleyin. Fallback\'e düşülüyor.');
            }
        }

        return fallback;
    }
}

export default VideoPrebid;
