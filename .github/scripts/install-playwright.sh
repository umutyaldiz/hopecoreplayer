#!/usr/bin/env bash
# Playwright tarayıcısı (önbellekten ya da indirerek) + sistem paketleri (codec, font) — apt hatasında yeniden dener.
# Yalnızca "tarayıcı açılıyor mu" bakmak yetmez: Firefox / WebKit paketler olmadan açılır ama video çözemez.
set -euo pipefail
browser="${1:-chromium}"

npx playwright install "$browser"

for attempt in 1 2 3; do
    echo "Sistem paketleri kuruluyor ($browser), deneme $attempt/3"
    if npx playwright install-deps "$browser"; then
        echo "$browser hazır."
        exit 0
    fi
    sleep $((attempt * 20))
done

echo "$browser sistem paketleri kurulamadı." >&2
exit 1
