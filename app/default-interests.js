// Seeded into IndexedDB on first run. Ported from config.json's 5 interests
// — the server no longer owns interest config (each PWA install owns its
// own), but a fresh install shouldn't start with zero interests either.
function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "");
}

const RAW = [
  {
    name: "Efficient ML / Edge AI",
    query: "cat:cs.LG OR cat:cs.CV OR cat:cs.CL",
    keywords: ["efficient", "edge", "compression", "quantization", "pruning", "distillation",
      "inference", "lightweight", "mobile", "accelerat"],
  },
  {
    name: "Privacy-Preserving ML",
    query: "cat:cs.CR OR cat:cs.LG",
    keywords: ["privacy", "federated", "differential", "secure", "encrypted", "confidential",
      "private", "anonymi"],
  },
  {
    name: "Creative AI / Emotion",
    query: "cat:cs.AI OR cat:cs.SD OR cat:cs.HC",
    keywords: ["emotion", "generative", "creative", "music", "affective", "sentiment", "art",
      "design", "audio", "synthesis"],
  },
  {
    name: "Lightweight Systems",
    query: "cat:cs.DC OR cat:cs.AR",
    keywords: ["embedded", "iot", "edge", "resource", "constrained", "microcontroller",
      "low-power", "sensor", "device"],
  },
  {
    name: "Offline-First / Local AI",
    query: "cat:cs.LG",
    keywords: ["local", "device", "mobile", "offline", "on-device", "edge", "browser",
      "client-side", "standalone"],
  },
];

export const DEFAULT_INTERESTS = RAW.map((r) => ({
  id: slugify(r.name),
  name: r.name,
  query_by_source: { arxiv: r.query },
  keywords: r.keywords,
  sources: ["arxiv"],
  enabled: true,
}));
