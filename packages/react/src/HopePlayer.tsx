/// <reference path="./jsx.d.ts" />
// "use client" burada değil: bundler kaynak direktifini atıp uyarı veriyor — vite.config.ts banner'ı çıktının ilk satırına ekliyor.

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { CSSProperties } from 'react';
import type {
    HopePlayerElement as HopePlayerEl,
    HopePlayerEventMap,
    HopePlayerOptions,
    StickyCorner,
} from '@hopeplayer/core';

export interface HopePlayerProps extends HopePlayerOptions {
    className?: string;
    style?: CSSProperties;
    onReady?: () => void;
    onPlay?: () => void;
    onPause?: () => void;
    onEnded?: () => void;
    onError?: (message: string) => void;
    onQualityChange?: (label: string) => void;
    onRateChange?: (rate: number) => void;
    onAdStart?: (type: 'preroll' | 'midroll' | 'postroll') => void;
    onAdEnd?: (type: 'preroll' | 'midroll' | 'postroll') => void;
    onAdError?: (message: string) => void;
    onItemChange?: (index: number, source: 'playlist' | 'story') => void;
    onSticky?: (sticky: boolean, corner?: StickyCorner) => void;
    /** Kaynak grubu düştü, sıradakine geçildi (bkz. `sourcePriority`). */
    onSourceFallback?: (detail: HopePlayerEventMap['hp:sourcefallback']['detail']) => void;
    /** `options.analytics` açıkken her izlenme olayı. */
    onAnalytics?: (detail: HopePlayerEventMap['hp:analytics']['detail']) => void;
}

export interface HopePlayerHandle {
    play(): Promise<void>;
    pause(): void;
    /** Çekirdeğin kendi API'sine (settings menü, plugin instance'ları vb.) doğrudan erişim için kaçış kapısı. */
    getElement(): HopePlayerEl | null;
}

/**
 * <hope-player> için ince React sarmalayıcı: prop'ları `.options`'a yazar, `hp:*` event'lerini callback'lere çevirir.
 * Core `useEffect` içinde dinamik import edilir — statik import `HTMLElement` olmayan SSR'da (Next.js) çöker.
 */
export const HopePlayer = forwardRef<HopePlayerHandle, HopePlayerProps>(function HopePlayer(
    {
        className,
        style,
        onReady,
        onPlay,
        onPause,
        onEnded,
        onError,
        onQualityChange,
        onRateChange,
        onAdStart,
        onAdEnd,
        onAdError,
        onItemChange,
        onSticky,
        onSourceFallback,
        onAnalytics,
        ...options
    },
    ref
) {
    const elRef = useRef<HopePlayerEl | null>(null);

    useEffect(() => {
        let cancelled = false;
        // Her seferinde import'u bekle: element upgrade olmadan .options yazmak prototip accessor'ını kalıcı olarak maskeler.
        import('@hopeplayer/core').then(() => {
            if (cancelled) return;
            const el = elRef.current;
            if (el) el.options = options as HopePlayerOptions;
        });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [JSON.stringify(options)]);

    useEffect(() => {
        const el = elRef.current;
        if (!el) return;

        const listeners: Array<[keyof HopePlayerEventMap, EventListener]> = [];
        if (onReady) listeners.push(['hp:ready', () => onReady()]);
        if (onPlay) listeners.push(['hp:play', () => onPlay()]);
        if (onPause) listeners.push(['hp:pause', () => onPause()]);
        if (onEnded) listeners.push(['hp:ended', () => onEnded()]);
        if (onError) {
            listeners.push(['hp:error', (e) => onError((e as CustomEvent<{ message: string }>).detail.message)]);
        }
        if (onQualityChange) {
            listeners.push([
                'hp:qualitychange',
                (e) => onQualityChange((e as CustomEvent<{ label: string }>).detail.label),
            ]);
        }
        if (onRateChange) {
            listeners.push(['hp:ratechange', (e) => onRateChange((e as CustomEvent<{ rate: number }>).detail.rate)]);
        }
        if (onAdStart) {
            listeners.push([
                'hp:adstart',
                (e) => onAdStart((e as CustomEvent<{ type: 'preroll' | 'midroll' | 'postroll' }>).detail.type),
            ]);
        }
        if (onAdEnd) {
            listeners.push([
                'hp:adend',
                (e) => onAdEnd((e as CustomEvent<{ type: 'preroll' | 'midroll' | 'postroll' }>).detail.type),
            ]);
        }
        if (onAdError) {
            listeners.push(['hp:aderror', (e) => onAdError((e as CustomEvent<{ message: string }>).detail.message)]);
        }
        if (onItemChange) {
            listeners.push([
                'hp:itemchange',
                (e) => {
                    const detail = (e as CustomEvent<{ index: number; source: 'playlist' | 'story' }>).detail;
                    onItemChange(detail.index, detail.source);
                },
            ]);
        }
        if (onSticky) {
            listeners.push([
                'hp:sticky',
                (e) => {
                    const detail = (e as CustomEvent<{ sticky: boolean; corner?: StickyCorner }>).detail;
                    onSticky(detail.sticky, detail.corner);
                },
            ]);
        }

        if (onSourceFallback) {
            listeners.push(['hp:sourcefallback', (e) => onSourceFallback((e as HopePlayerEventMap['hp:sourcefallback']).detail)]);
        }
        if (onAnalytics) listeners.push(['hp:analytics', (e) => onAnalytics((e as HopePlayerEventMap['hp:analytics']).detail)]);

        for (const [name, handler] of listeners) el.addEventListener(name, handler);
        return () => {
            for (const [name, handler] of listeners) el.removeEventListener(name, handler);
        };
    }, [
        onReady,
        onPlay,
        onPause,
        onEnded,
        onError,
        onQualityChange,
        onRateChange,
        onAdStart,
        onAdEnd,
        onAdError,
        onItemChange,
        onSticky,
        onSourceFallback,
        onAnalytics,
    ]);

    useImperativeHandle(
        ref,
        () => ({
            play: () => elRef.current?.play() ?? Promise.resolve(),
            pause: () => elRef.current?.pause(),
            getElement: () => elRef.current,
        }),
        []
    );

    return <hope-player ref={elRef} className={className} style={style} />;
});
