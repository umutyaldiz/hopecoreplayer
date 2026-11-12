/** Eklenti CSS'ini elemanın kökündeki shadow root'a bir kez ekler — stiller ana pakete girmez. */
export function adoptStyle(el: Node, id: string, css: string): void {
    const root = el.getRootNode() as ShadowRoot | Document;
    // instanceof ShadowRoot başka pencerede (Document PiP) yanlış döner — host ile ayırt edilir.
    const parent: ParentNode | null = 'host' in root ? root : (root as Document).head;
    if (!parent || parent.querySelector(`style[data-hp-style="${id}"]`)) return;
    const style = (el.ownerDocument ?? document).createElement('style');
    style.setAttribute('data-hp-style', id);
    style.textContent = css;
    parent.appendChild(style);
}

/** `from` kökündeki eklenti stillerinden `to`'da olmayanları kopyalar (Document PiP penceresine gidiş / dönüş). */
export function copyAdoptedStyles(from: ParentNode, to: ParentNode): void {
    for (const style of Array.from(from.querySelectorAll('style[data-hp-style]'))) {
        const id = style.getAttribute('data-hp-style')!;
        if (!to.querySelector(`style[data-hp-style="${id}"]`)) to.appendChild(style.cloneNode(true));
    }
}
