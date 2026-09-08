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

// Splits every doc's sentences up front and records which ones need
// sentence-level embeddings (more than `count` sentences), flattened into
// one array so the caller can embed them in a single batched model call
// instead of one per doc. Pure and model-free — pairs with
// assembleExtractiveBatch once the caller has run the actual embeddings.
export function planExtractiveBatch(texts, count) {
  const perDocSentences = texts.map(splitSentences);
  const flatSentences = [];
  const spans = perDocSentences.map((sentences) => {
    if (sentences.length <= count) return null;
    const start = flatSentences.length;
    flatSentences.push(...sentences);
    return { start, length: sentences.length };
  });
  return { perDocSentences, flatSentences, spans };
}

// Pairs a planExtractiveBatch() plan back up with the batched embeddings
// (docEmbeddings[i] per text, flatEmbeddings sliced per span) to produce the
// final per-doc summaries — kept separate from the embedding calls so this
// stays pure and testable without a model.
export function assembleExtractiveBatch(texts, plan, docEmbeddings, flatEmbeddings, count) {
  const { perDocSentences, spans } = plan;
  return texts.map((text, i) => {
    const docEmbedding = docEmbeddings[i];
    const span = spans[i];
    if (!span) return { summary: text.trim(), embedding: docEmbedding };
    const embeddings = flatEmbeddings.slice(span.start, span.start + span.length);
    const summary = selectSummarySentences(perDocSentences[i], embeddings, docEmbedding, count).join(" ");
    return { summary, embedding: docEmbedding };
  });
}
