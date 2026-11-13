// Sesli betimleme test dosyaları (ffmpeg gerekir):
//  public/hls-ad/      — video + iki ses izi; ikincisi CHARACTERISTICS="public.accessibility.describes-video" (HLS betimleme izi)
//  public/ad-narration.m4a — ayrı anlatım dosyası (videoyla eş zamanlı, orijinal sesin üstüne karışır)
// Betimleme sesi bip'lerle ayırt edilir (2., 5. ve 8. saniyede).
// Kullanım: node apps/playground/scripts/make-audio-description.mjs
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pub = resolve(here, '../public');
const input = join(pub, 'sample.mp4');
const out = join(pub, 'hls-ad');
const run = (args) => {
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status ?? 1);
};
// 2., 5., 8. saniyede 0.6 sn'lik bip.
const beeps = "sine=f=880:d=10,volume='if(between(mod(t,3),2,2.6),0.5,0)':eval=frame";

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
run([
    '-i', input,
    '-f', 'lavfi', '-i', beeps,
    '-filter_complex', '[0:a]asplit=2[a0][a1];[a1][1:a]amix=inputs=2:normalize=0[ad]',
    '-map', '0:v', '-map', '[a0]', '-map', '[ad]',
    '-t', '10',
    '-c:v', 'libx264', '-preset', 'veryfast', '-vf', 'scale=-2:240', '-b:v', '250k', '-force_key_frames', 'expr:gte(t,n_forced*2)',
    '-c:a', 'aac', '-b:a', '64k', '-ac', '2',
    '-f', 'hls', '-hls_time', '2', '-hls_playlist_type', 'vod',
    '-var_stream_map', 'v:0,agroup:aud,name:video a:0,agroup:aud,language:tr,name:main,default:yes a:1,agroup:aud,language:tr,name:desc',
    '-master_pl_name', 'master.m3u8',
    '-hls_segment_filename', join(out, '%v_%02d.ts'),
    join(out, '%v.m3u8'),
]);

// Betimleme izi: ad + CHARACTERISTICS (ffmpeg yazmıyor).
const master = join(out, 'master.m3u8');
const text = readFileSync(master, 'utf8')
    .split(/\r?\n/)
    .map((l) => {
        if (!l.startsWith('#EXT-X-MEDIA:TYPE=AUDIO')) return l;
        if (l.includes('URI="desc.m3u8"'))
            return l.replace(/NAME="[^"]*"/, 'NAME="Türkçe (betimleme)"') + ',CHARACTERISTICS="public.accessibility.describes-video"';
        return l.replace(/NAME="[^"]*"/, 'NAME="Türkçe"');
    })
    .join('\n');
writeFileSync(master, text);

// Ayrı anlatım dosyası: yalnızca bip'ler (orijinal ses yok).
run(['-f', 'lavfi', '-i', beeps, '-t', '10', '-c:a', 'aac', '-b:a', '48k', join(pub, 'ad-narration.m4a')]);
console.log('✓ hls-ad/ ve ad-narration.m4a');
