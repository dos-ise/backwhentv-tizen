#!/bin/bash
set -e
cd "$(dirname "$0")"
mkdir -p dist
docker build -t backwhentv-tizen .
docker rm -f backwhentv-tizen-out >/dev/null 2>&1 || true
docker create --name backwhentv-tizen-out backwhentv-tizen >/dev/null
docker cp backwhentv-tizen-out:/home/bwtv/BackWhenTV.wgt dist/BackWhenTV.wgt
docker rm backwhentv-tizen-out >/dev/null
echo "Built dist/BackWhenTV.wgt"
