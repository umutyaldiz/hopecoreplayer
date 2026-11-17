import { registerLocaleStrings } from '../../i18n';
import { strings } from './strings';
import { AgeGate, type AgeGateContext } from './AgeGate';
import type { AgeGateOptions } from '../../types';

registerLocaleStrings(strings);

export function installAgeGate(ctx: AgeGateContext, options: boolean | AgeGateOptions): AgeGate {
    return new AgeGate(ctx, options === true ? {} : options || {});
}

export { AgeGate, ageFrom, ageGroupOf } from './AgeGate';
export type { AgeGateContext };
