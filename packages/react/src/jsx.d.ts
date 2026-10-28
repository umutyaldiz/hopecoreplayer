import type { DetailedHTMLProps, HTMLAttributes } from 'react';
import type { HopePlayerElement } from '@hopeplayer/core';

// <hope-player> custom element'ini TSX için JSX.IntrinsicElements'a tanıtır.
declare global {
    namespace JSX {
        interface IntrinsicElements {
            'hope-player': DetailedHTMLProps<HTMLAttributes<HopePlayerElement>, HopePlayerElement>;
        }
    }
}

export {};
