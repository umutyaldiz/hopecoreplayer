// Tipler `any`a düşerse @ts-expect-error satırları "kullanılmıyor" hatası verir — test bunu yakalar.
import { definePlugin, HOPE_PLAYER_VERSION, HopePlayerElement, type HopePlayerOptions, type HopePlugin } from '@hopeplayer/core';

// @ts-expect-error sınıf bir symbol değildir
export const probe: symbol = HopePlayerElement;
// @ts-expect-error bilinmeyen seçenek
export const bad: HopePlayerOptions = { unknownOption: 123 };
export const good: HopePlayerOptions = { src: '/video.mp4', muted: true, privacy: { default: 'deny' } };
export const version: string = HOPE_PLAYER_VERSION;

export const plugin: HopePlugin<{ src: string }> = definePlugin<{ src: string }>({
    name: 'consumer-test',
    setup(player, options) {
        const src: string = options.src;
        // @ts-expect-error options.src bir string
        const n: number = options.src;
        void player.privacy;
        void src;
        void n;
    },
});

const el = document.createElement('hope-player');
el.options = good;
// @ts-expect-error HTMLElementTagNameMap['hope-player'] gerçek eleman tipi
const notNumber: number = el;
void notNumber;
document.querySelector('hope-player')?.setPrivacy({ analytics: false });
