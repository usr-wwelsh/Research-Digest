// In-browser summarization + embedding via transformers.js, off the UI
// thread. Summarization is extractive (extractive.js), so the one DistilBERT
// embedder does both jobs — no separate generative model.
import { pipeline, env } from "./vendor/transformers.min.js";
import { difficulty, layman, tags } from "./heuristics.js";
import { splitSentences, selectSummarySentences } from "./extractive.js";

// Self-hosted, not transformers.js's jsdelivr default (see
// scripts/fetch_vendor_assets.sh). Must be the exact asyncify mjs/wasm pair:
// a bare path prefix falls back to onnxruntime-web's plain threaded build,
// which hangs indefinitely post-download in Firefox with no console error.
env.backends.onnx.wasm.wasmPaths = {
  mjs: "/vendor/ort/ort-wasm-simd-threaded.asyncify.mjs",
  wasm: "/vendor/ort/ort-wasm-simd-threaded.asyncify.wasm",
};
env.allowLocalModels = false;
env.backends.onnx.wasm.numThreads = 1;

const EMBEDDING_MODEL = "Xenova/distilbert-base-uncased";
const EMBEDDER_DTYPE = "q8";
const SUMMARY_SENTENCE_COUNT = 2;

let embedderPromise = null;

function reportProgress(data) {
  if (data.status === "initiate") {
    self.postMessage({ type: "progress", message: `Loading model: ${data.file}…` });
  } else if (data.status === "progress") {
    const pct = data.progress != null ? ` ${Math.round(data.progress)}%` : "";
    self.postMessage({ type: "progress", message: `Loading model: ${data.file}${pct}…` });
  }
}

function getEmbedder() {
  if (!embedderPromise) {
    embedderPromise = pipeline("feature-extraction", EMBEDDING_MODEL, {
      dtype: EMBEDDER_DTYPE,
      progress_callback: reportProgress,
    });
  }
  return embedderPromise;
}

// Mean-pooled, not normalized — matches local_ai.py's _mean_pool.
async function embedText(text) {
  const embedder = await getEmbedder();
  const out = await embedder(text, { pooling: "mean", normalize: false });
  return Array.from(out.data);
}

// Centroid extractive summary (extractive.js). Sequential, not
// Promise.all — the ONNX WASM session isn't reentrant.
async function extractiveSummary(text) {
  const sentences = splitSentences(text);
  const docEmbedding = await embedText(text);
  if (sentences.length <= SUMMARY_SENTENCE_COUNT) {
    return { summary: text.trim(), embedding: docEmbedding };
  }
  const embeddings = [];
  for (const sentence of sentences) {
    embeddings.push(await embedText(sentence));
  }
  const summary = selectSummarySentences(sentences, embeddings, docEmbedding, SUMMARY_SENTENCE_COUNT).join(" ");
  return { summary, embedding: docEmbedding };
}

async function summarizeText(title, abstract, category, keywords) {
  const text = abstract || title || "";
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;

  const { summary, embedding } =
    wordCount < 15 ? { summary: text, embedding: null } : await extractiveSummary(text);

  return {
    summary,
    embedding,
    layman: layman(abstract || title),
    difficulty: difficulty(abstract || title, category || ""),
    tags: tags(title, abstract || "", keywords || []),
  };
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
