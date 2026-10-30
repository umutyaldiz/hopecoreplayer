import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent, WebViewProps } from 'react-native-webview';
import type { HopePlayerOptions } from '@hopeplayer/core';
import { buildPlayerHtml, commandScript, type HopeBridgeCommand, type HopeBridgeMessage } from './playerHtml';

export interface HopePlayerTimeUpdate {
    currentTime: number;
    /** Canlı yayında ya da süre henüz bilinmiyorsa null. */
    duration: number | null;
    paused: boolean;
}

/**
 * `<hope-player>`'ı bir WebView içinde çalıştırır — React sarmalayıcısıyla aynı seçenekler ve callback'ler.
 * Seçenekler JSON'a çevrilebilir olmalı: fonksiyonlar (ör. `hls.config.xhrSetup`) WebView'a taşınamaz.
 */
export interface HopePlayerProps extends HopePlayerOptions {
    /** Player kutusu — 16:9 için `{ width: '100%', aspectRatio: 16 / 9 }`. */
    style?: StyleProp<ViewStyle>;
    /** @hopeplayer/core ESM giriş dosyası. Varsayılan: jsDelivr, bu paketle aynı sürüm. Kendi sunucunuzdan sunmak için verin. */
    coreUrl?: string;
    /** WebView sayfasının adresi — göreli medya/altyazı yolları buna göre çözülür, localStorage bu origin'de tutulur. */
    baseUrl?: string;
    /** Player yüklenene kadar görünen arka plan. Varsayılan #000. */
    backgroundColor?: string;
    /**
     * WebView sayfasına eklenen CSS: webde global stylesheet'e yazılan `--hp-*` token'ları ve
     * `hope-player::part(...)` kuralları buraya. Değişince sayfa yeniden yüklenir.
     */
    css?: string;
    /** WebView'a ek prop'lar (ör. `onShouldStartLoadWithRequest`). */
    webViewProps?: Omit<WebViewProps, 'source' | 'onMessage' | 'style' | 'containerStyle'>;
    onReady?: () => void;
    onPlay?: () => void;
    onPause?: () => void;
    onEnded?: () => void;
    onError?: (message: string) => void;
    onTimeUpdate?: (time: HopePlayerTimeUpdate) => void;
    onQualityChange?: (label: string) => void;
    onRateChange?: (rate: number) => void;
    onAdStart?: (type: 'preroll' | 'midroll' | 'postroll') => void;
    onAdEnd?: (type: 'preroll' | 'midroll' | 'postroll') => void;
    onAdError?: (message: string) => void;
    onItemChange?: (index: number, source: 'playlist' | 'story') => void;
    /** Köprüden gelen her olay (ham) — yukarıdaki callback'lerde olmayanlar için. */
    onEvent?: (type: string, data: unknown) => void;
}

export interface HopePlayerHandle {
    play(): void;
    pause(): void;
    /** Saniye cinsinden konuma git. */
    seek(time: number): void;
    setMuted(muted: boolean): void;
    /** Teknik istatistik paneli (`force`: true aç, false kapat). */
    toggleStats(force?: boolean): void;
}

const NATIVE_PROP_KEYS = [
    'style',
    'coreUrl',
    'baseUrl',
    'backgroundColor',
    'css',
    'webViewProps',
    'onReady',
    'onPlay',
    'onPause',
    'onEnded',
    'onError',
    'onTimeUpdate',
    'onQualityChange',
    'onRateChange',
    'onAdStart',
    'onAdEnd',
    'onAdError',
    'onItemChange',
    'onEvent',
] as const;

function splitProps(props: HopePlayerProps): HopePlayerOptions {
    const options: Record<string, unknown> = { ...props };
    for (const key of NATIVE_PROP_KEYS) delete options[key];
    return options as HopePlayerOptions;
}

export const HopePlayer = forwardRef<HopePlayerHandle, HopePlayerProps>(function HopePlayer(props, ref) {
    // react-native-webview `WebView<P = undefined>` — varsayılan P ile prop tipi `never`'a düşüyor (React 19 tiplerinde
    // ref verilince hata); açık `object` generic'i bunu önler.
    const webViewRef = useRef<WebView<object>>(null);
    const optionsJson = JSON.stringify(splitProps(props));
    // En güncel seçenekler / sayfaya son giden seçenekler. Sayfa yalnızca coreUrl/arka plan/css değişince yeniden
    // kurulur; seçenek değişiklikleri yeniden yüklemeden komutla gider.
    const latestOptions = useRef(optionsJson);
    latestOptions.current = optionsJson;
    const sentOptions = useRef(optionsJson);
    const ready = useRef(false);
    const callbacks = useRef(props);
    callbacks.current = props;

    const html = useMemo(() => {
        ready.current = false;
        sentOptions.current = latestOptions.current;
        return buildPlayerHtml({
            options: JSON.parse(latestOptions.current) as HopePlayerOptions,
            coreUrl: props.coreUrl,
            backgroundColor: props.backgroundColor,
            css: props.css,
        });
    }, [props.coreUrl, props.backgroundColor, props.css]);

    const send = useCallback((cmd: HopeBridgeCommand) => {
        webViewRef.current?.injectJavaScript(commandScript(cmd));
    }, []);

    const syncOptions = useCallback(() => {
        if (!ready.current || latestOptions.current === sentOptions.current) return;
        sentOptions.current = latestOptions.current;
        send({ type: 'options', options: JSON.parse(latestOptions.current) as HopePlayerOptions });
    }, [send]);

    useEffect(syncOptions, [optionsJson, syncOptions]);

    useImperativeHandle(
        ref,
        () => ({
            play: () => send({ type: 'play' }),
            pause: () => send({ type: 'pause' }),
            seek: (time) => send({ type: 'seek', time }),
            setMuted: (value) => send({ type: 'muted', value }),
            toggleStats: (force) => send({ type: 'toggleStats', force }),
        }),
        [send]
    );

    const onMessage = useCallback(
        (event: WebViewMessageEvent) => {
            let msg: HopeBridgeMessage;
            try {
                msg = JSON.parse(event.nativeEvent.data) as HopeBridgeMessage;
            } catch {
                return;
            }
            if (!msg || msg.__hope !== 1) return;
            const cb = callbacks.current;
            const data = (msg.data ?? {}) as Record<string, unknown>;
            switch (msg.type) {
                case 'ready':
                    ready.current = true;
                    // Sayfa kurulurken seçenekler değiştiyse son hâlini gönder.
                    syncOptions();
                    cb.onReady?.();
                    break;
                case 'play':
                    cb.onPlay?.();
                    break;
                case 'pause':
                    cb.onPause?.();
                    break;
                case 'ended':
                    cb.onEnded?.();
                    break;
                case 'error':
                    cb.onError?.(String(data.message ?? 'error'));
                    break;
                case 'timeupdate':
                    cb.onTimeUpdate?.(data as unknown as HopePlayerTimeUpdate);
                    break;
                case 'qualitychange':
                    cb.onQualityChange?.(String(data.label));
                    break;
                case 'ratechange':
                    cb.onRateChange?.(Number(data.rate));
                    break;
                case 'adstart':
                    cb.onAdStart?.(data.type as 'preroll' | 'midroll' | 'postroll');
                    break;
                case 'adend':
                    cb.onAdEnd?.(data.type as 'preroll' | 'midroll' | 'postroll');
                    break;
                case 'aderror':
                    cb.onAdError?.(String(data.message));
                    break;
                case 'itemchange':
                    cb.onItemChange?.(Number(data.index), data.source as 'playlist' | 'story');
                    break;
            }
            cb.onEvent?.(msg.type, msg.data);
        },
        [syncOptions]
    );

    return (
        <WebView<object>
            ref={webViewRef}
            originWhitelist={['*']}
            source={{ html, baseUrl: props.baseUrl }}
            onMessage={onMessage}
            javaScriptEnabled
            domStorageEnabled
            // iOS: video sayfa içinde oynasın (tam ekrana zorlanmasın); otomatik oynatma muted iken çalışsın.
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            allowsPictureInPictureMediaPlayback
            // Android: player'ın tam ekran butonu için.
            allowsFullscreenVideo
            scrollEnabled={false}
            bounces={false}
            overScrollMode="never"
            {...props.webViewProps}
            // Kutu boyutu WebView'ın dış sarmalayıcısına verilir. Sarmalayıcı varsayılan olarak `flex: 1` olduğundan
            // boş alanı doldurmak için uzuyordu; `aspectRatio` içteki WebView'a gidince genişlik bu uzamış yükseklikten
            // hesaplanıyor, player ekrandan taşıp sağdan kesiliyordu. `flex: 0` + kullanıcının style'ı, WebView da kutuyu doldurur.
            containerStyle={[{ flex: 0, backgroundColor: props.backgroundColor ?? '#000' }, props.style]}
            style={{ flex: 1, backgroundColor: props.backgroundColor ?? '#000' }}
        />
    );
});
