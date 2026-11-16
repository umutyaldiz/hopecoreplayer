// react-native ve react-native-webview repoda kurulu değil; yayınlanan .d.ts'lerin kullandığı yüzey (packages/react-native/src/shims.d.ts ile aynı).
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
