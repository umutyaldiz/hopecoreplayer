import type { RedirectScreenOptions } from '../../types';
import type { HopeLocaleStrings } from '../../i18n/types';

export interface RedirectScreenPlayerContext {
    videoEl: HTMLVideoElement;
    overlayContainerEl: HTMLElement;
    isAdActive(): boolean;
    i18n: HopeLocaleStrings;
}

/** İçerik bitince "N saniye içinde sıradaki video" ekranı; postroll sırasında gösterilmez. */
export class RedirectScreen {
    private counterTimer: ReturnType<typeof setInterval> | null = null;
    private wrapper: HTMLElement | null = null;

    constructor(
        private readonly ctx: RedirectScreenPlayerContext,
        private readonly options: RedirectScreenOptions
    ) {
        if (options.enabled === false) return;
        ctx.videoEl.addEventListener('ended', this.onEnded);
        ctx.videoEl.addEventListener('play', this.onPlay);
    }

    /** Ekran her gösterimde sıfırdan oluşturuluyor (`create()`) ve güncel `ctx.i18n`'i okuyor — burada tazelenecek kalıcı bir etiket yok, diğer plugin'lerle TUTARLI bir çağrı yüzeyi için var. */
    refreshLabels(): void {
        /* no-op */
    }

    destroy(): void {
        this.ctx.videoEl.removeEventListener('ended', this.onEnded);
        this.ctx.videoEl.removeEventListener('play', this.onPlay);
        this.remove();
    }

    private readonly onPlay = (): void => {
        this.remove();
    };

    private readonly onEnded = (): void => {
        if (this.ctx.isAdActive()) return;
        this.create();
    };

    private remove(): void {
        if (this.counterTimer) {
            clearInterval(this.counterTimer);
            this.counterTimer = null;
        }
        this.wrapper?.remove();
        this.wrapper = null;
    }

    private create(): void {
        this.remove();

        const wrapper = document.createElement('div');
        wrapper.setAttribute('part', 'redirect-screen');
        wrapper.className = 'hp:absolute hp:inset-0 hp:z-30 hp:flex hp:flex-col hp:items-center hp:justify-center hp:gap-3 hp:bg-black/85 hp:text-white hp:text-center hp:p-4';

        if (this.options.image) {
            const img = document.createElement('img');
            img.src = this.options.image;
            img.className = 'hp:max-w-[50%] hp:rounded-lg';
            wrapper.appendChild(img);
        }

        if (this.options.title) {
            const title = document.createElement('div');
            title.className = 'hp:text-base hp:font-semibold';
            title.textContent = this.options.title;
            wrapper.appendChild(title);
        }

        const counter = document.createElement('div');
        counter.className = 'hp:text-sm hp:opacity-80';
        wrapper.appendChild(counter);

        const buttons = document.createElement('div');
        buttons.className = 'hp:flex hp:gap-2 hp:mt-2';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.textContent = this.ctx.i18n.redirectCancel;
        cancelBtn.className = 'hp:px-4 hp:py-1.5 hp:rounded hp:bg-white/15 hp:text-white hp:border-0 hp:cursor-pointer hp:text-sm';

        const acceptBtn = document.createElement('button');
        acceptBtn.type = 'button';
        acceptBtn.textContent = this.ctx.i18n.redirectPlayNow;
        acceptBtn.className = 'hp:px-4 hp:py-1.5 hp:rounded hp:bg-accent hp:text-on-accent hp:border-0 hp:cursor-pointer hp:text-sm';
        acceptBtn.addEventListener('click', () => {
            window.location.href = this.options.url;
        });

        buttons.append(cancelBtn, acceptBtn);
        wrapper.appendChild(buttons);

        this.ctx.overlayContainerEl.appendChild(wrapper);
        this.wrapper = wrapper;

        let remaining = this.options.time;
        const render = () => {
            counter.textContent = this.ctx.i18n.redirectCountdown(remaining);
        };
        render();

        this.counterTimer = setInterval(() => {
            remaining--;
            if (remaining >= 0) {
                render();
            } else {
                if (this.counterTimer) clearInterval(this.counterTimer);
                counter.textContent = this.ctx.i18n.redirectNowPlaying;
                window.location.href = this.options.url;
            }
        }, 1000);

        cancelBtn.addEventListener('click', () => {
            this.remove();
            const suggestions = this.options.suggestions || [];
            if (suggestions.length) this.showSuggestions(suggestions);
        });
    }

    private showSuggestions(items: NonNullable<RedirectScreenOptions['suggestions']>): void {
        const wrapper = document.createElement('div');
        wrapper.setAttribute('part', 'redirect-suggestions');
        wrapper.className = 'hp:absolute hp:inset-0 hp:z-30 hp:grid hp:grid-cols-2 hp:gap-2 hp:p-3 hp:overflow-y-auto hp:bg-black/85';

        for (const item of items) {
            const box = document.createElement('a');
            box.href = item.url;
            box.className = 'hp:relative hp:block hp:rounded-lg hp:overflow-hidden hp:text-white hp:no-underline';
            box.innerHTML = `<img src="${item.image}" class="hp:w-full hp:aspect-video hp:object-cover" />
                <div class="hp:absolute hp:inset-x-0 hp:bottom-0 hp:bg-gradient-to-t hp:from-black/80 hp:to-transparent hp:p-2 hp:text-xs">${item.title}</div>`;
            wrapper.appendChild(box);
        }

        this.ctx.overlayContainerEl.appendChild(wrapper);
        this.wrapper = wrapper;
    }
}
