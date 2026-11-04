import type { RewardedResult, RewardedUnlockOptions } from '../../types';
import type { HopeLocaleStrings } from '../../i18n/types';
import { LOCK_SVG } from '../../controls/SettingsMenu';
import { showGptRewarded } from './gpt';

export interface RewardedUnlockContext {
    hostEl: HTMLElement;
    videoEl: HTMLVideoElement;
    /** Onay penceresinin ekleneceği alan (video alanı). */
    overlayEl: HTMLElement;
    /** Buton kontrollerle birlikte görünüp gizlensin diye kontrol katmanına eklenir. */
    chromeEl: HTMLElement;
    i18n: HopeLocaleStrings;
    log(entry: { message: string; details?: Record<string, string | number | boolean | undefined> }): void;
    play(): void;
    exitFullscreen(): void;
    /** Kilitli kalitelerin en yükseği (ör. "1080p") — yoksa null (buton gizlenir). */
    lockedQualityLabel(): string | null;
    /** İçeriğin kimliği (kaynak listesi) — kalite değişince değişmez, başka video yüklenince değişir. */
    contentKey(): string;
    /** Kilit açıldı / geri geldi: player menüleri yeniden kurar; `upgrade` → en iyi kaliteye geç. */
    onLockChange(upgrade: boolean): void;
}

const DEFAULT_MAX_FREE_HEIGHT = 480;
const DEFAULT_STORAGE_KEY = 'hope-rewarded-unlock';
const DEFAULT_GPT_TIMEOUT_MS = 8000;
const TOAST_MS = 2600;

type Phase = 'idle' | 'prompt' | 'loading' | 'nofill';

/**
 * Ödüllü reklamla kalite kilidi. Akış (Google'ın ödüllü reklam politikasına göre): kullanıcı kilitli bir kaliteye ya da
 * "Yüksek kaliteyi aç" butonuna dokunur → ödülü açıkça yazan onay penceresi → yalnızca "Reklamı izle" ile reklam istenir
 * → ödül verildiyse kilit açılır. Vazgeçmek videoyu izlemeyi engellemez (düşük kalitede devam eder).
 */
/** Diyalog başlık id'leri — aynı sayfada birden çok player olabilir. */
let dialogSeq = 0;

export class RewardedUnlock {
    private options: RewardedUnlockOptions;
    private readonly button: HTMLButtonElement;
    private dialog: HTMLDivElement | null = null;
    private toast: HTMLDivElement | null = null;
    private toastTimer: ReturnType<typeof setTimeout> | null = null;
    private phase: Phase = 'idle';
    /** 'video' modunda kilidin açık olduğu içerik (kaynak listesi — kalite dosyası değil). */
    private videoUnlockedKey: string | null = null;
    private lastKey = '';

    constructor(
        private readonly ctx: RewardedUnlockContext,
        options: RewardedUnlockOptions
    ) {
        this.options = options;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'hp-rw-button';
        btn.setAttribute('part', 'rewarded-button');
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.requestUnlock();
        });
        btn.addEventListener('pointerdown', (e) => e.stopPropagation());
        ctx.chromeEl.appendChild(btn);
        this.button = btn;
        ctx.videoEl.addEventListener('loadstart', this.onSourceChange);
        this.refreshLabels();
        this.onQualitiesChanged();
    }

    update(options: RewardedUnlockOptions): void {
        const before = this.unlocked;
        this.options = options;
        if (before !== this.unlocked) this.ctx.onLockChange(false);
        this.onQualitiesChanged();
    }

    // ── Kilit durumu ────────────────────────────────────────────────────

    private get maxFreeHeight(): number {
        const h = this.options.maxFreeHeight;
        return typeof h === 'number' && h > 0 ? h : DEFAULT_MAX_FREE_HEIGHT;
    }

    private get storageKey(): string {
        return this.options.storageKey || DEFAULT_STORAGE_KEY;
    }

    private get unlockFor(): 'video' | 'session' | number {
        const u = this.options.unlockFor;
        return typeof u === 'number' && u > 0 ? u : u === 'video' ? 'video' : 'session';
    }

    get unlocked(): boolean {
        const mode = this.unlockFor;
        if (mode === 'video') return !!this.videoUnlockedKey && this.videoUnlockedKey === this.ctx.contentKey();
        try {
            if (mode === 'session') return sessionStorage.getItem(this.storageKey) === '1';
            const until = Number(localStorage.getItem(this.storageKey));
            return Number.isFinite(until) && until > Date.now();
        } catch {
            return false; // depolama kapalı (gizli mod vb.)
        }
    }

    private grant(): void {
        const mode = this.unlockFor;
        if (mode === 'video') this.videoUnlockedKey = this.ctx.contentKey();
        try {
            if (mode === 'session') sessionStorage.setItem(this.storageKey, '1');
            else if (typeof mode === 'number') localStorage.setItem(this.storageKey, String(Date.now() + mode * 60_000));
        } catch {
            // Depolama yoksa yalnızca bu video için açık kalır.
            this.videoUnlockedKey = this.ctx.contentKey();
        }
    }

    /** Player için: bu yükseklikteki kalite kilitli mi? */
    isLocked(height: number | null): boolean {
        if (this.unlocked) return false;
        return height !== null && height > this.maxFreeHeight;
    }

    /** Kaynak değişti: 'video' modunda kilit yeniden kapanır; süreli kilit dolduysa menüler güncellenir. */
    private readonly onSourceChange = (): void => {
        const key = this.ctx.contentKey();
        if (key === this.lastKey) return;
        this.lastKey = key;
        this.onQualitiesChanged();
    };

    /** Player kalite listesi değişince çağırır: buton yalnızca kilitli kalite varken görünür. */
    onQualitiesChanged(): void {
        const label = this.ctx.lockedQualityLabel();
        const show = this.options.button !== false && !!label && !this.unlocked;
        this.button.hidden = !show;
        if (!show) return;
        const text = this.fill(this.ctx.i18n.rewardedButton, label!);
        this.button.innerHTML = `${LOCK_SVG}<span>${escapeHtml(text)}</span>`;
        // Erişilebilir ad görünen metinle aynı (sesli komutla "720p kilidini aç" dendiğinde bulunabilsin).
        this.button.setAttribute('aria-label', text);
    }

    // ── Akış ────────────────────────────────────────────────────────────

    /** Kilitli kaliteye ya da butona dokunuldu: onay penceresi. */
    requestUnlock(): void {
        if (this.unlocked || this.phase !== 'idle') return;
        const label = this.ctx.lockedQualityLabel() ?? 'HD';
        this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:rewardedprompt', { detail: { quality: label } }));
        this.showDialog('prompt', label);
    }

    private async watch(label: string): Promise<void> {
        const v = this.ctx.videoEl;
        const wasPlaying = !v.paused;
        v.pause();
        // GPT reklamı sayfanın kendi katmanında açılır — player tam ekrandaysa görünmez.
        this.ctx.exitFullscreen();
        this.abort = new AbortController();
        const signal = this.abort.signal;
        this.showDialog('loading', label);
        let result: RewardedResult;
        try {
            result = await this.runProvider(signal);
        } catch (err) {
            this.ctx.log({ message: `Rewarded ad failed: ${String(err)}` });
            result = 'nofill';
        }
        this.abort = null;
        // Kullanıcı hazırlanırken "Vazgeç" dedi — sonuç ne olursa olsun ödül yok, video devam eder.
        if (signal.aborted) {
            this.closeDialog();
            this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:rewardedclosed', { detail: { granted: false, cancelled: true } }));
            if (wasPlaying) this.ctx.play();
            return;
        }
        // Reklam yok / boş / hata: kusur kullanıcıda değil — varsayılan olarak kilit yine de açılır (grantOnNoFill: false kapatır).
        let noAd = false;
        if (result === 'nofill' && this.options.grantOnNoFill !== false) {
            this.ctx.log({ message: 'Rewarded ad: no ad available (no fill / error / timeout) — unlocked anyway (grantOnNoFill)' });
            this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:rewardednofill', { detail: { granted: true } }));
            result = 'granted';
            noAd = true;
        }
        if (result === 'granted') {
            this.grant();
            this.closeDialog();
            this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:rewardedgranted', { detail: { quality: label, noAd } }));
            this.ctx.onLockChange(true);
            this.onQualitiesChanged();
            this.showToast(this.fill(noAd ? this.ctx.i18n.rewardedUnlockedNoAd : this.ctx.i18n.rewardedUnlocked, label));
            if (wasPlaying) this.ctx.play();
            return;
        }
        if (result === 'nofill') {
            this.ctx.log({ message: 'Rewarded ad: no ad available (no fill / unsupported page / timeout)' });
            this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:rewardednofill', { detail: { granted: false } }));
            this.showDialog('nofill', label);
            this.resumeAfterDialog = wasPlaying;
            return;
        }
        // Kullanıcı reklamı ödül kazanmadan kapattı — video kaldığı kalitede devam eder.
        this.closeDialog();
        this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:rewardedclosed', { detail: { granted: false } }));
        if (wasPlaying) this.ctx.play();
    }

    private resumeAfterDialog = false;
    /** Reklam hazırlanırken "Vazgeç" — sağlayıcıya iletilir (GPT slotu temizlenir). */
    private abort: AbortController | null = null;

    private async runProvider(signal: AbortSignal): Promise<RewardedResult> {
        const p = this.options.provider;
        if (p?.type === 'gpt') return showGptRewarded(p.adUnitPath, p.timeoutMs ?? DEFAULT_GPT_TIMEOUT_MS, signal);
        if (p?.type === 'custom') {
            // İptal edilirse kendi reklam sisteminizin sonucu beklenmez (sinyali kendi tarafınızda da dinleyebilirsiniz).
            const aborted = new Promise<RewardedResult>((resolve) => signal.addEventListener('abort', () => resolve('closed'), { once: true }));
            const r = await Promise.race([p.show({ signal }), aborted]);
            return r === true ? 'granted' : r === false ? 'closed' : r;
        }
        throw new Error('rewardedUnlock.provider is missing');
    }

    // ── Arayüz ─────────────────────────────────────────────────────────

    private fill(template: string, quality: string): string {
        const mode = this.unlockFor;
        const i = this.ctx.i18n;
        const duration =
            mode === 'video' ? i.rewardedForVideo : mode === 'session' ? i.rewardedForSession : i.rewardedForMinutes.replace('{n}', String(mode));
        return template.replace('{quality}', quality).replace('{duration}', duration);
    }

    private showDialog(phase: Exclude<Phase, 'idle'>, label: string): void {
        this.phase = phase;
        const i = this.ctx.i18n;
        if (!this.dialog) {
            const d = document.createElement('div');
            d.className = 'hp-rw-dialog';
            d.setAttribute('part', 'rewarded-dialog');
            d.setAttribute('role', 'dialog');
            d.setAttribute('aria-modal', 'true');
            for (const t of ['click', 'pointerdown', 'dblclick'] as const) d.addEventListener(t, (e) => e.stopPropagation());
            d.addEventListener('keydown', (e) => {
                e.stopPropagation();
                if (e.key !== 'Escape') return;
                if (this.phase === 'loading') this.abort?.abort();
                else this.dismiss();
            });
            this.ctx.overlayEl.appendChild(d);
            this.dialog = d;
        }
        const d = this.dialog;
        d.setAttribute('data-phase', phase);
        d.innerHTML = '';
        const card = document.createElement('div');
        card.className = 'hp-rw-card';
        const icon = document.createElement('div');
        icon.className = 'hp-rw-icon';
        icon.innerHTML = LOCK_SVG;
        const title = document.createElement('div');
        title.className = 'hp-rw-title';
        // Diyaloğun erişilebilir adı başlığı (ekran okuyucu "720p kilidini aç" diye okur).
        title.id = `hp-rw-title-${++dialogSeq}`;
        d.setAttribute('aria-labelledby', title.id);
        const text = document.createElement('div');
        text.className = 'hp-rw-text';
        const actions = document.createElement('div');
        actions.className = 'hp-rw-actions';
        card.append(icon, title, text, actions);
        d.appendChild(card);

        const button = (labelText: string, primary: boolean, onClick: () => void): HTMLButtonElement => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = primary ? 'hp-rw-btn hp-rw-btn-primary' : 'hp-rw-btn';
            b.textContent = labelText;
            b.addEventListener('click', onClick);
            actions.appendChild(b);
            return b;
        };

        if (phase === 'prompt') {
            title.textContent = this.fill(i.rewardedTitle, label);
            // Ödül, reklamdan ÖNCE açıkça yazılır (politika şartı).
            text.textContent = this.fill(i.rewardedBody, label);
            button(i.rewardedDecline, false, () => this.dismiss());
            button(i.rewardedWatch, true, () => void this.watch(label)).focus();
        } else if (phase === 'loading') {
            title.textContent = i.rewardedLoading;
            const spin = document.createElement('div');
            spin.className = 'hp-rw-spinner';
            text.appendChild(spin);
            // Hazırlanma ne kadar sürerse sürsün kullanıcı takılı kalmaz.
            button(i.rewardedDecline, false, () => this.abort?.abort());
        } else {
            title.textContent = this.fill(i.rewardedTitle, label);
            text.textContent = i.rewardedNoFill;
            button(i.rewardedOk, true, () => this.dismiss()).focus();
        }
    }

    private dismiss(): void {
        const wasNoFill = this.phase === 'nofill';
        this.closeDialog();
        if (!wasNoFill) this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:rewardedclosed', { detail: { granted: false, declined: true } }));
        if (this.resumeAfterDialog) this.ctx.play();
        this.resumeAfterDialog = false;
    }

    private closeDialog(): void {
        this.phase = 'idle';
        this.dialog?.remove();
        this.dialog = null;
    }

    private showToast(message: string): void {
        if (this.toastTimer) clearTimeout(this.toastTimer);
        this.toast?.remove();
        const t = document.createElement('div');
        t.className = 'hp-rw-toast';
        t.setAttribute('part', 'rewarded-toast');
        t.setAttribute('role', 'status');
        t.textContent = message;
        this.ctx.overlayEl.appendChild(t);
        this.toast = t;
        this.toastTimer = setTimeout(() => {
            this.toast?.remove();
            this.toast = null;
        }, TOAST_MS);
    }

    refreshLabels(): void {
        this.onQualitiesChanged();
    }

    destroy(): void {
        this.abort?.abort();
        this.ctx.videoEl.removeEventListener('loadstart', this.onSourceChange);
        if (this.toastTimer) clearTimeout(this.toastTimer);
        this.toast?.remove();
        this.closeDialog();
        this.button.remove();
    }
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
