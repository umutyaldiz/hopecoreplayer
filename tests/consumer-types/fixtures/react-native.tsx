import { createRef } from 'react';
import { HopePlayer, NATIVE_METHODS, type HopePlayerHandle, type HopeNativeMethod } from '@hopeplayer/react-native';
import { buildPlayerHtml } from '@hopeplayer/react-native/player-html';

const ref = createRef<HopePlayerHandle>();
export const ok = <HopePlayer ref={ref} src="/video.m3u8" onTimeUpdate={({ currentTime }) => void currentTime.toFixed()} />;
// @ts-expect-error bilinmeyen prop
export const bad = <HopePlayer unknownProp={1} />;
export const method: HopeNativeMethod = NATIVE_METHODS[0];
export const html: string = buildPlayerHtml({ options: { src: '/video.mp4' } });
