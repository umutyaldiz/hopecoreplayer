import { Heatmap, type HeatmapPlayerContext } from './Heatmap';
import type { HeatmapOptions } from '../../types';

export function installHeatmap(ctx: HeatmapPlayerContext, options: HeatmapOptions): Heatmap {
    return new Heatmap(ctx, options);
}

export { Heatmap };
export type { HeatmapPlayerContext };
