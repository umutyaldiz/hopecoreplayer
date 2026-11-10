import { SkipSegments, type SkipSegmentsPlayerContext } from './SkipSegments';
import type { SkipSegment } from '../../types';
import type { HopeLocaleStrings } from '../../i18n/types';
import { definePlugin } from '../../plugin-api/registry';

export function installSkipSegments(ctx: SkipSegmentsPlayerContext, segments: SkipSegment[]): SkipSegments {
    return new SkipSegments(ctx, segments);
}

/** "İntroyu atla", herkese açık eklenti API'si üzerinden. */
export const skipSegmentsPlugin = definePlugin<SkipSegment[]>({
    name: 'hope:skip-segments',
    setup(player, segments) {
        const layer = player.ui.addLayer({ position: 'fill' });
        const skip = new SkipSegments(
            {
                hostEl: player.element,
                videoEl: player.video,
                overlayContainerEl: layer.el,
                isAdActive: () => player.isAdPlaying,
                i18n: player.labels as unknown as HopeLocaleStrings,
            },
            segments
        );
        player.onLocaleChange(() => skip.refreshLabels());
        return () => skip.destroy();
    },
});

export { SkipSegments };
export type { SkipSegmentsPlayerContext };
