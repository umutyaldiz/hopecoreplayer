import { AudioStage, type AudioStageContext } from './AudioStage';
import type { AudioOptions } from '../../types';

/** Ses modu sahnesini kurar (kapak, plak, scratch, sistem medya kontrolleri). */
export function installAudioStage(ctx: AudioStageContext, options: AudioOptions): AudioStage {
    const stage = new AudioStage(ctx);
    stage.update(options);
    return stage;
}

export { AudioStage };
export type { AudioStageContext };
