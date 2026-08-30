// Client-side port of relate.py: cosine similarity over embeddings, top-6
// nearest neighbours per paper. Corpus sizes here are hundreds of rows, not
// millions — plain JS loops are fine, no need for a numpy-equivalent.
const TOP_N = 6;

export function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// papers: [{arxiv_id, embedding: number[]|null}]. Returns
// {[arxiv_id]: [nearest arxiv_ids, most similar first]} for embedded papers
// only, excluding self-matches and non-positive similarity.
export function computeRelated(papers, topN = TOP_N) {
  const embedded = papers.filter((p) => Array.isArray(p.embedding) && p.embedding.length > 0);
  if (embedded.length < 2) return {};

  const related = {};
  for (const p of embedded) {
    const sims = embedded
      .filter((other) => other.arxiv_id !== p.arxiv_id)
      .map((other) => ({ id: other.arxiv_id, sim: cosineSimilarity(p.embedding, other.embedding) }))
      .filter((s) => s.sim > 0)
      .sort((x, y) => y.sim - x.sim)
      .slice(0, topN)
      .map((s) => s.id);
    related[p.arxiv_id] = sims;
  }
  return related;
}
