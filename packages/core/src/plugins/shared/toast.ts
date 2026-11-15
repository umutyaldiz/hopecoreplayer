const toasts = new WeakMap<HTMLElement, { el: HTMLDivElement; timer: ReturnType<typeof setTimeout> | null }>();

/** Video alanının altında kısa bildirim (stil: .hp-plugin-toast, ana CSS'te). */
export function showToast(container: HTMLElement, message: string, durationMs = 2500): void {
    let t = toasts.get(container);
    if (!t || !t.el.isConnected) {
        const el = document.createElement('div');
        el.className = 'hp-plugin-toast';
        el.setAttribute('part', 'plugin-toast');
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        container.appendChild(el);
        t = { el, timer: null };
        toasts.set(container, t);
    }
    const entry = t;
    entry.el.textContent = message;
    entry.el.setAttribute('data-visible', '');
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => entry.el.removeAttribute('data-visible'), Math.max(500, durationMs));
}
