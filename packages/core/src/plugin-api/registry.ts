// Ana pakette: tanımlama ve sayfa geneli kayıt. Çalıştıran PluginHost ayrı (tembel) parçada.
import type { HopePlugin, PluginEntry, PluginLoader } from './types';

/** Eklenti tanımlar (tip yardımcısı + ad denetimi). */
export function definePlugin<O = unknown>(plugin: HopePlugin<O>): HopePlugin<O> {
    if (!plugin || typeof plugin.name !== 'string' || !/^[\w.:-]+$/.test(plugin.name)) {
        throw new TypeError('definePlugin: "name" is required (letters, digits, "-", "_", ".", ":")');
    }
    if (typeof plugin.setup !== 'function') throw new TypeError(`definePlugin(${plugin.name}): "setup" must be a function`);
    return plugin;
}

const globalEntries: Array<[HopePlugin<any> | PluginLoader, unknown]> = [];
const listeners = new Set<() => void>();

/** Eklentiyi sayfadaki tüm player'lara ekler; player'ın kendi aynı adlı eklentisi kazanır. */
export function registerPlugin<O>(plugin: HopePlugin<O> | PluginLoader, options?: O): () => void {
    const entry: [HopePlugin<any> | PluginLoader, unknown] = [plugin, options];
    globalEntries.push(entry);
    notify();
    return () => {
        const i = globalEntries.indexOf(entry);
        if (i >= 0) {
            globalEntries.splice(i, 1);
            notify();
        }
    };
}

/** @internal */
export function globalPluginEntries(): PluginEntry[] {
    return globalEntries.slice();
}

/** @internal */
export function onGlobalPluginsChange(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function notify(): void {
    for (const l of listeners) {
        try {
            l();
        } catch {
            /* yok say */
        }
    }
}
