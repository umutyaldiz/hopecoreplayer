/** <i class="hp-icon hp-icon-NAME"> oluşturur — font yüklemesi theme/icons/hope-icons.css'de. */
export function createIcon(name: string, extraClass = ''): HTMLElement {
    const el = document.createElement('i');
    el.className = `hp-icon hp-icon-${name}${extraClass ? ` ${extraClass}` : ''}`;
    el.setAttribute('aria-hidden', 'true');
    return el;
}

/** Var olan bir <i class="hp-icon ..."> elementinin glyph'ini değiştirir (hp-icon-X -> hp-icon-Y). */
export function setIconName(el: HTMLElement, name: string): void {
    el.className = el.className.replace(/hp-icon-[\w-]+/, `hp-icon-${name}`);
}
