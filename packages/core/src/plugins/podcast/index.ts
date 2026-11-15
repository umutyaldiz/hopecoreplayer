import { registerLocaleStrings } from '../../i18n';
import { strings } from './strings';
import { Podcast, normalizePeaks, type PodcastPlayerContext } from './Podcast';
import type { PodcastOptions } from '../../types';

registerLocaleStrings(strings);

export function installPodcast(ctx: PodcastPlayerContext, options: PodcastOptions): Podcast {
    return new Podcast(ctx, options);
}

export { Podcast, normalizePeaks };
export type { PodcastPlayerContext };
