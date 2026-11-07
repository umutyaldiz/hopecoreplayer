import { Accessibility, type AccessibilityPlayerContext } from './Accessibility';
import type { AccessibilityOptions } from '../../types';

export function installAccessibility(ctx: AccessibilityPlayerContext, options: AccessibilityOptions): Accessibility {
    return new Accessibility(ctx, options);
}

export { Accessibility };
export type { AccessibilityPlayerContext };
