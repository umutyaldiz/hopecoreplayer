import { QrResume, type QrResumePlayerContext } from './QrResume';
import type { QrResumeOptions } from '../../types';

export function installQrResume(ctx: QrResumePlayerContext, options: QrResumeOptions): QrResume {
    return new QrResume(ctx, options);
}

export { QrResume };
export type { QrResumePlayerContext };
