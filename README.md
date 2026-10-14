# Rapi

A small Indonesian photo privacy tool. Add several photos, review automatically detected faces, add or resize oval and box areas, then download one photo or all of them. Images stay in the browser; the Rust WebAssembly modules run locally.

Automatic detection uses the bundled SeetaFace frontal detector. It can miss side-facing or very small faces, so each photo also supports manual areas.

## Build the WebAssembly modules

Requirements: stable Rust, the `wasm32-unknown-unknown` target, `wasm-pack`, `curl`, and `sha256sum`.

```sh
rustup target add wasm32-unknown-unknown
./scripts/build-wasm.sh
python3 -m http.server 8000
```

Open `http://localhost:8000`. The detector model is fetched from a pinned upstream commit and SHA-256 checked before it is embedded in the detector module. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The GitHub Actions workflow builds both WASM modules and deploys only the static site and generated modules to GitHub Pages.
