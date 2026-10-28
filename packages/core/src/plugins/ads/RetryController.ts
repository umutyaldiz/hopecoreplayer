import type { AdsRetryOptions, RetryDelayEntry } from '../../types';

export type AdBreakType = 'Preroll' | 'Midroll' | 'Postroll';

interface ChainState {
    tags: string[];
    index: number;
    attemptsOnCurrent: number;
}

/** Reklam retry zamanlaması ve fallback zinciri kararları (network'ten bağımsız). */
export class RetryController {
    private adRetryCount = 0;
    private chain: Partial<Record<AdBreakType, ChainState>> = {};
    private retryTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly config: AdsRetryOptions) {}

    get isPending(): boolean {
        return this.retryTimer !== null;
    }

    reset(): void {
        this.adRetryCount = 0;
        this.chain = {};
        this.cancelPending();
    }

    cancelPending(): void {
        if (this.retryTimer) {
            clearTimeout(this.retryTimer);
            this.retryTimer = null;
        }
    }

    /** Devre dışı/kapsam dışı/limit dolduysa onGiveUp; aksi halde (jitter'lı) gecikmeden sonra onRetry. */
    retry(type: AdBreakType, rawTag: string | string[] | undefined, onRetry: (tag: string, attempt: number) => void, onGiveUp: (reason: 'retry-disabled' | 'retry-limit') => void): void {
        if (!this.config.enabled) {
            onGiveUp('retry-disabled');
            return;
        }

        const scope = this.config.retryScope ?? 'preroll';
        if (scope === 'preroll' && type !== 'Preroll') {
            onGiveUp('retry-disabled');
            return;
        }

        const maxRetry = this.resolveMaxRetry();
        if (this.adRetryCount >= maxRetry) {
            this.reset();
            onGiveUp('retry-limit');
            return;
        }

        this.cancelPending();
        this.adRetryCount++;

        const chain = this.getChainState(type, rawTag);
        chain.attemptsOnCurrent++;
        const maxAttemptsPerTag = this.config.maxAttemptsPerTag ?? Infinity;
        if (chain.attemptsOnCurrent > maxAttemptsPerTag && chain.index < chain.tags.length - 1) {
            chain.index++;
            chain.attemptsOnCurrent = 1;
        }
        const tag = chain.tags[chain.index]!;
        const attempt = this.adRetryCount;

        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            onRetry(tag, attempt);
        }, this.applyJitter(this.resolveRetryDelay()));
    }

    private getChainState(type: AdBreakType, rawTag: string | string[] | undefined): ChainState {
        const existing = this.chain[type];
        if (existing) return existing;

        const tags = (Array.isArray(rawTag) ? rawTag : [rawTag]).filter((t): t is string => !!t);
        const state: ChainState = { tags: tags.length ? tags : [rawTag as string], index: 0, attemptsOnCurrent: 0 };
        this.chain[type] = state;
        return state;
    }

    private resolveRetryDelay(): number {
        const pattern = this.config.retryDelayPattern;
        if (!Array.isArray(pattern) || pattern.length === 0) return this.config.retryDelay ?? 800;

        for (const entry of pattern) {
            const [upTo, delay] = this.normalizeEntry(entry);
            if (this.adRetryCount <= upTo) return delay;
        }
        return this.normalizeEntry(pattern[pattern.length - 1]!)[1];
    }

    private resolveMaxRetry(): number {
        const pattern = this.config.retryDelayPattern;
        if (Array.isArray(pattern) && pattern.length > 0) {
            return this.normalizeEntry(pattern[pattern.length - 1]!)[0];
        }
        return this.config.maxRetry ?? 10;
    }

    private normalizeEntry(entry: RetryDelayEntry): [number, number] {
        return Array.isArray(entry) ? entry : [entry.upTo, entry.delay];
    }

    private applyJitter(delay: number): number {
        const jitter = this.config.jitter ?? 0;
        if (!jitter) return delay;
        const factor = 1 + (Math.random() * 2 - 1) * jitter;
        return Math.max(0, Math.round(delay * factor));
    }
}
