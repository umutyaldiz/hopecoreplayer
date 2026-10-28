<script setup lang="ts">
import { ref, useTemplateRef } from 'vue';
import { HopePlayer } from '@hopeplayer/vue';
import type { HopeThemePreset } from '@hopeplayer/core';

const THEMES: Array<{ value: HopeThemePreset; label: string }> = [
    { value: 'glass-light', label: 'Glass — açık (varsayılan)' },
    { value: 'glass-dark', label: 'Glass — koyu' },
    { value: 'neo-dark', label: 'Neomorphism — koyu' },
    { value: 'mono', label: 'Mono — düz' },
];

const theme = ref<HopeThemePreset>('glass-light');
const log = ref<string[]>([]);
const playerRef = useTemplateRef<InstanceType<typeof HopePlayer>>('player');

function pushLog(line: string): void {
    log.value = [...log.value.slice(-7), line];
}

function onPlayClick(): void {
    void playerRef.value?.play();
}

function onPauseClick(): void {
    playerRef.value?.pause();
}
</script>

<template>
    <main>
        <h1>HopeCorePlayer × Vue</h1>
        <p class="sub"><code>@hopeplayer/vue</code> ile gerçek kullanım örneği.</p>

        <section>
            <span class="label">Temel oynatma + ref üzerinden imperatif kontrol</span>
            <HopePlayer
                ref="player"
                src="/sample.mp4"
                :subtitles="[{ src: '/sample.vtt', label: 'Türkçe', srclang: 'tr', default: true }]"
                :theme="theme"
                style="width: 100%; aspect-ratio: 16 / 9; display: block; border-radius: 8px"
                @ready="pushLog('hp:ready')"
                @play="pushLog('hp:play')"
                @pause="pushLog('hp:pause')"
                @ended="pushLog('hp:ended')"
                @error="(message) => pushLog(`hp:error — ${message}`)"
            />
            <div style="margin-top: 12px">
                <button type="button" @click="onPlayClick">play()</button>
                <button type="button" @click="onPauseClick">pause()</button>
            </div>
        </section>

        <section>
            <span class="label">Tema preset'i — değişince anında uygulanır</span>
            <select v-model="theme">
                <option v-for="t in THEMES" :key="t.value" :value="t.value">{{ t.label }}</option>
            </select>
        </section>

        <section>
            <span class="label">Oynatma listesi (playlist prop'u)</span>
            <HopePlayer
                src="/sample.mp4"
                :theme="theme"
                style="width: 100%; aspect-ratio: 16 / 9; display: block; border-radius: 8px"
                :playlist="{
                    items: [
                        { title: 'Bölüm 1', spot: 'Giriş', mp4: [{ src: '/sample.mp4', label: 'Oto', selected: true }] },
                        { title: 'Bölüm 2', spot: 'Devam', mp4: [{ src: '/sample.mp4', label: 'Oto', selected: true }] },
                    ],
                    autoplayNext: true,
                    ui: { title: 'Bölümler' },
                }"
                @itemchange="(index, source) => pushLog(`hp:itemchange — ${source}[${index}]`)"
            />
        </section>

        <section>
            <span class="label">Olay günlüğü (hp:* CustomEvent → emit)</span>
            <pre>{{ log.length ? log.join('\n') : '(henüz olay yok — oynatmayı başlatın)' }}</pre>
        </section>
    </main>
</template>
