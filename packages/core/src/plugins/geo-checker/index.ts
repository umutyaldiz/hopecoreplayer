import { GeoChecker } from './GeoChecker';
import type { GatePlayerContext } from '../shared/GatePlayerContext';
import type { GeoCheckerOptions } from '../../types';

export function installGeoChecker(ctx: GatePlayerContext, options: GeoCheckerOptions): GeoChecker {
    return new GeoChecker(ctx, options);
}

export { GeoChecker };
export type { GatePlayerContext };
