import type { ShareNetwork, ShareOptions } from '../../types';
import type { HopeLocaleStrings } from '../../i18n/types';
import { createIcon } from '../../icons/Icon';
import { formatTime } from '../../utils/format-time';
import { adoptStyle } from '../../utils/plugin-style';
import css from './share.css?inline';

export interface SharePlayerContext {
    hostEl: HTMLElement;
    videoEl: HTMLVideoElement;
    overlayEl: HTMLElement;
    i18n: HopeLocaleStrings;
    addButton(label: string, iconName: string, onClick: () => void): { btn: HTMLButtonElement; icon: HTMLElement };
    isLive(): boolean;
}

const DEFAULT_NETWORKS: ShareNetwork[] = ['x', 'whatsapp', 'facebook', 'linkedin', 'telegram', 'email'];

const NETWORK_NAMES: Record<ShareNetwork, string> = {
    x: 'X',
    whatsapp: 'WhatsApp',
    facebook: 'Facebook',
    linkedin: 'LinkedIn',
    telegram: 'Telegram',
    reddit: 'Reddit',
    email: 'Email',
};

/** Ağın paylaşım adresi. */
function networkUrl(network: ShareNetwork, url: string, title: string): string {
    const u = encodeURIComponent(url);
    const t = encodeURIComponent(title);
    switch (network) {
        case 'x':
            return `https://x.com/intent/post?url=${u}&text=${t}`;
        case 'whatsapp':
            return `https://wa.me/?text=${encodeURIComponent(title ? `${title} ${url}` : url)}`;
        case 'facebook':
            return `https://www.facebook.com/sharer/sharer.php?u=${u}`;
        case 'linkedin':
            return `https://www.linkedin.com/sharing/share-offsite/?url=${u}`;
        case 'telegram':
            return `https://t.me/share/url?url=${u}&text=${t}`;
        case 'reddit':
            return `https://www.reddit.com/submit?url=${u}&title=${t}`;
        case 'email':
            return `mailto:?subject=${t}&body=${u}`;
    }
}

/** "90", "1:30", "1:02:03", "1m30s", "1h2m3s" → saniye; geçersizse null. */
export function parseTimeParam(raw: string | null): number | null {
    if (!raw) return null;
    const v = raw.trim();
    if (/^\d+(\.\d+)?$/.test(v)) return Number(v);
    if (/^\d+(:\d{1,2}){1,2}$/.test(v)) return v.split(':').reduce((a, p) => a * 60 + Number(p), 0);
    const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i.exec(v);
    if (m && (m[1] || m[2] || m[3])) return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
    return null;
}

/**
 * Paylaşım paneli: bağlantıyı kopyala, "bu andan başlat" (?t=), seçilen sosyal ağlar ve cihazın kendi paylaşım menüsü
 * (Web Share API, varsa). Sayfa ?t= ile açılınca video o saniyeden başlar.
 */
export class Share {
    private panel: HTMLElement | null = null;
    private button: HTMLButtonElement | null = null;
    private copyTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly param: string;

    constructor(
        private readonly ctx: SharePlayerContext,
        private readonly options: ShareOptions
    ) {
        adoptStyle(ctx.overlayEl, 'share', css);
        this.param = options.param || 't';
        if (options.button !== false) {
            const { btn } = ctx.addButton(ctx.i18n.share, 'share', () => (this.panel ? this.close() : this.open()));
            this.button = btn;
        }
        if (options.readParam !== false) this.applyStartParam();
    }

    refreshLabels(): void {
        this.button?.setAttribute('aria-label', this.ctx.i18n.share);
        if (this.panel) {
            this.close();
            this.open();
        }
    }

    destroy(): void {
        this.close();
        this.button?.remove();
        this.stopStart();
    }

    /** Paylaşılacak temel adres: verilen, canonical ya da sayfa adresi (zaman parametresi temizlenir). */
    private baseUrl(): string {
        const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
        const u = new URL(this.options.url || canonical || location.href, location.href);
        u.searchParams.delete(this.param);
        u.hash = '';
        return u.toString();
    }

    private time(): number | null {
        const v = this.ctx.videoEl;
        if (this.ctx.isLive() || !Number.isFinite(v.duration)) return null;
        const t = Math.floor(v.currentTime);
        return t > 0 ? t : null;
    }

    private shareUrl(withTime: boolean): string {
        const t = this.time();
        const u = new URL(this.baseUrl());
        if (withTime && t !== null) u.searchParams.set(this.param, String(t));
        return u.toString();
    }

    private emit(action: string, url: string, time: number | null): boolean {
        return this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:share', { detail: { action, url, time }, cancelable: true }));
    }

    open(): void {
        if (this.panel) return;
        const i18n = this.ctx.i18n;
        const t = this.time();
        let withTime = this.options.startAt !== false && t !== null;
        const title = this.options.title ?? document.title;

        const panel = document.createElement('div');
        panel.className = 'hp-share';
        panel.setAttribute('part', 'share');
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', i18n.share);

        const head = document.createElement('div');
        head.className = 'hp-share-head';
        const h = document.createElement('span');
        h.className = 'hp-share-title';
        h.textContent = i18n.share;
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'hp-share-close';
        close.setAttribute('aria-label', i18n.shareClose);
        close.appendChild(createIcon('close'));
        close.addEventListener('click', () => this.close());
        head.append(h, close);

        const row = document.createElement('div');
        row.className = 'hp-share-link';
        const input = document.createElement('input');
        input.type = 'text';
        input.readOnly = true;
        input.setAttribute('aria-label', i18n.shareLink);
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'hp-share-copy';
        copy.textContent = i18n.shareCopy;
        const refresh = (): void => {
            input.value = this.shareUrl(withTime);
        };
        copy.addEventListener('click', () => {
            const url = input.value;
            if (!this.emit('copy', url, withTime ? t : null)) return;
            const done = (): void => {
                copy.textContent = i18n.shareCopied;
                copy.setAttribute('data-done', '');
                if (this.copyTimer) clearTimeout(this.copyTimer);
                this.copyTimer = setTimeout(() => {
                    copy.textContent = i18n.shareCopy;
                    copy.removeAttribute('data-done');
                }, 2000);
            };
            // Clipboard API yoksa (http, eski tarayıcı) seçili metni kopyala.
            void (navigator.clipboard?.writeText(url) ?? Promise.reject())
                .catch(() => {
                    input.select();
                    document.execCommand('copy');
                })
                .then(done, done);
        });
        input.addEventListener('focus', () => input.select());
        row.append(input, copy);

        panel.append(head, row);

        if (this.options.startAt !== false && t !== null) {
            const label = document.createElement('label');
            label.className = 'hp-share-start';
            const box = document.createElement('input');
            box.type = 'checkbox';
            box.checked = withTime;
            box.addEventListener('change', () => {
                withTime = box.checked;
                refresh();
            });
            label.append(box, document.createTextNode(i18n.shareStartAt(formatTime(t))));
            panel.appendChild(label);
        }

        const networks = this.options.networks ?? DEFAULT_NETWORKS;
        const nav = typeof navigator.share === 'function';
        if (networks.length || nav) {
            const list = document.createElement('div');
            list.className = 'hp-share-networks';
            for (const n of networks) {
                if (!NETWORK_NAMES[n]) continue;
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'hp-share-net';
                b.setAttribute('data-network', n);
                b.textContent = n === 'email' ? i18n.shareEmail : NETWORK_NAMES[n];
                b.addEventListener('click', () => {
                    const url = input.value;
                    if (!this.emit(n, url, withTime ? t : null)) return;
                    const target = networkUrl(n, url, title);
                    if (n === 'email') location.href = target;
                    else window.open(target, '_blank', 'noopener,width=640,height=560');
                });
                list.appendChild(b);
            }
            if (nav) {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'hp-share-net';
                b.setAttribute('data-network', 'native');
                b.textContent = i18n.shareMore;
                b.addEventListener('click', () => {
                    const url = input.value;
                    if (!this.emit('native', url, withTime ? t : null)) return;
                    void navigator.share({ url, title }).catch(() => {});
                });
                list.appendChild(b);
            }
            panel.appendChild(list);
        }

        for (const ev of ['pointerdown', 'click', 'dblclick'] as const) panel.addEventListener(ev, (e) => e.stopPropagation());
        panel.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.close();
                this.button?.focus();
            }
            e.stopPropagation();
        });
        refresh();
        this.ctx.overlayEl.appendChild(panel);
        this.panel = panel;
        this.button?.setAttribute('aria-expanded', 'true');
        copy.focus({ preventScroll: true });
        this.emit('open', input.value, withTime ? t : null);
    }

    close(): void {
        if (this.copyTimer) clearTimeout(this.copyTimer);
        this.copyTimer = null;
        this.panel?.remove();
        this.panel = null;
        this.button?.setAttribute('aria-expanded', 'false');
    }

    /** Sayfa ?t=… ile açıldıysa video o saniyeden başlar (yalnızca ilk yüklemede). */
    private applyStartParam(): void {
        const t = parseTimeParam(new URLSearchParams(location.search).get(this.param));
        if (t === null) return;
        this.startAt = t;
        const v = this.ctx.videoEl;
        // Kaynak yeniden yüklenirse (emptied → loadedmetadata) ya da tarayıcı erken sarmayı başa atarsa
        // (WebKit: veri hazır değilken) canplay'de tekrar denenir; hedefe varınca bırakılır.
        v.addEventListener('loadedmetadata', this.seekToParam);
        v.addEventListener('canplay', this.seekToParam);
        v.addEventListener('seeked', this.confirmStart);
        if (v.readyState >= 1) this.seekToParam();
    }

    private startAt: number | null = null;
    private startTries = 0;

    private readonly seekToParam = (): void => {
        const v = this.ctx.videoEl;
        const t = this.startAt;
        if (t === null) return;
        if (this.ctx.isLive()) return this.stopStart();
        if (!Number.isFinite(v.duration) || v.seeking) return;
        const target = Math.min(t, Math.max(0, v.duration - 1));
        if (Math.abs(v.currentTime - target) <= 0.5) return this.stopStart();
        if (++this.startTries > 3) return this.stopStart();
        v.currentTime = target;
    };

    private readonly confirmStart = (): void => {
        const v = this.ctx.videoEl;
        if (this.startAt !== null && !this.ctx.isLive() && Math.abs(v.currentTime - Math.min(this.startAt, v.duration - 1)) > 0.5) return;
        this.stopStart();
    };

    private stopStart(): void {
        const v = this.ctx.videoEl;
        this.startAt = null;
        v.removeEventListener('loadedmetadata', this.seekToParam);
        v.removeEventListener('canplay', this.seekToParam);
        v.removeEventListener('seeked', this.confirmStart);
    }
}
