import { getAll } from "./db.js";
import { navHtml, feedCardHtml, wireSaveButtons, ensureSeedImported, getSavedIdSet, setStatus } from "./ui-common.js";
import { runFullRefresh } from "./refresh.js";

document.getElementById("nav").innerHTML = navHtml("feed.html");

const feedEl = document.getElementById("feed");
const feedContainerEl = document.getElementById("feed-container");
const emptyEl = document.getElementById("empty");
const filterEl = document.getElementById("filter");
const refreshBtn = document.getElementById("refresh-btn");

let allPapers = [];
let savedIds = new Set();

function render(filterText) {
  const q = (filterText || "").toLowerCase().trim();
  const papers = allPapers
    .slice()
    .sort((a, b) => (b.published || "").localeCompare(a.published || ""))
    .filter((p) => {
      if (!q) return true;
      const text = `${p.title} ${p.summary || p.abstract || ""} ${(p.tags || []).join(" ")}`.toLowerCase();
      return text.includes(q);
    });

  emptyEl.hidden = papers.length !== 0;
  feedEl.innerHTML = papers.map((p) => feedCardHtml(p, savedIds.has(p.arxiv_id))).join("");
  feedContainerEl.scrollTop = 0;
}

async function loadAndRender() {
  [allPapers, savedIds] = await Promise.all([getAll("papers"), getSavedIdSet()]);
  render(filterEl.value);
}

async function init() {
  await ensureSeedImported();
  await loadAndRender();
  wireSaveButtons(feedEl, "feed");
  filterEl.addEventListener("input", () => render(filterEl.value));

  refreshBtn.addEventListener("click", async () => {
    refreshBtn.disabled = true;
    try {
      await runFullRefresh(setStatus);
      await loadAndRender();
    } catch (err) {
      console.error("feed: refresh failed", err);
      setStatus("Refresh failed — check your connection.");
    } finally {
      refreshBtn.disabled = false;
    }
  });
}

init();
