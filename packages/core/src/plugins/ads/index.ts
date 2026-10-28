import { AdsController, type AdsPlayerContext } from './AdsController';
import type { AdsOptions } from '../../types';

/** Reklam plugin'inin giriş noktası — yalnızca options.ads doluyken dinamik import edilir. */
export async function installAds(ctx: AdsPlayerContext, options: AdsOptions): Promise<AdsController> {
    const controller = new AdsController(ctx, options);
    await controller.install();
    return controller;
}

export { AdsController };
export type { AdsPlayerContext };
