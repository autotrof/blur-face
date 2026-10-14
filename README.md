# Autotrof Blur Face Offline

An offline-capable photo privacy editor. Add several photos, review the automatically detected faces, add or rotate manual areas, crop each photo, and download one image or the full batch. Images stay in the browser; the Rust WebAssembly modules run locally.

Automatic detection uses the bundled SeetaFace frontal detector. It can miss side-facing or very small faces, so each photo also supports manual areas.

## Build the WebAssembly modules

Requirements: stable Rust, the `wasm32-unknown-unknown` target, `wasm-pack`, `curl`, and `sha256sum`.

```sh
rustup target add wasm32-unknown-unknown
./scripts/build-wasm.sh
python3 -m http.server 8000
```

Open `http://localhost:8000`. The detector model is fetched from a pinned upstream commit and SHA-256 checked before it is embedded in the detector module. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The service worker caches the app shell, icons, and both WASM modules for offline use. Its relative URLs support GitHub Pages project subpaths. The Pages workflow builds both modules and includes all installable PWA files in the deployment artifact.
