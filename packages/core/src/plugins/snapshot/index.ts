import type { SnapshotOptions } from '../../types';
import type { HopeLocaleStrings } from '../../i18n/types';
import { registerLocaleStrings } from '../../i18n';
import { adoptStyle } from '../../utils/plugin-style';
import { showToast } from '../shared/toast';
import css from './snapshot.css?inline';

registerLocaleStrings({
    tr: { snapshot: 'Anlık görüntü', snapshotName: 'Dosya adı', snapshotSave: 'İndir', snapshotCancel: 'Vazgeç', snapshotFailed: 'Bu videodan görüntü alınamıyor' },
    en: { snapshot: 'Snapshot', snapshotName: 'File name', snapshotSave: 'Download', snapshotCancel: 'Cancel', snapshotFailed: 'A snapshot cannot be taken from this video' },
});

const CAMERA_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M4 8h3l1.6-2.4h6.8L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.4" fill="none" stroke="currentColor" stroke-width="2"/></svg>';

export interface SnapshotContext {
    hostEl: HTMLElement;
    videoEl: HTMLVideoElement;
    overlayEl: HTMLElement;
    i18n: HopeLocaleStrings;
    addButton(label: string, icon: string, onClick: () => void): { btn: HTMLButtonElement; icon: HTMLElement };
}

/** Dosya adında izin verilmeyen karakterler. */
const BAD = /[\\/:*?"<>|\u0000-\u001f]+/g;

const clean = (name: string): string => name.replace(BAD, '-').replace(/\s+/g, ' ').trim().slice(0, 120);

/** "fragman" + 102 sn → "fragman-01m42s". */
function defaultName(src: string, t: number): string {
    let base = 'video';
    try {
        const last = new URL(src, location.href).pathname.split('/').pop() ?? '';
        base = decodeURIComponent(last).replace(/\.[a-z0-9]+$/i, '') || base;
    } catch {
        /* adres çözülemedi */
    }
    const s = Math.floor(t);
    const hh = Math.floor(s / 3600);
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return clean(`${base}-${hh ? `${hh}h` : ''}${mm}m${ss}s`);
}

/** Anlık görüntü: kare videonun kendi çözünürlüğünde yakalanır, istenirse dosya adı sorulur. */
export class Snapshot {
    private readonly button: HTMLButtonElement;
    private dialog: HTMLElement | null = null;

    constructor(
        private readonly ctx: SnapshotContext,
        private options: SnapshotOptions
    ) {
        adoptStyle(ctx.overlayEl, 'snapshot', css);
        this.button = ctx.addButton(ctx.i18n.snapshot, CAMERA_ICON, () => this.take()).btn;
        this.button.setAttribute('part', 'snapshot-button');
    }

    setOptions(o: SnapshotOptions): void {
        this.options = o;
    }

    /** Kareyi yakalar; dosya adı sorulacaksa pencere açar, yoksa hemen indirir. */
    take(): void {
        const v = this.ctx.videoEl;
        const canvas = document.createElement('canvas');
        try {
            if (v.mediaKeys || !v.videoWidth) throw new Error('no frame');
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            const g = canvas.getContext('2d');
            if (!g) throw new Error('no canvas');
            g.drawImage(v, 0, 0, canvas.width, canvas.height);
            // CORS'suz başka alan adı: tuval kirlenir, okuma hata verir.
            g.getImageData(0, 0, 1, 1);
        } catch {
            showToast(this.ctx.overlayEl, this.ctx.i18n.snapshotFailed, 3000);
            return;
        }
        const name = clean(this.options.fileName ?? '') || defaultName(v.currentSrc, v.currentTime);
        if (this.options.askName === false) this.save(canvas, name);
        else this.ask(canvas, name);
    }

    private get ext(): string {
        return this.options.format === 'jpeg' ? 'jpg' : 'png';
    }

    private save(canvas: HTMLCanvasElement, name: string): void {
        const jpeg = this.options.format === 'jpeg';
        const q = typeof this.options.quality === 'number' ? Math.min(1, Math.max(0.1, this.options.quality)) : 0.95;
        canvas.toBlob(
            (blob) => {
                if (!blob) return showToast(this.ctx.overlayEl, this.ctx.i18n.snapshotFailed, 3000);
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${clean(name) || 'snapshot'}.${this.ext}`;
                a.rel = 'noopener';
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 10000);
                this.ctx.hostEl.dispatchEvent(new CustomEvent('hp:snapshot', { detail: { name: a.download, width: canvas.width, height: canvas.height, time: this.ctx.videoEl.currentTime } }));
            },
            jpeg ? 'image/jpeg' : 'image/png',
            jpeg ? q : undefined
        );
    }

    private ask(canvas: HTMLCanvasElement, name: string): void {
        this.close();
        const t = this.ctx.i18n;
        const box = document.createElement('div');
        box.className = 'hp-snapshot';
        box.setAttribute('part', 'snapshot-dialog');
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-label', t.snapshot);

        const preview = document.createElement('img');
        preview.className = 'hp-snapshot-preview';
        preview.alt = '';
        const thumb = document.createElement('canvas');
        const tw = 320;
        thumb.width = tw;
        thumb.height = Math.round((tw * canvas.height) / canvas.width);
        thumb.getContext('2d')?.drawImage(canvas, 0, 0, thumb.width, thumb.height);
        preview.src = thumb.toDataURL('image/jpeg', 0.8);

        const label = document.createElement('label');
        label.className = 'hp-snapshot-label';
        label.textContent = t.snapshotName;
        const field = document.createElement('div');
        field.className = 'hp-snapshot-field';
        const input = document.createElement('input');
        input.type = 'text';
        input.value = name;
        input.spellcheck = false;
        input.setAttribute('aria-label', t.snapshotName);
        const ext = document.createElement('span');
        ext.textContent = `.${this.ext}`;
        field.append(input, ext);
        label.appendChild(field);

        const size = document.createElement('div');
        size.className = 'hp-snapshot-size';
        size.textContent = `${canvas.width} × ${canvas.height}`;

        const actions = document.createElement('div');
        actions.className = 'hp-snapshot-actions';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = t.snapshotCancel;
        cancel.addEventListener('click', () => this.close());
        const save = document.createElement('button');
        save.type = 'button';
        save.className = 'hp-snapshot-save';
        save.textContent = t.snapshotSave;
        save.addEventListener('click', () => {
            this.save(canvas, input.value);
            this.close();
        });
        actions.append(cancel, save);

        box.append(preview, label, size, actions);
        // Yazarken player kısayolları (boşluk, ok tuşları) çalışmasın.
        box.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Escape') this.close();
            else if (e.key === 'Enter' && e.target === input) save.click();
        });
        for (const type of ['click', 'dblclick', 'pointerdown', 'pointerup']) box.addEventListener(type, (e) => e.stopPropagation());
        this.ctx.overlayEl.appendChild(box);
        this.dialog = box;
        input.focus();
        input.select();
    }

    private close(): void {
        this.dialog?.remove();
        this.dialog = null;
    }

    refreshLabels(): void {
        this.button.setAttribute('aria-label', this.ctx.i18n.snapshot);
    }

    destroy(): void {
        this.close();
        this.button.remove();
    }
}

export function installSnapshot(ctx: SnapshotContext, options: SnapshotOptions): Snapshot {
    return new Snapshot(ctx, options);
}
