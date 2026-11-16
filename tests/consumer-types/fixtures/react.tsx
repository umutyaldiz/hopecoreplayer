import { createRef } from 'react';
import { HopePlayer, type HopePlayerHandle, type HopePlayerProps } from '@hopeplayer/react';

const ref = createRef<HopePlayerHandle>();
export const props: HopePlayerProps = { src: '/video.mp4', onPlay: () => {} };
export const ok = <HopePlayer ref={ref} {...props} onAdStart={(type) => void type.toUpperCase()} />;
// @ts-expect-error bilinmeyen prop
export const bad = <HopePlayer unknownProp={1} />;
void ref.current?.play();
