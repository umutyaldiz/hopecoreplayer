// Applies the JSON options printed by PHP to every <hope-player> on the page.
import '@hopecoreplayer/player';

const apply = (el) => {
	if (el.__hpApplied) return;
	el.__hpApplied = true;
	try {
		el.options = JSON.parse(el.getAttribute('data-hp-options') || '{}');
	} catch (err) {
		console.error('[HopeCorePlayer] invalid options', err);
	}
};

const scan = (root) => root.querySelectorAll?.('hope-player[data-hp-options]').forEach(apply);

customElements.whenDefined('hope-player').then(() => {
	scan(document);
	// Players added later (infinite scroll, AJAX themes).
	new MutationObserver((list) => {
		for (const m of list) {
			for (const node of m.addedNodes) {
				if (node.nodeType !== 1) continue;
				if (node.matches('hope-player[data-hp-options]')) apply(node);
				else scan(node);
			}
		}
	}).observe(document.documentElement, { childList: true, subtree: true });
});
