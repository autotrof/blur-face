#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
"$root/scripts/fetch-model.sh"
mkdir -p "$root/public/wasm"
(cd "$root/crates/face-detect" && wasm-pack build --release --target web --out-dir ../../public/wasm/face-detect)
(cd "$root/crates/blur" && wasm-pack build --release --target web --out-dir ../../public/wasm/blur)
test -s "$root/public/wasm/face-detect/wajah_detect.js"
test -s "$root/public/wasm/face-detect/wajah_detect_bg.wasm"
test -s "$root/public/wasm/blur/wajah_blur.js"
test -s "$root/public/wasm/blur/wajah_blur_bg.wasm"
