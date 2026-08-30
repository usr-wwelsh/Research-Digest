// Centroid-based extractive summarization: no generation, so any tiny
// embedding model works (mirrors local_ai.py's approach) — the summarizer
// is the same DistilBERT already loaded for "related papers", not a
// separate abstractive model.
export function splitSentences(text) {
  return (text.match(/[^.!?]+[.!?]+(?:\s|$)/g) || [text])
    .map((s) => s.trim())
    .filter(Boolean);
}

export function cosineSimilarity(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}

// `embeddings[i]` must correspond to `sentences[i]`. Selected sentences are
// returned in their original order, not score order.
export function selectSummarySentences(sentences, embeddings, docEmbedding, count) {
  if (sentences.length <= count) return sentences;
  return sentences
    .map((sentence, i) => ({ sentence, i, score: cosineSimilarity(embeddings[i], docEmbedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .sort((a, b) => a.i - b.i)
    .map((s) => s.sentence);
}
