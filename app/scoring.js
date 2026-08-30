// Direct JS port of fetch.py's score() — title hits count 3x, abstract hits
// count 1x. Kept identical across every source adapter (arxiv.js,
// semanticscholar.js, openreview.js) and the client-side feedback loop.
export function score(paper, keywords) {
  const title = (paper.title || "").toLowerCase();
  const abstract = (paper.abstract || "").toLowerCase();
  let s = 0;
  for (const raw of keywords) {
    const kw = raw.toLowerCase();
    if (title.includes(kw)) {
      s += 3;
    } else if (abstract.includes(kw)) {
      s += 1;
    }
  }
  return s;
}
