import { getAll } from "./db.js";
import { navHtml, feedCardHtml, wireSaveButtons, ensureSeedImported, getSavedIdSet, setStatus } from "./ui-common.js";
import { fetchNewPapers, summarizePapers, getInterests } from "./refresh.js";

document.getElementById("nav").innerHTML = navHtml("feed.html");

const feedEl = document.getElementById("feed");
const feedContainerEl = document.getElementById("feed-container");
const emptyEl = document.getElementById("empty");
const filterEl = document.getElementById("filter");
const refreshBtn = document.getElementById("refresh-btn");

const PAGE_SIZE = 10;

let allPapers = [];
let savedIds = new Set();
let interests = [];
let revealed = PAGE_SIZE;

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

function renderCards(papers, visible) {
  emptyEl.hidden = papers.length !== 0;
  const hasMore = papers.length > visible.length;
  feedEl.innerHTML =
    visible.map((p) => feedCardHtml(p, savedIds.has(p.arxiv_id))).join("") +
    (hasMore ? `<div class="feed-card"><button class="btn load-more-btn" type="button">Show ${Math.min(PAGE_SIZE, papers.length - visible.length)} more</button></div>` : "");
}

async function refreshView(resetScroll) {
  const papers = filteredSorted();
  const visible = papers.slice(0, Math.min(revealed, papers.length));
  renderCards(papers, visible);
  if (resetScroll) feedContainerEl.scrollTop = 0;

  const toSummarize = visible.filter((p) => !p.summary || !p.embedding);
  if (toSummarize.length) {
    await summarizePapers(toSummarize, interests, setStatus);
    allPapers = await getAll("papers");
    const papers2 = filteredSorted();
    const visible2 = papers2.slice(0, Math.min(revealed, papers2.length));
    renderCards(papers2, visible2);
  }
}

feedEl.addEventListener("click", async (event) => {
  if (!event.target.closest(".load-more-btn")) return;
  revealed += PAGE_SIZE;
  await refreshView(false);
});

async function init() {
  await ensureSeedImported();
  interests = await getInterests();
  [allPapers, savedIds] = await Promise.all([getAll("papers"), getSavedIdSet()]);
  await refreshView(true);

  wireSaveButtons(feedEl, "feed");
  filterEl.addEventListener("input", () => {
    revealed = PAGE_SIZE;
    refreshView(true);
  });

  refreshBtn.addEventListener("click", async () => {
    refreshBtn.disabled = true;
    try {
      await fetchNewPapers(setStatus);
      allPapers = await getAll("papers");
      await refreshView(false);
    } catch (err) {
      console.error("feed: refresh failed", err);
      setStatus("Refresh failed — check your connection.");
    } finally {
      refreshBtn.disabled = false;
    }
  });
}

init();
