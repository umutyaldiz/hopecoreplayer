<script setup lang="ts">
// <hope-player> için ince Vue sarmalayıcı: prop'ları `.options`'a yazar, `hp:*` event'lerini emit'lere çevirir.
// class/style Vue'nun fallthrough attribute'larıyla köke geçer. Core `onMounted` içinde dinamik import edilir —
// statik import `HTMLElement` olmayan SSR'da (Nuxt) çöker.
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import type { HopePlayerElement as HopePlayerEl, HopePlayerEventMap, HopePlayerOptions, StickyCorner } from '@hopeplayer/core';

const props = defineProps<HopePlayerOptions>();

const emit = defineEmits<{
    ready: [];
    play: [];
    pause: [];
    ended: [];
    error: [message: string];
    qualitychange: [label: string];
    ratechange: [rate: number];
    adstart: [type: 'preroll' | 'midroll' | 'postroll'];
    adend: [type: 'preroll' | 'midroll' | 'postroll'];
    aderror: [message: string];
    itemchange: [index: number, source: 'playlist' | 'story'];
    sticky: [sticky: boolean, corner: StickyCorner | undefined];
}>();

const elRef = ref<HopePlayerEl | null>(null);
let cancelled = false;
let listeners: Array<[keyof HopePlayerEventMap, EventListener]> = [];

onMounted(() => {
    const el = elRef.value;
    if (!el) return;

    // Dinleyiciler import'u beklemeden eklenir: core yüklenince customElements.define() elementi senkron upgrade
    // edip hp:ready'yi .then()'den ÖNCE dispatch ediyor — beklenirse @ready kaçırılır.
    listeners = [
        ['hp:ready', () => emit('ready')],
        ['hp:play', () => emit('play')],
        ['hp:pause', () => emit('pause')],
        ['hp:ended', () => emit('ended')],
        ['hp:error', (e) => emit('error', (e as CustomEvent<{ message: string }>).detail.message)],
        ['hp:qualitychange', (e) => emit('qualitychange', (e as CustomEvent<{ label: string }>).detail.label)],
        ['hp:ratechange', (e) => emit('ratechange', (e as CustomEvent<{ rate: number }>).detail.rate)],
        ['hp:adstart', (e) => emit('adstart', (e as CustomEvent<{ type: 'preroll' | 'midroll' | 'postroll' }>).detail.type)],
        ['hp:adend', (e) => emit('adend', (e as CustomEvent<{ type: 'preroll' | 'midroll' | 'postroll' }>).detail.type)],
        ['hp:aderror', (e) => emit('aderror', (e as CustomEvent<{ message: string }>).detail.message)],
        [
            'hp:itemchange',
            (e) => {
                const detail = (e as CustomEvent<{ index: number; source: 'playlist' | 'story' }>).detail;
                emit('itemchange', detail.index, detail.source);
            },
        ],
        [
            'hp:sticky',
            (e) => {
                const detail = (e as CustomEvent<{ sticky: boolean; corner?: StickyCorner }>).detail;
                emit('sticky', detail.sticky, detail.corner);
            },
        ],
    ];
    for (const [name, handler] of listeners) el.addEventListener(name, handler);

    // .options için import'u bekle: element upgrade olmadan yazmak prototip accessor'ını kalıcı olarak maskeler.
    import('@hopeplayer/core').then(() => {
        if (cancelled || !elRef.value) return;
        elRef.value.options = { ...props } as HopePlayerOptions;
    });
});

// Tüm prop'lar tek bir string olarak izlenir (prop başına ayrı watcher gerekmez).
watch(
    () => JSON.stringify(props),
    () => {
        if (elRef.value) elRef.value.options = { ...props } as HopePlayerOptions;
    }
);

onBeforeUnmount(() => {
    cancelled = true;
    const el = elRef.value;
    if (el) for (const [name, handler] of listeners) el.removeEventListener(name, handler);
});

function play(): Promise<void> {
    return elRef.value?.play() ?? Promise.resolve();
}

function pause(): void {
    elRef.value?.pause();
}

function getElement(): HopePlayerEl | null {
    return elRef.value;
}

defineExpose({ play, pause, getElement });
</script>

<template>
    <hope-player ref="elRef" />
</template>
