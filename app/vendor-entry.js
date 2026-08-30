// Build-time only — not shipped. `npm run build:vendor` bundles this
// (transformers.js + its onnxruntime-web/onnxruntime-common deps) into a
// single self-contained vendor/transformers.min.js with esbuild, since the
// package's own published dist files still have unresolved bare imports
// (onnxruntime-web/webgpu, onnxruntime-common) that need either a bundler
// or an import map — esbuild once, at vendor-update time, is simpler than
// wiring up an import map for a library update that happens rarely.
export * from "@huggingface/transformers";
