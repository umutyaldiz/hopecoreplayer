import { HopeStory, type StoryPlayerContext } from './HopeStory';
import type { StoryOptions } from '../../types';

export function installStory(ctx: StoryPlayerContext, options: StoryOptions): HopeStory {
    return new HopeStory(ctx, options);
}

export { HopeStory };
export type { StoryPlayerContext };
