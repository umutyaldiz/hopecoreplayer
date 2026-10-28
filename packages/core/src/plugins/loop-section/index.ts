import { LoopSection, type LoopSeekBarMarkers } from './LoopSection';
import type { LoopSectionOptions } from '../../types';
import type { HopeLocaleStrings } from '../../i18n/types';

export interface LoopSectionPlayerContext {
    videoEl: HTMLVideoElement;
    seekBarEl: HTMLElement;
    markers: LoopSeekBarMarkers;
    addControlButton(label: string, iconName: string, onClick: () => void): { btn: HTMLButtonElement; icon: HTMLElement };
    i18n: HopeLocaleStrings;
}

/** Döngü motorunu kurar: kontrol çubuğuna toggle butonu, seek bar'da orta-tık ile A → B → kapat. */
export function installLoopSection(ctx: LoopSectionPlayerContext, options: LoopSectionOptions): LoopSection {
    const engine = new LoopSection(ctx.videoEl, ctx.markers, options);

    const { btn } = ctx.addControlButton(ctx.i18n.loop, 'loop', () => {
        engine.toggle();
        refresh();
    });

    const refresh = (): void => {
        btn.classList.toggle('hp:text-accent', engine.active);
    };

    engine.refreshLabels = () => {
        btn.setAttribute('aria-label', ctx.i18n.loop);
    };

    const onSeekBarMiddleClick = (e: MouseEvent): void => {
        if (e.button !== 1) return;
        e.preventDefault();

        const rect = ctx.seekBarEl.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        const duration = ctx.videoEl.duration;
        const clickTime = Number.isFinite(duration) ? ratio * duration : undefined;

        const state = engine.getState();
        if (state.active) engine.disable();
        else if (state.loopStart === null) engine.setStart(clickTime);
        else engine.setEnd(clickTime);

        refresh();
    };
    ctx.seekBarEl.addEventListener('mousedown', onSeekBarMiddleClick);

    const originalDestroy = engine.destroy.bind(engine);
    engine.destroy = () => {
        ctx.seekBarEl.removeEventListener('mousedown', onSeekBarMiddleClick);
        originalDestroy();
    };

    return engine;
}

export { LoopSection };
export type { LoopSeekBarMarkers };
