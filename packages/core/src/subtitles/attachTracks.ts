import type { HopeSubtitleOption } from '../types';

export interface AttachedTrack {
    label: string;
    track: TextTrack;
}

/** Altyazıları native <track> olarak ekler; mode 'hidden' — cue'lar akar ama tarayıcı çizmez (CaptionRenderer çizer). */
export function attachSubtitleTracks(video: HTMLVideoElement, subtitles: HopeSubtitleOption[]): AttachedTrack[] {
    video.querySelectorAll('track').forEach((t) => t.remove());

    const attached: AttachedTrack[] = [];
    for (const sub of subtitles) {
        const trackEl = document.createElement('track');
        trackEl.kind = 'subtitles';
        trackEl.src = sub.src;
        trackEl.srclang = sub.srclang;
        trackEl.label = sub.label;
        video.appendChild(trackEl);
        if (trackEl.track) {
            trackEl.track.mode = sub.default ? 'hidden' : 'disabled';
            attached.push({ label: sub.label, track: trackEl.track });
        }
    }
    return attached;
}

/** Yalnızca seçilen track'i 'hidden' yapar, diğerlerini kapatır (null = hepsini kapat). */
export function selectSubtitleTrack(tracks: AttachedTrack[], label: string | null): TextTrack | null {
    let active: TextTrack | null = null;
    for (const { label: trackLabel, track } of tracks) {
        const isActive = trackLabel === label;
        track.mode = isActive ? 'hidden' : 'disabled';
        if (isActive) active = track;
    }
    return active;
}
