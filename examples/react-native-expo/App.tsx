import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { HopePlayer, type HopePlayerHandle } from '@hopeplayer/react-native';

// Herkese açık, CORS izinli örnek yayınlar.
const SOURCES = {
    hls: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    mp4: 'https://www.umutyaldiz.com/hopecoreplayer/sample.mp4',
};

export default function App() {
    const player = useRef<HopePlayerHandle>(null);
    const [source, setSource] = useState<keyof typeof SOURCES>('hls');
    const [time, setTime] = useState({ currentTime: 0, duration: null as number | null });
    const [log, setLog] = useState<string[]>([]);
    const add = (line: string) => setLog((l) => [line, ...l].slice(0, 8));

    return (
        <SafeAreaProvider>
            <SafeAreaView style={styles.screen}>
                <StatusBar style="light" />
                <HopePlayer
                    ref={player}
                    style={styles.player}
                    src={SOURCES[source]}
                    muted
                    theme="glass-dark"
                    locale="tr"
                    skipButtons={{ back: 10, forward: 10 }}
                    tapGestures
                    contextMenu={{ stats: true }}
                    subtitles={
                        source === 'mp4'
                            ? [{ src: 'https://www.umutyaldiz.com/hopecoreplayer/sample.vtt', label: 'Türkçe', srclang: 'tr', default: true }]
                            : undefined
                    }
                    onReady={() => add('ready')}
                    onPlay={() => add('play')}
                    onPause={() => add('pause')}
                    onEnded={() => add('ended')}
                    onError={(message) => add(`error: ${message}`)}
                    onQualityChange={(label) => add(`quality: ${label}`)}
                    onTimeUpdate={setTime}
                />

                <View style={styles.row}>
                    <Button label="Oynat" onPress={() => player.current?.play()} />
                    <Button label="Duraklat" onPress={() => player.current?.pause()} />
                    <Button label="+10 sn" onPress={() => player.current?.seek(time.currentTime + 10)} />
                    <Button label="İstatistik" onPress={() => player.current?.toggleStats()} />
                </View>
                <View style={styles.row}>
                    <Button label="HLS" active={source === 'hls'} onPress={() => setSource('hls')} />
                    <Button label="MP4 + altyazı" active={source === 'mp4'} onPress={() => setSource('mp4')} />
                </View>

                <Text style={styles.time}>
                    {time.currentTime.toFixed(1)} sn / {time.duration != null ? `${time.duration.toFixed(1)} sn` : 'canlı'}
                </Text>
                <ScrollView style={styles.log}>
                    {log.map((line, i) => (
                        <Text key={i} style={styles.logLine}>
                            {line}
                        </Text>
                    ))}
                </ScrollView>
            </SafeAreaView>
        </SafeAreaProvider>
    );
}

function Button({ label, onPress, active }: { label: string; onPress: () => void; active?: boolean }) {
    return (
        <Pressable onPress={onPress} style={[styles.button, active && styles.buttonActive]}>
            <Text style={[styles.buttonText, active && styles.buttonTextActive]}>{label}</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: '#0b0b0f' },
    player: { width: '100%', aspectRatio: 16 / 9 },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, paddingTop: 12 },
    button: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: '#1d1d24' },
    buttonActive: { backgroundColor: '#5ee08a' },
    buttonText: { color: '#eee', fontWeight: '600' },
    buttonTextActive: { color: '#0b0b0f' },
    time: { color: '#aaa', paddingHorizontal: 12, paddingTop: 12, fontVariant: ['tabular-nums'] },
    log: { flex: 1, paddingHorizontal: 12, paddingTop: 8 },
    logLine: { color: '#888', fontSize: 12, fontFamily: 'Menlo' },
});
