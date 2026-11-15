/** <i class="hp-icon hp-icon-NAME"> oluşturur — font yüklemesi theme/icons/hope-icons.css'de. */
export function createIcon(name: string, extraClass = ''): HTMLElement {
    const el = document.createElement('i');
    // '<svg…': eklenti parçalarının kendi sabit SVG'leri (ana fonta girmesin diye) — dış girdi değil.
    const svg = name.startsWith('<svg');
    el.className = `hp-icon ${svg ? 'hp-icon-svg' : `hp-icon-${name}`}${extraClass ? ` ${extraClass}` : ''}`;
    el.setAttribute('aria-hidden', 'true');
    if (svg) el.innerHTML = name;
    return el;
}

/** Var olan bir <i class="hp-icon ..."> elementinin glyph'ini değiştirir (hp-icon-X -> hp-icon-Y). */
export function setIconName(el: HTMLElement, name: string): void {
    el.className = el.className.replace(/hp-icon-[\w-]+/, `hp-icon-${name}`);
}
