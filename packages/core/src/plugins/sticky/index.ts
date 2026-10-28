import { stickyManager, type StickyPlayerContext, type StickyUnregister } from './StickyManager';
import type { StickyOptions } from '../../types';

/** Dönen fonksiyon unregister/cleanup — HopePlayerElement.disconnectedCallback'te çağrılmalı. `refreshLabels()` da taşır (dil değişince close butonu için). */
export function installSticky(ctx: StickyPlayerContext, options: StickyOptions): StickyUnregister {
    return stickyManager.register(ctx, options);
}

export type { StickyPlayerContext, StickyUnregister };
