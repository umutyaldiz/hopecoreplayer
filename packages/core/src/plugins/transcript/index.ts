import { Transcript, type TranscriptPlayerContext } from './Transcript';
import type { TranscriptOptions } from '../../types';

export function installTranscript(ctx: TranscriptPlayerContext, options: TranscriptOptions): Transcript {
    return new Transcript(ctx, options);
}

export { Transcript };
export type { TranscriptPlayerContext };
