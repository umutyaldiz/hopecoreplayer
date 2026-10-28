# @hopeplayer/react

A thin React wrapper around [`<hope-player>`](https://www.npmjs.com/package/@hopeplayer/core) (`@hopeplayer/core`). It keeps no state of its own — every prop is written straight to the element's `.options`, and `hp:*` custom events are bridged to `onReady`/`onPlay`/`onAdStart`/... callback props.

Full docs, live demos, and the options/theming/plugin reference: **[umutyaldiz.com/hopecoreplayer](https://umutyaldiz.com/hopecoreplayer)**

Safe with Next.js App Router: `@hopeplayer/core` is only dynamically imported inside a `useEffect` after mount, so nothing breaks in the server render chain.

## Install

```bash
npm install @hopeplayer/core @hopeplayer/react
```

```tsx
import { HopePlayer, type HopePlayerHandle } from '@hopeplayer/react';
import { useRef } from 'react';

const ref = useRef<HopePlayerHandle>(null);

<HopePlayer
    ref={ref}
    src="/video.mp4"
    locale="en"
    onPlay={() => console.log('playing')}
    onAdStart={(type) => console.log('ad', type)}
/>;

ref.current?.play();
```

## License

MIT © [Umut Yaldız](https://www.umutyaldiz.com)
