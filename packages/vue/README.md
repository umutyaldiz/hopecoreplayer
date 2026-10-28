# @hopeplayer/vue

A thin Vue 3 wrapper around [`<hope-player>`](https://www.npmjs.com/package/@hopeplayer/core) (`@hopeplayer/core`) — the same architecture as [`@hopeplayer/react`](https://www.npmjs.com/package/@hopeplayer/react): dynamic import after mount, a prop/event bridge, and `defineExpose({ play, pause, getElement })` for imperative access.

Full docs, live demos, and the options/theming/plugin reference: **[umutyaldiz.com/hopecoreplayer](https://umutyaldiz.com/hopecoreplayer)**

## Install

```bash
npm install @hopeplayer/core @hopeplayer/vue
```

```vue
<script setup lang="ts">
import { useTemplateRef } from 'vue';
import { HopePlayer } from '@hopeplayer/vue';

const playerRef = useTemplateRef<InstanceType<typeof HopePlayer>>('player');
</script>

<template>
    <HopePlayer
        ref="player"
        src="/video.mp4"
        locale="en"
        @play="() => console.log('playing')"
        @adstart="(type) => console.log('ad', type)"
    />
</template>

<!-- playerRef.value?.play() -->
```

## License

MIT © [Umut Yaldız](https://www.umutyaldiz.com)
