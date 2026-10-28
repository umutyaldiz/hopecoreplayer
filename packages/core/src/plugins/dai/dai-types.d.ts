/** Google IMA DAI SDK için minimal ambient tipler. */
declare namespace google.ima.dai.api {
    class StreamManager {
        constructor(videoEl: HTMLMediaElement, adUiEl?: Element);
        requestStream(request: LiveStreamRequest): void;
        addEventListener(type: string | string[], listener: (event: StreamEvent) => void): void;
        removeEventListener(type: string | string[], listener: (event: StreamEvent) => void): void;
        processMetadata(type: string, payload: Uint8Array | string, timestamp?: number): void;
        reset(): void;
        onTimedMetadata?(metadata: unknown): void;
    }

    class LiveStreamRequest {
        assetKey: string;
        apiKey?: string;
        adTagParameters?: Record<string, string>;
    }

    interface StreamData {
        streamId: string;
        url: string;
        subtitles?: unknown[];
    }

    class StreamEvent {
        static Type: {
            LOADED: string;
            ERROR: string;
            AD_BREAK_STARTED: string;
            AD_BREAK_ENDED: string;
            AD_PERIOD_STARTED: string;
            AD_PERIOD_ENDED: string;
            CUEPOINTS_CHANGED: string;
            STARTED: string;
            SKIPPABLE_STATE_CHANGED: string;
            CLICK: string;
        };
        type: string;
        getStreamData(): StreamData;
        getAd?(): unknown;
    }
}
