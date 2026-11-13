// Çoklu kamera test yayınları: aynı videodan 4 "kamera" (HLS VOD). Görüntüye kamera adı ve etkinlik saniyesi basılır;
// kameralar farklı anda başlar ve EXT-X-PROGRAM-DATE-TIME ile hizalanır (kamera 4'te etiket yok → `offset` testi).
// Kullanım: node apps/playground/scripts/make-multiview.mjs [hedef klasör]   (ffmpeg gerekir)
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const input = resolve(here, '../public/sample-30s.mp4');
const outDir = resolve(process.argv[2] ?? resolve(here, '../public/multiview'));
const END = 24; // etkinlik süresi (sn)
const T0 = Date.parse('2026-01-01T12:00:00.000Z');
const FONT = "fontfile='C\\:/Windows/Fonts/arialbd.ttf'";

const cams = [
    { id: 'cam1', label: 'KAMERA 1', start: 0, pdt: true, vf: '' },
    { id: 'cam2', label: 'KAMERA 2', start: 2, pdt: true, vf: 'hflip,crop=iw/1.4:ih/1.4,' },
    { id: 'cam3', label: 'KAMERA 3', start: 1, pdt: true, vf: 'hue=s=0,' },
    { id: 'cam4', label: 'KAMERA 4', start: 3, pdt: false, vf: 'crop=iw/1.6:ih/1.6:0:0,' },
];

rmSync(outDir, { recursive: true, force: true });
for (const cam of cams) {
    const dir = join(outDir, cam.id);
    mkdirSync(dir, { recursive: true });
    const text = `drawtext=${process.platform === 'win32' ? FONT + ':' : ''}text='${cam.label}  %{eif\\:t+${cam.start}\\:d} sn':x=10:y=10:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=5`;
    const args = [
        '-v', 'error', '-y',
        '-ss', String(cam.start), '-t', String(END - cam.start), '-i', input,
        '-vf', `${cam.vf}scale=-2:216,${text}`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '180k', '-maxrate', '220k', '-bufsize', '440k',
        '-force_key_frames', 'expr:gte(t,n_forced*2)',
        // Anahtar kare yalnızca segment başında (sahne geçişinde ek kare yok) + her anahtar karede SPS/PPS — HLS için
        // önerilen ayar. Bunlar olmadan Linux WebKit (GStreamer) tampon dışına sarmada çözme hatası (kod 3) veriyordu.
        '-sc_threshold', '0', '-profile:v', 'main', '-x264-params', 'repeat-headers=1',
        '-c:a', 'aac', '-b:a', '48k', '-ac', '1',
        '-f', 'hls', '-hls_time', '2', '-hls_playlist_type', 'vod',
        '-hls_segment_filename', join(dir, 'seg%02d.ts'),
        join(dir, 'index.m3u8'),
    ];
    const r = spawnSync('ffmpeg', args, { stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status ?? 1);
    // Önizleme posteri (küçük ekranlar / mobil).
    const p = spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(cam.start + 1), '-i', input, '-vf', `${cam.vf}scale=-2:144`, '-frames:v', '1', '-q:v', '6', join(dir, 'poster.jpg')], { stdio: 'inherit' });
    if (p.status !== 0) process.exit(p.status ?? 1);

    // Her segmentin önüne gerçek saat: etkinlik başlangıcı + kameranın başlama anı + önceki segmentler.
    if (cam.pdt) {
        const file = join(dir, 'index.m3u8');
        let t = T0 + cam.start * 1000;
        const lines = readFileSync(file, 'utf8').split(/\r?\n/);
        const out = [];
        for (const line of lines) {
            const m = /^#EXTINF:([\d.]+)/.exec(line);
            if (m) {
                out.push(`#EXT-X-PROGRAM-DATE-TIME:${new Date(t).toISOString()}`);
                t += Number(m[1]) * 1000;
            }
            out.push(line);
        }
        writeFileSync(file, out.join('\n'));
    }
    console.log(`✓ ${cam.id} (başlangıç ${cam.start} sn${cam.pdt ? ', PROGRAM-DATE-TIME' : ', etiketsiz'})`);
}
