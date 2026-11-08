#!/bin/bash
# Docker içinde (mcr.microsoft.com/playwright, Ubuntu 24.04) cross-browser.yml'in adımları — bkz. run-in-docker.mjs.
# /src = repo (salt okunur), /work = kalıcı volume (node_modules burada kalır, sonraki çalıştırmalar hızlı).
# Kullanım: in-container.sh <firefox|webkit|chromium>... [-- takım...]
set -e
browsers=()
while [ $# -gt 0 ] && [ "$1" != "--" ]; do browsers+=("$1"); shift; done
[ "$1" = "--" ] && shift
suites=("$@")

mkdir -p /work
cd /src
# Güncel kaynakları kopyala (Windows / macOS node_modules'u, .git ve derleme çıktıları hariç).
tar --exclude=node_modules --exclude=.git --exclude=apps/docs --exclude=dist -cf - . | (cd /work && tar -xf -)
cd /work
if [ ! -f node_modules/.hp-stamp ] || [ package-lock.json -nt node_modules/.hp-stamp ]; then
    echo "npm ci…"
    npm ci --no-audit --no-fund --loglevel=error
    touch node_modules/.hp-stamp
fi
echo "Derleniyor…"
{ npm run build:core && npm run build:react-native && npm run build:vue; } >/tmp/build.log 2>&1 || { tail -40 /tmp/build.log; exit 1; }

npm run dev --workspace=apps/playground -- --port 5183 --strictPort >/tmp/playground.log 2>&1 &
for i in $(seq 1 60); do curl -sf -o /dev/null http://localhost:5183/ && break; sleep 1; done
curl -sf -o /dev/null http://localhost:5183/ || { echo "playground açılmadı"; cat /tmp/playground.log; exit 1; }

status=0
for b in "${browsers[@]}"; do
    echo
    echo "████ $b (Linux, Ubuntu 24.04, ses aygıtı yok — GitHub Actions ile aynı) ████"
    HOPE_TEST_PORT=5183 node apps/playground/test/run.mjs --browser "$b" "${suites[@]}" || status=1
done
exit $status
