<script setup lang="ts">
import { ref } from 'vue';
import { HopePlayer } from '@hopeplayer/vue';
import type { HopePlayerOptions } from '@hopeplayer/core';

const POSTER = 'https://www.umutyaldiz.com/hopecoreplayer/countdown-cover.jpg';

// Herkese açık örnek yayınlar. Altyazılar public/ altında: VTT dosyası fetch ile okunduğu için aynı origin'den gelmeli.
const SOURCES: Record<'hls' | 'mp4', HopePlayerOptions> = {
    hls: {
        src: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    },
    mp4: {
        src: 'https://www.umutyaldiz.com/hopecoreplayer/sample.mp4',
        subtitles: [
            { src: '/sample.vtt', label: 'Türkçe', srclang: 'tr', default: true },
            { src: '/sample.en.vtt', label: 'English', srclang: 'en' },
        ],
    },
};

const player = ref<InstanceType<typeof HopePlayer> | null>(null);
const source = ref<keyof typeof SOURCES>('hls');
const log = ref<string[]>([]);
const add = (line: string) => {
    log.value = [`${new Date().toLocaleTimeString()}  ${line}`, ...log.value].slice(0, 8);
};
</script>

<template>
    <main>
        <h1>HopeCorePlayer — Vue</h1>
        <p>@hopeplayer/vue ile prop ve emit kullanımı.</p>

        <HopePlayer
            ref="player"
            v-bind="SOURCES[source]"
            :poster="POSTER"
            muted
            theme="glass-dark"
            locale="tr"
            :skip-buttons="{ back: 10, forward: 10 }"
            tap-gestures
            :context-menu="{ stats: true }"
            @ready="add('ready')"
            @play="add('play')"
            @pause="add('pause')"
            @ended="add('ended')"
            @error="(message) => add(`error: ${message}`)"
            @qualitychange="(label) => add(`quality: ${label}`)"
        />

        <div class="row">
            <button type="button" @click="player?.play()">Oynat</button>
            <button type="button" @click="player?.pause()">Duraklat</button>
            <button type="button" @click="player?.getElement()?.toggleStats()">İstatistik</button>
        </div>
        <div class="row">
            <button type="button" :class="{ active: source === 'hls' }" @click="source = 'hls'">HLS</button>
            <button type="button" :class="{ active: source === 'mp4' }" @click="source = 'mp4'">MP4 + altyazı</button>
        </div>

        <div class="log">
            <div v-for="(line, i) in log" :key="i">{{ line }}</div>
        </div>
    </main>
</template>
