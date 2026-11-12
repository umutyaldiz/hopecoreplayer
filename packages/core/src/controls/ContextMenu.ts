export interface ContextMenuItem {
    label: string;
    /** Sağda soluk yazı (ör. sürüm). */
    meta?: string;
    /** Verilmezse satır yalnızca bilgi (tıklanmaz). */
    onSelect?: () => void;
}

/** Player'a sağ tıklayınca açılan menü — tarayıcının kendi menüsünün yerine (options.contextMenu). */
export class ContextMenu {
    readonly el: HTMLDivElement;
    private open = false;

    constructor(private readonly container: HTMLElement) {
        this.el = document.createElement('div');
        this.el.className = 'hp-context-menu';
        this.el.setAttribute('part', 'context-menu');
        this.el.setAttribute('role', 'menu');
        // Menünün kendi içindeki sağ tık da tarayıcı menüsünü açmasın.
        this.el.addEventListener('contextmenu', (e) => e.preventDefault());
        container.appendChild(this.el);
    }

    get isOpen(): boolean {
        return this.open;
    }

    /** `clientX/Y` ekran koordinatı — menü player'ın içinde kalacak şekilde kaydırılır. */
    show(clientX: number, clientY: number, items: ContextMenuItem[]): void {
        this.el.replaceChildren(
            ...items.map((item) => {
                const row = document.createElement(item.onSelect ? 'button' : 'div');
                row.className = 'hp-context-menu-item';
                if (item.onSelect) {
                    (row as HTMLButtonElement).type = 'button';
                    row.setAttribute('role', 'menuitem');
                    row.addEventListener('click', () => {
                        this.close();
                        item.onSelect!();
                    });
                } else {
                    row.setAttribute('data-info', '');
                }
                const label = document.createElement('span');
                label.textContent = item.label;
                row.appendChild(label);
                if (item.meta) {
                    const meta = document.createElement('span');
                    meta.className = 'hp-context-menu-meta';
                    meta.textContent = item.meta;
                    row.appendChild(meta);
                }
                return row;
            })
        );
        this.el.setAttribute('data-open', '');
        this.open = true;

        const area = this.container.getBoundingClientRect();
        const { width, height } = this.el.getBoundingClientRect();
        const x = Math.max(4, Math.min(clientX - area.left, area.width - width - 4));
        const y = Math.max(4, Math.min(clientY - area.top, area.height - height - 4));
        this.el.style.left = `${x}px`;
        this.el.style.top = `${y}px`;
        this.el.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });

        // Menünün o anki belgesi (Document PiP penceresinde olabilir).
        const doc = (this.doc = this.el.ownerDocument);
        const win = doc.defaultView ?? window;
        doc.addEventListener('pointerdown', this.onOutside, true);
        doc.addEventListener('keydown', this.onKeyDown, true);
        win.addEventListener('blur', this.close);
        win.addEventListener('resize', this.close);
        win.addEventListener('scroll', this.close, true);
    }

    private doc: Document = document;

    readonly close = (): void => {
        if (!this.open) return;
        this.open = false;
        this.el.removeAttribute('data-open');
        const win = this.doc.defaultView ?? window;
        this.doc.removeEventListener('pointerdown', this.onOutside, true);
        this.doc.removeEventListener('keydown', this.onKeyDown, true);
        win.removeEventListener('blur', this.close);
        win.removeEventListener('resize', this.close);
        win.removeEventListener('scroll', this.close, true);
    };

    private readonly onOutside = (e: PointerEvent): void => {
        if (!e.composedPath().includes(this.el)) this.close();
    };

    private readonly onKeyDown = (e: KeyboardEvent): void => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        this.close();
    };

    destroy(): void {
        this.close();
        this.el.remove();
    }
}
