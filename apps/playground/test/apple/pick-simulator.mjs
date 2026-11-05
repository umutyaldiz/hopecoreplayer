// En yeni iOS sürümündeki bir iPhone simülatörünü seçer, açar ve bilgisini yazar (GitHub Actions'ta $GITHUB_ENV'e).
// Cihaz adları runner'daki Xcode'a göre değiştiği için sabit yazılmaz. İsteğe bağlı: IOS_DEVICE_HINT="iPhone 17".
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const list = JSON.parse(execFileSync('xcrun', ['simctl', 'list', 'devices', 'available', '-j'], { encoding: 'utf8' }));
const parseVersion = (runtime) => (/iOS-(\d+)-(\d+)(?:-(\d+))?/.exec(runtime) ?? []).slice(1).map((n) => Number(n ?? 0));
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || (a[2] ?? 0) - (b[2] ?? 0);

const runtimes = Object.keys(list.devices)
    .filter((r) => r.includes('SimRuntime.iOS-') && list.devices[r].some((d) => d.name.startsWith('iPhone')))
    .sort((a, b) => cmp(parseVersion(b), parseVersion(a)));
if (!runtimes.length) {
    console.error('iPhone simülatörü bulunamadı');
    process.exit(1);
}
const runtime = runtimes[0];
const phones = list.devices[runtime].filter((d) => d.name.startsWith('iPhone'));
const hint = process.env.IOS_DEVICE_HINT;
// Tercih: ipucu → "Pro" olmayan en yeni numaralı model (ör. "iPhone 16") → ilk iPhone.
const device =
    (hint && phones.find((d) => d.name === hint)) ||
    phones.filter((d) => /^iPhone \d+$/.test(d.name)).sort((a, b) => Number(b.name.split(' ')[1]) - Number(a.name.split(' ')[1]))[0] ||
    phones[0];
const version = parseVersion(runtime).filter((n, i) => i < 2 || n).join('.');

if (device.state !== 'Booted') execFileSync('xcrun', ['simctl', 'boot', device.udid], { stdio: 'inherit' });
execFileSync('xcrun', ['simctl', 'bootstatus', device.udid, '-b'], { stdio: 'inherit' });

console.log(`Simülatör: ${device.name} — iOS ${version} (${device.udid})`);
if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `IOS_DEVICE=${device.name}\nIOS_VERSION=${version}\nIOS_UDID=${device.udid}\n`);
