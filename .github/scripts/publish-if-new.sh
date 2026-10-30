#!/usr/bin/env bash
# Bulunduğu paket klasöründeki package.json'ı npm'e yayınlar; bu sürüm npm'de zaten varsa atlar.
# Yarıda kalan bir publish workflow'u yeniden çalıştırılınca "You cannot publish over the previously
# published versions" hatasıyla düşmesin, yalnızca eksik kalan paketler yayınlansın diye.
set -euo pipefail

name=$(node -p "require('./package.json').name")
version=$(node -p "require('./package.json').version")

if npm view "${name}@${version}" version >/dev/null 2>&1; then
    echo "${name}@${version} npm'de zaten yayında — atlanıyor."
    exit 0
fi

npm publish --provenance --access public
