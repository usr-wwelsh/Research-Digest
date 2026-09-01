// Single flat, chronological paper list — no per-interest grouping/banners.
// Reveals PAGE_SIZE papers at a time (and summarizes only that increment,
// not the whole corpus); once the locally-fetched pool is exhausted, the
// same "load more" affordance runs a full fetch cycle to pull a fresh batch
// before revealing further.
import { getAll } from "./db.js";
import { navHtml, paperCardHtml, wireSaveButtons, ensureSeedImported, getSavedIdSet, setStatus } from "./ui-common.js";
import { fetchNewPapers, summarizePapers, getInterests, onRemoteSummaryStatus } from "./refresh.js";

document.getElementById("nav").innerHTML = navHtml("digest.html");

const papersEl = document.getElementById("papers");
const emptyEl = document.getElementById("empty");
const filterEl = document.getElementById("filter");
const refreshBtn = document.getElementById("refresh-btn");

const PAGE_SIZE = 5;

let allPapers = [];
let savedIds = new Set();
let interests = [];
let revealed = PAGE_SIZE;
let fetchingMore = false;

function filteredSorted() {
  const q = filterEl.value.toLowerCase().trim();
  return allPapers
    .slice()
    .sort((a, b) => (b.published || "").localeCompare(a.published || ""))
    .filter((p) => {
      if (!q) return true;
      const text = `${p.title} ${p.summary || p.abstract || ""} ${(p.tags || []).join(" ")}`.toLowerCase();
      return text.includes(q);
    });
}

function renderList(papers, visible) {
  emptyEl.hidden = allPapers.length !== 0;
  const hasMoreLocal = papers.length > visible.length;
  const canFetchMore = !hasMoreLocal && !filterEl.value.trim() && papers.length > 0;

  let footer = "";
  if (hasMoreLocal) {
    footer = `<button class="btn load-more-btn" type="button">Show ${Math.min(PAGE_SIZE, papers.length - visible.length)} more</button>`;
  } else if (canFetchMore) {
    footer = fetchingMore
      ? `<button class="btn load-more-btn" type="button" disabled>Fetching more…</button>`
      : `<button class="btn load-more-btn" type="button">Fetch more papers</button>`;
  }

  papersEl.innerHTML =
    visible.map((p) => paperCardHtml(p, savedIds.has(p.arxiv_id))).join("") +
    (footer ? `<div class="list-footer">${footer}</div>` : "");
}

async function doRefreshView() {
  const filtered = filteredSorted();
  const visible = filtered.slice(0, Math.min(revealed, filtered.length));
  renderList(filtered, visible);

  const toSummarize = visible.filter((p) => !p.summary || !p.embedding);
  if (toSummarize.length) {
    await summarizePapers(toSummarize, interests, setStatus);
    allPapers = await getAll("papers");
    const filtered2 = filteredSorted();
    const visible2 = filtered2.slice(0, Math.min(revealed, filtered2.length));
    renderList(filtered2, visible2);
  }
}

// Single-flight: overlapping callers (filter keystrokes, a double-clicked
// "show more") used to each kick off their own summarizePapers() run against
// a stale paper list — same queued abstracts summarized twice, and their
// progress counters (different totals) interleaving in the status line. A
// call that arrives mid-run now just marks a rerun instead of starting a
// second one, so only one summarization pass is ever in flight.
let refreshInFlight = null;
let refreshQueued = false;

async function refreshView() {
  if (refreshInFlight) {
    refreshQueued = true;
    return refreshInFlight;
  }
  refreshInFlight = (async () => {
    do {
      refreshQueued = false;
      await doRefreshView();
    } while (refreshQueued);
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

papersEl.addEventListener("click", async (event) => {
  const btn = event.target.closest(".load-more-btn");
  if (!btn || btn.disabled) return;

  const filtered = filteredSorted();
  if (revealed < filtered.length) {
    revealed += PAGE_SIZE;
    await refreshView();
    return;
  }

  fetchingMore = true;
  renderList(filtered, filtered.slice(0, revealed));
  try {
    await fetchNewPapers(setStatus);
    allPapers = await getAll("papers");
    revealed += PAGE_SIZE;
  } catch (err) {
    console.error("digest: batch fetch failed", err);
    setStatus("Fetch failed — check your connection.");
  } finally {
    fetchingMore = false;
    await refreshView();
  }
});

async function init() {
  onRemoteSummaryStatus(setStatus);
  await ensureSeedImported();
  interests = await getInterests();
  [allPapers, savedIds] = await Promise.all([getAll("papers"), getSavedIdSet()]);
  await refreshView();

  wireSaveButtons(papersEl, "digest");
  filterEl.addEventListener("input", () => {
    revealed = PAGE_SIZE;
    refreshView();
  });

  refreshBtn.addEventListener("click", async () => {
    refreshBtn.disabled = true;
    try {
      await fetchNewPapers(setStatus);
      allPapers = await getAll("papers");
      await refreshView();
    } catch (err) {
      console.error("digest: refresh failed", err);
      setStatus("Refresh failed — check your connection.");
    } finally {
      refreshBtn.disabled = false;
    }
  });
}

init();
