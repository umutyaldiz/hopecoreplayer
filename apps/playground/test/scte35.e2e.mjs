// SCTE-35: splice_info_section çözücü (standart test vektörleri), HLS etiketleri (CUE-OUT/IN, CUE-OUT-CONT, OATCLS,
// X-SCTE35, DATERANGE), DASH EventStream (2013:xml, 2014:xml+bin), reklam arası olayları ve SCTE-35 reklamı
// (makrolar, koşullar, canlı uca dönüş).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launchBrowser, only } from './_browser.mjs';

const BASE = `http://localhost:${process.env.HOPE_TEST_PORT ?? 5183}`;
const MOCK_IMA = readFileSync(new URL('./_mock-ima.js', import.meta.url), 'utf8');
const PARSE_URL = `/@fs/${fileURLToPath(new URL('../../../packages/core/src/scte35/parse.ts', import.meta.url)).replace(/\\/g, '/').replace(/^\//, '')}`;
let failures = 0;
const ok = (cond, msg) => {
    if (cond) console.log(`  OK  ${msg}`);
    else {
        console.log(`  FAIL ${msg}`);
        failures++;
    }
};
const near = (a, b, eps = 0.001) => typeof a === 'number' && Math.abs(a - b) < eps;

// SCTE 35 (2019+) Ek 14 örnekleri.
const SPLICE_INSERT = '/DAvAAAAAAAA///wFAVIAACPf+/+c2nALv4AUsz1AAAAAAAKAAhDVUVJAAABNWLbowo=';
const TIME_SIGNAL_34 = '/DA0AAAAAAAA///wBQb+cr0AUAAeAhxDVUVJSAAAjn/PAAGlmbAICAAAAAAsoKGKNAIAmsnRfg==';
const hexOf = (b64) => `0x${Buffer.from(b64, 'base64').toString('hex').toUpperCase()}`;

async function openPage(browser, { ima = false } = {}) {
    const context = await browser.newContext({ viewport: { width: 800, height: 450 } });
    const page = await context.newPage();
    page.__errors = [];
    page.on('pageerror', (e) => page.__errors.push(e.message));
    if (ima) await page.addInitScript(MOCK_IMA);
    await page.goto(`${BASE}/`);
    await page.waitForFunction(() => document.getElementById('player')?.shadowRoot?.querySelector('video'));
    await page.evaluate(() => {
        const el = document.getElementById('player');
        window.__ev = [];
        for (const t of ['hp:scte35', 'hp:adbreakstart', 'hp:adbreakend', 'hp:adstart', 'hp:adend']) el.addEventListener(t, (e) => window.__ev.push({ t, d: e.detail, at: el.shadowRoot.querySelector('video').currentTime }));
    });
    return { context, page };
}
const events = (page, t) => page.evaluate((t) => window.__ev.filter((e) => e.t === t).map((e) => ({ ...e.d, at: e.at, spliceInfo: undefined, signal: undefined })), t);

async function testParser(browser) {
    console.log('\n[1] Çözücü: SCTE 35 test vektörleri, HLS etiketleri, DATERANGE, DASH XML');
    const { context, page } = await openPage(browser);
    const r = await page.evaluate(
        async ({ url, SPLICE_INSERT, TIME_SIGNAL_34, hexIn }) => {
            const p = await import(url);
            const b = (s) => p.decodeBytes(s);
            const si = p.parseSpliceInfo(b(SPLICE_INSERT));
            const ts = p.parseSpliceInfo(b(TIME_SIGNAL_34));
            const broken = b(SPLICE_INSERT);
            broken[20] ^= 0xff;
            const hls = (tag, value) => p.signalFromHlsTag(tag, value, 10);
            const xml = (text) => p.signalFromXmlText(text, { source: 'dash', format: 'event-stream', time: 0 });
            return {
                si,
                ts,
                crcBroken: p.parseSpliceInfo(broken)?.crcValid,
                siSignal: p.signalFromBytes(b(SPLICE_INSERT), { source: 'hls', format: 'oatcls', time: 0 }),
                tsSignal: p.signalFromBytes(b(TIME_SIGNAL_34), { source: 'hls', format: 'oatcls', time: 0 }),
                hex: p.parseSpliceInfo(p.decodeBytes(hexIn))?.command,
                cueOut: hls('EXT-X-CUE-OUT', '30'),
                cueOutAttr: hls('EXT-X-CUE-OUT', 'DURATION=12.5'),
                contSlash: hls('EXT-X-CUE-OUT-CONT', '10/30'),
                contAttr: hls('EXT-X-CUE-OUT-CONT', 'ElapsedTime=5.0,Duration=30,SCTE35=' + SPLICE_INSERT),
                cueIn: hls('EXT-X-CUE-IN', ''),
                oatcls: hls('EXT-OATCLS-SCTE35', SPLICE_INSERT),
                adobeOut: hls('EXT-X-SCTE35', `CUE="${SPLICE_INSERT}",ID="ad1",DURATION=45,CUE-OUT=YES`),
                adobeIn: hls('EXT-X-SCTE35', 'CUE-IN=YES,ID="ad1"'),
                drOut: p.signalFromDateRange({ ID: 'b1', 'START-DATE': '2026-01-01T00:00:00Z', 'PLANNED-DURATION': '20', 'SCTE35-OUT': hexIn }, 3, 2),
                drIn: p.signalFromDateRange({ ID: 'b1', 'SCTE35-IN': hexIn }, 23, 0),
                unknownTag: hls('EXT-X-PROGRAM-DATE-TIME', '2026'),
                xmlInsertOut: xml(
                    '<scte35:SpliceInfoSection xmlns:scte35="http://www.scte.org/schemas/35/2016" ptsAdjustment="0"><scte35:SpliceInsert spliceEventId="77" outOfNetworkIndicator="true" spliceImmediateFlag="true"><scte35:Program/><scte35:BreakDuration autoReturn="true" duration="2700000"/></scte35:SpliceInsert></scte35:SpliceInfoSection>'
                ),
                xmlInsertIn: xml('<SpliceInfoSection><SpliceInsert spliceEventId="77" outOfNetworkIndicator="false"/></SpliceInfoSection>'),
                xmlTimeSignal: xml(
                    '<SpliceInfoSection><TimeSignal><SpliceTime ptsTime="900000"/></TimeSignal><SegmentationDescriptor segmentationEventId="9" segmentationTypeId="54" segmentationDuration="1800000" segmentNum="1" segmentsExpected="1"><SegmentationUpid segmentationUpidType="12">abc</SegmentationUpid></SegmentationDescriptor></SpliceInfoSection>'
                ),
                xmlBinary: xml(`<Signal><Binary>${TIME_SIGNAL_34}</Binary></Signal>`),
                xmlCancel: xml('<SpliceInfoSection><SpliceInsert spliceEventId="77" spliceEventCancelIndicator="true"/></SpliceInfoSection>'),
            };
        },
        { url: PARSE_URL, SPLICE_INSERT, TIME_SIGNAL_34, hexIn: hexOf(SPLICE_INSERT) }
    );
    const si = r.si?.spliceInsert;
    ok(r.si?.command === 'splice_insert' && r.si.crcValid === true, `splice_insert çözüldü, CRC doğru (${r.si?.command}, crc=${r.si?.crcValid})`);
    ok(si?.eventId === 0x4800008f && si.outOfNetwork && si.programSplice && !si.immediate, `splice_event_id 0x4800008F, out_of_network (${si?.eventId?.toString(16)})`);
    ok(near(si?.spliceTime, 21514.559089, 1e-5) && si?.breakDuration?.autoReturn && near(si?.breakDuration?.seconds, 60.293567, 1e-5), `pts_time 21514.559089, break_duration 60.293567 (${si?.spliceTime}, ${si?.breakDuration?.seconds})`);
    ok(r.si?.availId === 0x135, `avail_descriptor provider_avail_id 0x135 (${r.si?.availId})`);
    const d = r.ts?.descriptors?.[0];
    ok(r.ts?.command === 'time_signal' && near(r.ts?.timeSignal?.spliceTime, 21388.766756, 1e-5) && r.ts.crcValid, `time_signal pts_time 21388.766756 (${r.ts?.timeSignal?.spliceTime})`);
    ok(d?.eventId === 0x4800008e && d.typeId === 0x34 && d.type === 'Provider Placement Opportunity Start', `segmentation 0x34 Provider Placement Opportunity Start (${d?.type})`);
    ok(near(d?.duration, 307) && d.upidType === 8 && d.upid === '000000002ca0a18a', `segmentation_duration 307, UPID TI 000000002ca0a18a (${d?.duration}, ${d?.upid})`);
    ok(d?.segmentNum === 2 && d.segmentsExpected === 0 && d.subSegmentNum === undefined, `segment 2/0; descriptor 28 bayt, sub_segment yok (${d?.segmentNum}/${d?.segmentsExpected})`);
    ok(r.crcBroken === false, 'bozuk veride CRC hatası fark edilir');
    ok(r.hex === 'splice_insert', 'hex ("0xFC30…") girdi de çözülür');
    ok(r.siSignal?.action === 'start' && near(r.siSignal.duration, 60.293567, 1e-5) && r.siSignal.id === String(0x4800008f), `splice_insert → start, 60.29 sn (${r.siSignal?.action})`);
    ok(r.tsSignal?.action === 'start' && r.tsSignal.duration === 307 && r.tsSignal.segmentationTypeId === 0x34, `time_signal 0x34 → start, 307 sn (${r.tsSignal?.action})`);
    ok(r.cueOut?.action === 'start' && r.cueOut.duration === 30 && r.cueOut.format === 'cue-out', 'EXT-X-CUE-OUT:30');
    ok(r.cueOutAttr?.duration === 12.5, 'EXT-X-CUE-OUT:DURATION=12.5');
    ok(r.contSlash?.action === 'start' && r.contSlash.elapsed === 10 && r.contSlash.duration === 30, 'EXT-X-CUE-OUT-CONT:10/30 (aranın ortası)');
    ok(r.contAttr?.elapsed === 5 && r.contAttr.duration === 30 && r.contAttr.command === 'splice_insert', 'EXT-X-CUE-OUT-CONT:ElapsedTime=5,Duration=30,SCTE35=…');
    ok(r.cueIn?.action === 'end' && r.cueIn.format === 'cue-in', 'EXT-X-CUE-IN');
    ok(r.oatcls?.action === 'start' && r.oatcls.format === 'oatcls' && near(r.oatcls.duration, 60.293567, 1e-5), 'EXT-OATCLS-SCTE35');
    ok(r.adobeOut?.action === 'start' && r.adobeOut.duration === 45 && r.adobeIn?.action === 'end', 'EXT-X-SCTE35 CUE-OUT=YES / CUE-IN=YES');
    ok(r.drOut?.action === 'start' && r.drOut.id === 'b1' && r.drOut.duration === 20 && r.drOut.elapsed === 2, `DATERANGE SCTE35-OUT (id b1, 20 sn, elapsed 2) (${JSON.stringify({ a: r.drOut?.action, id: r.drOut?.id, d: r.drOut?.duration })})`);
    ok(r.drIn?.action === 'end' && r.drIn.id === 'b1', 'DATERANGE SCTE35-IN → end (içindeki komut OUT olsa da)');
    ok(r.unknownTag === null, 'SCTE dışı etiket yok sayılır');
    ok(r.xmlInsertOut?.action === 'start' && r.xmlInsertOut.duration === 30 && r.xmlInsertOut.id === '77', `DASH XML SpliceInsert out → start 30 sn (${r.xmlInsertOut?.duration})`);
    ok(r.xmlInsertIn?.action === 'end', 'DASH XML SpliceInsert in → end');
    ok(r.xmlTimeSignal?.action === 'start' && r.xmlTimeSignal.duration === 20 && r.xmlTimeSignal.segmentationTypeId === 54 && r.xmlTimeSignal.upid === 'abc', `DASH XML TimeSignal + SegmentationDescriptor 0x36 (${r.xmlTimeSignal?.segmentationType})`);
    ok(r.xmlBinary?.action === 'start' && r.xmlBinary.duration === 307, 'DASH xml+bin Signal/Binary');
    ok(r.xmlCancel?.action === 'cancel', 'iptal (splice_event_cancel_indicator)');
    await context.close();
}

/** Sahte HLS listesi (playground'daki 360p segmentleri: 4 + 4 + 2 sn). */
function playlist(tags) {
    return [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        '#EXT-X-TARGETDURATION:4',
        '#EXT-X-MEDIA-SEQUENCE:0',
        '#EXT-X-PLAYLIST-TYPE:VOD',
        ...(tags.head ?? []),
        ...(tags.s0 ?? []),
        '#EXTINF:4.0,',
        '/hls/360p/seg000.ts',
        ...(tags.s1 ?? []),
        '#EXTINF:4.0,',
        '/hls/360p/seg001.ts',
        ...(tags.s2 ?? []),
        '#EXTINF:2.0,',
        '/hls/360p/seg002.ts',
        '#EXT-X-ENDLIST',
        '',
    ].join('\n');
}

async function playHls(browser, name, tags, { seek, options } = {}) {
    const { context, page } = await openPage(browser);
    await page.route(`**/scte/${name}.m3u8`, (r) => r.fulfill({ status: 200, contentType: 'application/vnd.apple.mpegurl', body: playlist(tags) }));
    await page.evaluate(
        ({ name, options }) => {
            document.getElementById('player').options = { muted: true, scte35: true, src: `/scte/${name}.m3u8`, ...options };
        },
        { name, options }
    );
    // Sayfanın kendi MP4'ü değil: hls.js MSE kaynağını (blob:) bağlayıp veri gelene kadar beklenir.
    await page.waitForFunction(() => { const el = document.getElementById('player'); const v = el.shadowRoot.querySelector('video'); return el.sourceManager.engine.engine === 'hls.js' && v.currentSrc.startsWith('blob:') && v.readyState >= 2; }, null, { timeout: 15000 });
    if (seek) {
        await page.evaluate((t) => (document.getElementById('player').currentTime = t), seek);
        await page.waitForTimeout(300);
    }
    await page.evaluate(() => document.getElementById('player').play());
    await page.waitForFunction(() => document.getElementById('player').ended, null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(300);
    return { context, page };
}

async function testHlsPlayback(browser) {
    console.log('\n[2] HLS (hls.js): oynarken etiketler okunur, reklam arası olayları doğru sırada ve zamanda');
    {
        const { context, page } = await playHls(browser, 'cue', { s1: ['#EXT-X-CUE-OUT:4'], s2: ['#EXT-X-CUE-IN'] });
        const sig = await events(page, 'hp:scte35');
        const start = await events(page, 'hp:adbreakstart');
        const end = await events(page, 'hp:adbreakend');
        ok(sig.map((s) => s.action).join(',') === 'start,end', `hp:scte35 start → end (${sig.map((s) => s.action).join(',')})`);
        ok(start.length === 1 && start[0].remaining === 4 && start[0].at >= 3.5 && start[0].at < 5, `hp:adbreakstart 4. sn'de, kalan 4 (${start[0]?.at?.toFixed(2)} sn)`);
        ok(end.length === 1 && end[0].reason === 'signal' && end[0].at >= 7.5, `hp:adbreakend CUE-IN ile (${end[0]?.reason}, ${end[0]?.at?.toFixed(2)} sn)`);
        ok(page.__errors.length === 0, `sayfa hatası yok (${page.__errors.join(' | ')})`);
        await context.close();
    }
    {
        const { context, page } = await playHls(browser, 'oatcls', { s1: [`#EXT-OATCLS-SCTE35:${SPLICE_INSERT}`, '#EXT-X-CUE-OUT:60.293567'], s2: ['#EXT-X-CUE-IN'] });
        const sig = await events(page, 'hp:scte35');
        const start = await events(page, 'hp:adbreakstart');
        ok(sig.some((s) => s.format === 'oatcls' && s.command === 'splice_insert') && start.length === 1, `OATCLS + CUE-OUT aynı parçada: tek ara (${start.length})`);
        await context.close();
    }
    {
        // Aranın ortasında katılma: CUE-OUT 0. parçada, izleyici yayına 1. parçadan başlıyor (CUE-OUT-CONT; canlıda olduğu gibi).
        const { context, page } = await playHls(browser, 'cont', { s0: ['#EXT-X-CUE-OUT:8'], s1: ['#EXT-X-CUE-OUT-CONT:ElapsedTime=4,Duration=8'], s2: ['#EXT-X-CUE-IN'] }, { options: { hls: { config: { startPosition: 4.2 } } } });
        const start = await events(page, 'hp:adbreakstart');
        ok(start.length === 1 && start[0].remaining === 4 && start[0].duration === 8, `CUE-OUT-CONT: aranın ortasında kalan 4 sn (${JSON.stringify(start[0] && { r: start[0].remaining, d: start[0].duration })})`);
        await context.close();
    }
    {
        // DATERANGE (PROGRAM-DATE-TIME ile): parçanın ortasında (2. sn) başlar, ayrı SCTE35-IN ile (6. sn) biter.
        const { context, page } = await playHls(browser, 'daterange', {
            head: [
                '#EXT-X-PROGRAM-DATE-TIME:2026-01-01T00:00:00.000Z',
                `#EXT-X-DATERANGE:ID="br1",START-DATE="2026-01-01T00:00:02.000Z",PLANNED-DURATION=4,SCTE35-OUT=${hexOf(SPLICE_INSERT)}`,
                `#EXT-X-DATERANGE:ID="br1-in",START-DATE="2026-01-01T00:00:06.000Z",SCTE35-IN=${hexOf(SPLICE_INSERT)}`,
            ],
        });
        const start = await events(page, 'hp:adbreakstart');
        const end = await events(page, 'hp:adbreakend');
        ok(start.length === 1 && start[0].at >= 1.8 && start[0].at < 2.8 && start[0].duration === 4, `DATERANGE başlangıcı 2. sn'de (${start[0]?.at?.toFixed(2)} sn, ${start[0]?.duration} sn)`);
        ok(end.length === 1 && end[0].reason === 'signal' && end[0].at >= 5.8 && end[0].at < 7, `DATERANGE SCTE35-IN 6. sn'de (${end[0]?.at?.toFixed(2)} sn)`);
        await context.close();
    }
    {
        // Bitiş sinyali gelmezse ara süresi dolunca (auto_return) biter.
        const { context, page } = await playHls(browser, 'noin', { s0: ['#EXT-X-CUE-OUT:2'] });
        const end = await events(page, 'hp:adbreakend');
        ok(end.length === 1 && end[0].reason === 'duration', `IN yok: süre dolunca biter (${end[0]?.reason})`);
        await context.close();
    }
    {
        const { context, page } = await playHls(browser, 'off', { s1: ['#EXT-X-CUE-OUT:4'], s2: ['#EXT-X-CUE-IN'] }, { options: { scte35: false } });
        ok((await events(page, 'hp:scte35')).length === 0, 'scte35 kapalıyken sinyal okunmaz');
        const chunks = await page.evaluate(() => performance.getEntriesByType('resource').some((e) => /scte35/.test(e.name)));
        ok(!chunks, 'scte35 kapalıyken parça hiç inmez');
        await context.close();
    }
}

async function testDash(browser) {
    console.log('\n[3] DASH (dash.js): EventStream urn:scte:scte35:2013:xml ve 2014:xml+bin');
    const base = readFileSync(new URL('../public/dash/clear.mpd', import.meta.url), 'utf8');
    const streams = `
        <EventStream schemeIdUri="urn:scte:scte35:2013:xml" timescale="1000">
            <Event presentationTime="2000" duration="3000" id="21">
                <scte35:SpliceInfoSection xmlns:scte35="http://www.scte.org/schemas/35/2016" ptsAdjustment="0">
                    <scte35:SpliceInsert spliceEventId="21" outOfNetworkIndicator="true" spliceImmediateFlag="true"><scte35:Program/><scte35:BreakDuration autoReturn="true" duration="270000"/></scte35:SpliceInsert>
                </scte35:SpliceInfoSection>
            </Event>
            <Event presentationTime="5000" duration="0" id="22">
                <scte35:SpliceInfoSection xmlns:scte35="http://www.scte.org/schemas/35/2016"><scte35:SpliceInsert spliceEventId="21" outOfNetworkIndicator="false" spliceImmediateFlag="true"><scte35:Program/></scte35:SpliceInsert></scte35:SpliceInfoSection>
            </Event>
        </EventStream>
        <EventStream schemeIdUri="urn:scte:scte35:2014:xml+bin" timescale="1000">
            <Event presentationTime="7000" duration="2000" id="23"><scte35:Signal xmlns:scte35="http://www.scte.org/schemas/35/2016"><scte35:Binary>${TIME_SIGNAL_34}</scte35:Binary></scte35:Signal></Event>
        </EventStream>`;
    const mpd = base.replace(/(<Period[^>]*>)/, `$1${streams}`).replace(/(media|initialization)="/g, '$1="/dash/');
    const { context, page } = await openPage(browser);
    await page.route('**/scte/events.mpd', (r) => r.fulfill({ status: 200, contentType: 'application/dash+xml', body: mpd }));
    await page.evaluate(() => (document.getElementById('player').options = { muted: true, scte35: true, src: '/scte/events.mpd' }));
    await page.waitForFunction(() => { const el = document.getElementById('player'); const v = el.shadowRoot.querySelector('video'); return el.sourceManager.engine.engine === 'dash.js' && v.currentSrc.startsWith('blob:') && v.readyState >= 2; }, null, { timeout: 15000 });
    await page.evaluate(() => document.getElementById('player').play());
    await page.waitForFunction(() => window.__ev.filter((e) => e.t === 'hp:scte35').length >= 3, null, { timeout: 15000 }).catch(() => {});
    const sig = await events(page, 'hp:scte35');
    const start = await events(page, 'hp:adbreakstart');
    const end = await events(page, 'hp:adbreakend');
    ok(sig.length === 3 && sig.every((s) => s.source === 'dash' && s.format === 'event-stream'), `3 DASH sinyali (${sig.map((s) => `${s.action}@${s.time}`).join(', ')})`);
    ok(sig[0]?.action === 'start' && sig[0].duration === 3 && sig[0].id === '21' && sig[1]?.action === 'end', 'XML SpliceInsert out (3 sn) → in');
    ok(sig[2]?.command === 'time_signal' && sig[2].segmentationTypeId === 0x34, 'xml+bin time_signal 0x34');
    ok(start.length === 2 && end.length >= 1 && end[0].reason === 'signal', `iki ara: ilki IN ile bitti (${start.length} başlangıç, ${end.map((e) => e.reason).join(',')})`);
    ok(page.__errors.length === 0, `sayfa hatası yok (${page.__errors.join(' | ')})`);
    await context.close();
}

/** Canlı yayın taklidi: süre Infinity, seekable 0–120. */
async function fakeLive(page, currentTime) {
    await page.evaluate((t) => {
        const v = document.getElementById('player').shadowRoot.querySelector('video');
        Object.defineProperty(v, 'duration', { value: Infinity, configurable: true });
        Object.defineProperty(v, 'seekable', { value: { length: 1, start: () => 0, end: () => 120 }, configurable: true });
        Object.defineProperty(v, 'currentTime', { value: t, writable: true, configurable: true });
        Object.defineProperty(v, 'paused', { get: () => !!window.__pausedFlag, configurable: true });
        v.pause = () => (window.__pausedFlag = true);
        v.play = () => ((window.__pausedFlag = false), Promise.resolve());
        window.__pausedFlag = false;
    }, currentTime);
}

async function testAds(browser) {
    console.log('\n[4] SCTE-35 reklamı: makrolar, koşullar, reklam bitince canlı uca dönüş / geride kalma, ara bitince kesme');
    const open = async (live) => {
        const { context, page } = await openPage(browser, { ima: true });
        await page.evaluate((live) => {
            document.getElementById('player').options = { muted: true, src: '/sample.mp4', ads: { live: { adTagLive: 'https://example.com/vast/live?d=[break_duration]&ms=[break_duration_ms]&id=[break_id]&n=[break_num]', ...live } } };
        }, live ?? {});
        await page.waitForFunction(() => window.__mockIma.adsLoaderInstances.length > 0, null, { timeout: 8000 });
        return { context, page };
    };
    const brk = (page, type, detail) => page.evaluate(({ type, detail }) => document.getElementById('player').dispatchEvent(new CustomEvent(type, { detail })), { type, detail });
    const requests = (page) => page.evaluate(() => window.__adsLog.filter((e) => e.ev === 'requestAds').map((e) => e.adTagUrl));
    const startAd = (page) =>
        page.evaluate(() => {
            const loader = window.__mockIma.adsLoaderInstances[0];
            const mgr = new window.google.ima.AdsManager();
            window.__mockIma.adsManagerInstances.push(mgr);
            loader.dispatch('adsManagerLoaded', new window.google.ima.AdsManagerLoadedEvent(mgr));
            mgr.dispatch('contentPauseRequested', new window.google.ima.AdEvent('contentPauseRequested'));
            return mgr;
        });
    const resumeAd = (page) => page.evaluate(() => window.__mockIma.adsManagerInstances.at(-1).dispatch('contentResumeRequested', new window.google.ima.AdEvent('contentResumeRequested')));
    const time = (page) => page.evaluate(() => document.getElementById('player').shadowRoot.querySelector('video').currentTime);

    {
        const { context, page } = await open();
        await fakeLive(page, 118);
        await brk(page, 'hp:adbreakstart', { id: 'brk 1', duration: 30, remaining: 30 });
        await page.waitForTimeout(300);
        const urls = await requests(page);
        ok(urls.length === 1 && /d=30&ms=30000&id=brk%201&n=1/.test(urls[0]), `makrolar dolduruldu (${urls[0]?.slice(26, 80)})`);
        await startAd(page);
        await page.evaluate(() => (document.getElementById('player').shadowRoot.querySelector('video').currentTime = 118));
        await resumeAd(page);
        await page.waitForTimeout(200);
        const t = await time(page);
        ok(t === 119, `canlıdaki izleyici reklamdan sonra canlı uca döndü (currentTime=${t})`);
        await context.close();
    }
    {
        const { context, page } = await open();
        await fakeLive(page, 60);
        await brk(page, 'hp:adbreakstart', { id: 'b2', duration: 30, remaining: 30 });
        await page.waitForTimeout(300);
        await startAd(page);
        await resumeAd(page);
        await page.waitForTimeout(200);
        const t = await time(page);
        ok(t === 60, `geride olan izleyici geride kaldı (currentTime=${t})`);
        await context.close();
    }
    {
        const { context, page } = await open();
        await fakeLive(page, 118);
        await brk(page, 'hp:adbreakstart', { id: 'b3', duration: 30, remaining: 30 });
        await page.waitForTimeout(300);
        await startAd(page);
        await brk(page, 'hp:adbreakend', { id: 'b3', reason: 'signal' });
        await page.waitForTimeout(200);
        const log = await page.evaluate(() => window.__adsLog.map((e) => e.ev));
        const adEnd = await events(page, 'hp:adend');
        ok(log.includes('adsManager.destroy') && adEnd.length === 1, 'ara bitince oynayan reklam kesildi, hp:adend geldi');
        ok((await time(page)) === 119 && !(await page.evaluate(() => window.__pausedFlag)), 've canlı uca dönülüp oynatma sürdü');
        await context.close();
    }
    {
        const { context, page } = await open({ minIntervalSec: 600 });
        await fakeLive(page, 118);
        await brk(page, 'hp:adbreakstart', { id: 'short', duration: 3, remaining: 3 });
        await page.evaluate(() => (window.__pausedFlag = true));
        await brk(page, 'hp:adbreakstart', { id: 'paused', duration: 30, remaining: 30 });
        await page.evaluate(() => (window.__pausedFlag = false));
        await page.waitForTimeout(200);
        ok((await requests(page)).length === 0, 'kısa ara (< minBreakSec 5) ve duraklatılmış izleyiciye reklam istenmez');
        await brk(page, 'hp:adbreakstart', { id: 'ok', duration: 30, remaining: 30 });
        await page.waitForTimeout(300);
        await startAd(page);
        await resumeAd(page);
        await brk(page, 'hp:adbreakend', { id: 'ok', reason: 'signal' });
        await brk(page, 'hp:adbreakstart', { id: 'next', duration: 30, remaining: 30 });
        await page.waitForTimeout(300);
        ok((await requests(page)).length === 1, 'minIntervalSec içinde ikinci araya reklam istenmez');
        await context.close();
    }
}

(async () => {
    const browser = await launchBrowser();
    try {
        await testParser(browser);
        if (only(['chromium', 'firefox'], 'Playwright WebKit derlemesinde HLS yok')) await testHlsPlayback(browser);
        await testDash(browser);
        await testAds(browser);
    } finally {
        await browser.close();
    }
    console.log(failures === 0 ? '\nTÜM TESTLER GEÇTİ' : `\n${failures} TEST BAŞARISIZ`);
    process.exit(failures === 0 ? 0 : 1);
})();
