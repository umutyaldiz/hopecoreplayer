import { Watermark, type WatermarkPlayerContext } from './Watermark';
import type { WatermarkOptions } from '../../types';

export function installWatermark(ctx: WatermarkPlayerContext, options: WatermarkOptions): Watermark {
    return new Watermark(ctx, options);
}

export { Watermark };
export type { WatermarkPlayerContext };
