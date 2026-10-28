import { PlaylistRunner, type PlaylistPlayerContext } from './PlaylistRunner';
import type { PlaylistOptions } from '../../types';

export function installPlaylist(ctx: PlaylistPlayerContext, options: PlaylistOptions): PlaylistRunner {
    return new PlaylistRunner(ctx, options);
}

export { PlaylistRunner };
export type { PlaylistPlayerContext };
