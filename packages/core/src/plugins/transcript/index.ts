import { registerLocaleStrings } from '../../i18n';
import { strings } from './strings';
import { Transcript, type TranscriptPlayerContext } from './Transcript';
import type { TranscriptOptions } from '../../types';

registerLocaleStrings(strings);

export function installTranscript(ctx: TranscriptPlayerContext, options: TranscriptOptions): Transcript {
    return new Transcript(ctx, options);
}

export { Transcript };
export type { TranscriptPlayerContext };
