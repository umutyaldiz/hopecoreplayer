import type { Component } from 'vue';
import { HopePlayer } from '@hopeplayer/vue';

export const component: Component = HopePlayer;
// @ts-expect-error bir Vue bileşeni, sayı değil
export const notNumber: number = HopePlayer;
