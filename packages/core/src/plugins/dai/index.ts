import { DaiController, type DaiPlayerContext } from './DaiController';
import type { DaiOptions } from '../../types';

export async function installDai(ctx: DaiPlayerContext, options: DaiOptions): Promise<DaiController> {
    const controller = new DaiController(ctx, options);
    await controller.install();
    return controller;
}

export { DaiController };
export type { DaiPlayerContext };
