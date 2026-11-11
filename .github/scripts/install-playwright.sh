#!/usr/bin/env bash
# Playwright tarayıcısını kurar; sistem paketleri yalnızca tarayıcı açılamazsa (yeniden denemeyle) kurulur.
set -euo pipefail
browser="${1:-chromium}"

npx playwright install "$browser"

launches() {
    HOPE_BROWSER="$browser" node -e "import('playwright').then((p) => p[process.env.HOPE_BROWSER].launch()).then((b) => b.close())"
}

if launches; then
    echo "$browser hazır (sistem paketleri gerekmedi)."
    exit 0
fi

for attempt in 1 2 3; do
    echo "Sistem paketleri kuruluyor ($browser), deneme $attempt/3"
    if npx playwright install-deps "$browser" && launches; then
        echo "$browser hazır."
        exit 0
    fi
    sleep $((attempt * 20))
done

echo "$browser kurulamadı." >&2
exit 1
