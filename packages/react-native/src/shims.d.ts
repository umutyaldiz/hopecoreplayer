/**
 * Yalnızca monorepo içinde derlemek için: react-native (React 19 ister) ve react-native-webview'i buraya kurmuyoruz.
 * Tüketici uygulamada gerçek tipler kullanılır — yayınlanan .d.ts'ler bu adlarla gerçek paketlere bağlanır.
 * Kullanılan yüzey gerçek tiplere karşı ayrıca doğrulanıyor (test/verify-types.mjs).
 */
declare module 'react-native' {
    export interface ViewStyle {
        [key: string]: unknown;
    }
    export type StyleProp<T> = T | ReadonlyArray<StyleProp<T>> | false | null | undefined;
}

declare module 'react-native-webview' {
    import type { Component } from 'react';
    import type { StyleProp, ViewStyle } from 'react-native';

    export interface WebViewMessageEvent {
        nativeEvent: { data: string };
    }
    export interface WebViewProps {
        source?: { html: string; baseUrl?: string } | { uri: string };
        onMessage?: (event: WebViewMessageEvent) => void;
        style?: StyleProp<ViewStyle>;
        containerStyle?: StyleProp<ViewStyle>;
        originWhitelist?: string[];
        javaScriptEnabled?: boolean;
        domStorageEnabled?: boolean;
        allowsInlineMediaPlayback?: boolean;
        mediaPlaybackRequiresUserAction?: boolean;
        allowsPictureInPictureMediaPlayback?: boolean;
        allowsFullscreenVideo?: boolean;
        scrollEnabled?: boolean;
        bounces?: boolean;
        overScrollMode?: 'always' | 'content' | 'never';
        [key: string]: unknown;
    }
    export class WebView<P = undefined> extends Component<WebViewProps & P> {
        injectJavaScript(script: string): void;
    }
}
