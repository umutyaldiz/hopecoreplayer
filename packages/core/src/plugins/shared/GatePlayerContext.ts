/** countdown-screen / geo-checker gibi "içerikten önce koşul" plugin'lerinin ortak context'i. */
import type { HopeLocaleStrings } from '../../i18n/types';

export interface GatePlayerContext {
    videoEl: HTMLVideoElement;
    overlayContainerEl: HTMLElement;
    blockChrome(): void;
    unblockChrome(): void;
    i18n: HopeLocaleStrings;
}
