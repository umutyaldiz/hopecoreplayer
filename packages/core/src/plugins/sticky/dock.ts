import type { StickyCorner } from '../../types';
import { storageGet, storageSet } from '../../utils/storage';
import { adoptStyle } from '../../utils/plugin-style';
import css from './sticky-dock.css?inline';

export interface DockOptions {
    draggable: boolean;
    resizable: boolean;
    minWidth: number;
    maxWidth: number;
    remember: boolean;
}

const CORNER_KEY = 'hope_sticky_corner';
const WIDTH_KEY = 'hope_sticky_width';
/** Ekran kenarından boşluk (ana CSS'teki köşe konumlarıyla aynı). */
const MARGIN = 16;
/** Bu kadar kaymadan sürükleme başlamaz — kısa dokunuş tıklama sayılır. */
const DRAG_PX = 6;
const CORNERS: StickyCorner[] = ['tl', 'tr', 'bl', 'br'];
/** Sürükleme başlatmayan öğeler (kontroller, menüler, seek bar). */
const INTERACTIVE = 'button, a, input, select, textarea, [role="slider"], [role="menu"], [role="menuitem"], [role="dialog"], .hp-seekbar, .hp-sticky-resize';
/** Buton olsa da sürüklemeyi engellemeyen tam alan yüzeyleri. */
const SURFACE = '[part="center-play-button"]';

/** Kaydedilmiş köşe / genişlik (rememberPosition). */
export function savedDock(): { corner?: StickyCorner; width?: number } {
    const c = storageGet(CORNER_KEY) as StickyCorner | null;
    const w = Number(storageGet(WIDTH_KEY));
    return { corner: c && CORNERS.includes(c) ? c : undefined, width: w > 0 ? w : undefined };
}

/**
 * Sticky dock'u sürüklenebilir (bırakınca en yakın köşeye oturur) ve köşelerden boyutlandırılabilir yapar.
 * Dönen fonksiyon her şeyi geri alır.
 */
export function enableDock(
    host: HTMLElement,
    mount: HTMLElement,
    dock: { corner(): StickyCorner; setCorner(c: StickyCorner): void; width?: number; setWidth(w: number): void },
    o: DockOptions
): () => void {
    adoptStyle(mount, 'sticky-dock', css);
    const off: Array<() => void> = [];
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void, opt?: AddEventListenerOptions): void => {
        el.addEventListener(type, fn as EventListener, opt);
        off.push(() => el.removeEventListener(type, fn as EventListener, opt));
    };
    const save = (key: string, value: string): void => {
        if (o.remember) storageSet(key, value);
    };
    const clampW = (w: number): number => Math.round(Math.max(o.minWidth, Math.min(o.maxWidth, innerWidth - 2 * MARGIN, w)));
    const setWidth = (w: number): void => {
        host.style.setProperty('--hp-sticky-w', `${clampW(w)}px`);
        host.setAttribute('data-sticky-w', '');
    };
    if (dock.width) setWidth(dock.width);

    if (o.draggable) {
        host.setAttribute('data-sticky-draggable', '');
        let start: { x: number; y: number; left: number; top: number; id: number } | null = null;
        let dragging = false;
        // Hızlı harekette imleç player'dan çıkabilir — basılınca hareketler pencereden dinlenir.
        const track = (add: boolean): void => {
            const f = add ? addEventListener : removeEventListener;
            f('pointermove', move as EventListener);
            f('pointerup', end as EventListener);
            f('pointercancel', end as EventListener);
        };
        on(host, 'pointerdown', (e) => {
            if (e.button !== 0 || !e.isPrimary) return;
            // Ortadaki büyük oynat butonu tüm alanı kaplar — sürüklenebilir yüzey sayılır (kısa tıklama yine oynatır).
            if (e.composedPath().some((n) => n instanceof Element && n.matches(INTERACTIVE) && !n.matches(SURFACE))) return;
            const r = host.getBoundingClientRect();
            start = { x: e.clientX, y: e.clientY, left: r.left, top: r.top, id: e.pointerId };
            dragging = false;
            track(true);
        });
        off.push(() => track(false));
        const move = (e: PointerEvent): void => {
            if (!start || e.pointerId !== start.id) return;
            const dx = e.clientX - start.x;
            const dy = e.clientY - start.y;
            if (!dragging) {
                if (Math.hypot(dx, dy) < DRAG_PX) return;
                dragging = true;
                host.setPointerCapture?.(e.pointerId);
                host.setAttribute('data-sticky-drag', '');
            }
            const r = host.getBoundingClientRect();
            const x = Math.max(0, Math.min(innerWidth - r.width, start.left + dx));
            const y = Math.max(0, Math.min(innerHeight - r.height, start.top + dy));
            host.style.setProperty('--hp-sticky-x', `${x}px`);
            host.style.setProperty('--hp-sticky-y', `${y}px`);
        };
        const end = (e: PointerEvent): void => {
            if (!start || e.pointerId !== start.id) return;
            start = null;
            track(false);
            if (!dragging) return;
            dragging = false;
            const from = host.getBoundingClientRect();
            const c = `${from.top + from.height / 2 < innerHeight / 2 ? 't' : 'b'}${from.left + from.width / 2 < innerWidth / 2 ? 'l' : 'r'}` as StickyCorner;
            host.removeAttribute('data-sticky-drag');
            dock.setCorner(c);
            save(CORNER_KEY, c);
            // Bırakıldığı yerden köşeye kayarak oturur.
            const to = host.getBoundingClientRect();
            const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
            if (!reduced && typeof host.animate === 'function') {
                host.animate([{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
            }
            // Sürüklemenin sonundaki tıklama oynat / duraklat yapmasın.
            const swallow = (ev: Event): void => {
                ev.stopPropagation();
                ev.preventDefault();
            };
            host.addEventListener('click', swallow, { capture: true, once: true });
            setTimeout(() => host.removeEventListener('click', swallow, { capture: true }), 0);
        };
    }

    if (o.resizable) {
        host.setAttribute('data-sticky-resizable', '');
        for (const c of CORNERS) {
            const h = document.createElement('div');
            h.className = 'hp-sticky-resize';
            h.setAttribute('data-c', c);
            h.setAttribute('aria-hidden', 'true');
            mount.appendChild(h);
            off.push(() => h.remove());
            let id: number | null = null;
            let from = { x: 0, y: 0, w: 0, ratio: 16 / 9 };
            on(h, 'pointerdown', (e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                e.preventDefault();
                id = e.pointerId;
                h.setPointerCapture?.(e.pointerId);
                const r = host.getBoundingClientRect();
                from = { x: e.clientX, y: e.clientY, w: r.width, ratio: r.width / r.height || 16 / 9 };
                host.setAttribute('data-sticky-resizing', '');
            });
            on(h, 'pointermove', (e) => {
                if (id !== e.pointerId) return;
                // Pencere dışındaki koordinatlar güvenilmez (Firefox) — yok sayılır.
                if (e.clientX < 0 || e.clientY < 0 || e.clientX > innerWidth || e.clientY > innerHeight) return;
                // Ekrana yapışık köşe sabit kalır; dışa çekmek büyütür, hangi eksende çok çekildiyse o sayılır (oran korunur).
                const anchor = dock.corner();
                const sx = anchor.endsWith('r') ? -1 : 1;
                const sy = anchor.startsWith('b') ? -1 : 1;
                const dx = (e.clientX - from.x) * sx;
                const dy = (e.clientY - from.y) * sy * from.ratio;
                setWidth(from.w + (Math.abs(dx) >= Math.abs(dy) ? dx : dy));
            });
            const stop = (e: PointerEvent): void => {
                if (id !== e.pointerId) return;
                id = null;
                host.removeAttribute('data-sticky-resizing');
                const w = Math.round(host.getBoundingClientRect().width);
                dock.setWidth(w);
                save(WIDTH_KEY, String(w));
            };
            on(h, 'pointerup', stop);
            on(h, 'pointercancel', stop);
            // Tutamaçtaki tıklama player'a geçmesin.
            on(h, 'click', (e) => e.stopPropagation());
        }
    }

    return () => {
        for (const f of off) f();
        for (const a of ['data-sticky-draggable', 'data-sticky-resizable', 'data-sticky-drag', 'data-sticky-resizing', 'data-sticky-w']) host.removeAttribute(a);
        for (const p of ['--hp-sticky-w', '--hp-sticky-x', '--hp-sticky-y']) host.style.removeProperty(p);
    };
}
