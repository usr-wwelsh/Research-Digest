// Runs summarization + embedding entirely in-browser via transformers.js,
// in a dedicated Web Worker so model inference never blocks the UI thread.
// Mirrors local_ai.py's model choice and behavior (DistilBART-family
// summarizer, DistilBERT-family mean-pooled embedder) using the closest
// available ONNX ports; layman/difficulty/tag heuristics are ported
// verbatim in heuristics.js and applied here, matching local_ai.summarize()'s
// combined return shape.
import { pipeline, env } from "./vendor/transformers.min.js";
import { difficulty, layman, tags } from "./heuristics.js";

// Self-hosted WASM runtime (see scripts/fetch_vendor_assets.sh) rather than
// transformers.js's default jsdelivr fallback — no cloud call at inference
// time, only application code + models (fetched from HF on first use, same
// bootstrapping cost the server pays today) touch the network.
env.backends.onnx.wasm.wasmPaths = "/vendor/ort/";
env.allowLocalModels = false;

const SUMMARIZER_MODEL = "Xenova/distilbart-cnn-6-6";
const EMBEDDING_MODEL = "Xenova/distilbert-base-uncased";

// The summarizer is fp32 (full precision, no quantization), not the
// smaller/faster q8 default — "q8" (transformers.js's own WASM default)
// hit a real onnxruntime-web failure in the browser building this model's
// merged decoder session: "Missing required scale: model.shared.weight_
// merged_0_scale" out of onnxruntime-web's QDQ/MatMulNBits graph
// optimizer. Reproduced under Node with @huggingface/transformers direct
// (not the browser WASM backend, so not a perfect match, but the same
// package/model/dtype): q8 loads fine there, so this looks like a
// WASM-EP-specific bug in the pinned onnxruntime-web nightly build
// (1.26.0-dev.20260416-b7804b056c) rather than a bad model file. fp32 has
// no quantization nodes at all, so this whole error class is structurally
// impossible — confirmed to load and generate correctly under Node.
// The embedder (encoder-only, no merged-decoder graph, no "model.shared"
// tied-embedding complexity) has no evidence of the same issue and stays
// on q8 for its smaller/faster download.
const SUMMARIZER_DTYPE = "fp32";
const EMBEDDER_DTYPE = "q8";

let summarizerPromise = null;
let embedderPromise = null;

function getSummarizer() {
  if (!summarizerPromise) {
    summarizerPromise = pipeline("summarization", SUMMARIZER_MODEL, { dtype: SUMMARIZER_DTYPE });
  }
  return summarizerPromise;
}

function getEmbedder() {
  if (!embedderPromise) {
    embedderPromise = pipeline("feature-extraction", EMBEDDING_MODEL, { dtype: EMBEDDER_DTYPE });
  }
  return embedderPromise;
}

// Mirrors local_ai.py's summarize(): short text is used as-is (matching the
// "< 15 words" shortcut), otherwise generated with the same beam-search
// settings; layman/difficulty/tags are the ported heuristics, not model
// output.
async function summarizeText(title, abstract, category, keywords) {
  const text = abstract || title || "";
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;

  let summaryText;
  if (wordCount < 15) {
    summaryText = text;
  } else {
    const summarizer = await getSummarizer();
    const out = await summarizer(text, {
      max_new_tokens: 142,
      min_new_tokens: 30,
      num_beams: 4,
      early_stopping: true,
    });
    summaryText = (out[0] && out[0].summary_text || "").trim();
  }

  return {
    summary: summaryText,
    layman: layman(abstract || title),
    difficulty: difficulty(abstract || title, category || ""),
    tags: tags(title, abstract || "", keywords || []),
  };
}

// Mean-pooled, not L2-normalized — matches local_ai.py's _mean_pool exactly
// (it pools but never normalizes), so "related papers" similarity scoring
// behaves the same way it did server-side.
async function embedText(text) {
  const embedder = await getEmbedder();
  const out = await embedder(text, { pooling: "mean", normalize: false });
  return Array.from(out.data);
}

self.onmessage = async (event) => {
  const { id, type, payload } = event.data || {};
  try {
    let result;
    if (type === "summarize") {
      result = await summarizeText(payload.title, payload.abstract, payload.category, payload.keywords);
    } else if (type === "embed") {
      result = { embedding: await embedText(payload.text) };
    } else {
      throw new Error(`models.worker: unknown message type "${type}"`);
    }
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: (err && err.message) || String(err) });
  }
};
