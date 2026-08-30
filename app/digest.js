import { getAll } from "./db.js";
import { navHtml, paperCardHtml, escapeHtml, wireSaveButtons, ensureSeedImported, getSavedIdSet, setStatus } from "./ui-common.js";
import { fetchNewPapers, summarizePapers, getInterests } from "./refresh.js";
import { DEFAULT_INTERESTS } from "./default-interests.js";

document.getElementById("nav").innerHTML = navHtml("digest.html");

const groupsEl = document.getElementById("groups");
const emptyEl = document.getElementById("empty");
const filterEl = document.getElementById("filter");
const refreshBtn = document.getElementById("refresh-btn");

const PAGE_SIZE = 5;

let allPapers = [];
let savedIds = new Set();
let interests = [];
let order = DEFAULT_INTERESTS.map((i) => i.name);
let revealed = new Map(); // interest name -> how many of its papers are currently shown

function groupedFiltered() {
  const q = filterEl.value.toLowerCase().trim();
  const grouped = new Map();
  for (const p of allPapers) {
    const text = `${p.title} ${p.summary || p.abstract || ""} ${(p.tags || []).join(" ")}`.toLowerCase();
    if (q && !text.includes(q)) continue;
    const key = p.interest || "Other";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(p);
  }
  for (const arr of grouped.values()) arr.sort((a, b) => (b.published || "").localeCompare(a.published || ""));
  return grouped;
}

function orderedGroupNames(grouped) {
  return [...order.filter((n) => grouped.has(n)), ...Array.from(grouped.keys()).filter((n) => !order.includes(n))];
}

function renderGroups(grouped, names) {
  emptyEl.hidden = allPapers.length !== 0;
  groupsEl.innerHTML = names
    .map((name) => {
      const papers = grouped.get(name);
      const shown = Math.min(revealed.get(name) || PAGE_SIZE, papers.length);
      const visible = papers.slice(0, shown);
      const hasMoreLocally = papers.length > shown;
      const canFetchMore = interests.some((i) => i.name === name);
      const footer = hasMoreLocally
        ? `<button class="btn load-more-btn" data-interest="${escapeHtml(name)}" type="button">Show ${Math.min(PAGE_SIZE, papers.length - shown)} more (${papers.length - shown} already fetched)</button>`
        : (canFetchMore
          ? `<button class="btn fetch-more-btn" data-interest="${escapeHtml(name)}" type="button">Fetch more papers</button>`
          : "");
      return `
        <div class="interest-section">
          <div class="interest-header"><h2 class="interest-title">${escapeHtml(name)}</h2></div>
          <div class="papers-grid">${visible.map((p) => paperCardHtml(p, savedIds.has(p.arxiv_id))).join("")}</div>
          <div class="links">${footer}</div>
        </div>`;
    })
    .join("");
}

function visiblePapers(grouped, names) {
  const out = [];
  for (const name of names) {
    const papers = grouped.get(name);
    const shown = Math.min(revealed.get(name) || PAGE_SIZE, papers.length);
    out.push(...papers.slice(0, shown));
  }
  return out;
}

async function refreshView() {
  const grouped = groupedFiltered();
  const names = orderedGroupNames(grouped);
  renderGroups(grouped, names);

  const toSummarize = visiblePapers(grouped, names).filter((p) => !p.summary || !p.embedding);
  if (toSummarize.length) {
    await summarizePapers(toSummarize, interests, setStatus);
    allPapers = await getAll("papers");
    // Re-render with the now-filled-in summaries; deliberately not calling
    // refreshView() again here — everything visible is summarized by now,
    // so there's nothing left to trigger a further pass.
    const grouped2 = groupedFiltered();
    const names2 = orderedGroupNames(grouped2);
    renderGroups(grouped2, names2);
  }
}

groupsEl.addEventListener("click", async (event) => {
  const loadBtn = event.target.closest(".load-more-btn");
  const fetchBtn = event.target.closest(".fetch-more-btn");

  if (loadBtn) {
    const name = loadBtn.dataset.interest;
    revealed.set(name, (revealed.get(name) || PAGE_SIZE) + PAGE_SIZE);
    await refreshView();
    return;
  }

  if (fetchBtn) {
    const name = fetchBtn.dataset.interest;
    const interestCfg = interests.find((i) => i.name === name);
    if (!interestCfg) return;
    fetchBtn.disabled = true;
    fetchBtn.textContent = "Fetching…";
    try {
      await fetchNewPapers(setStatus, [interestCfg]);
      allPapers = await getAll("papers");
      revealed.set(name, (revealed.get(name) || PAGE_SIZE) + PAGE_SIZE);
      await refreshView();
    } catch (err) {
      console.error("digest: fetch more failed", err);
      setStatus("Fetch failed — check your connection.");
    } finally {
      fetchBtn.disabled = false;
    }
  }
});

async function init() {
  await ensureSeedImported();
  interests = await getInterests();
  if (interests.length) order = interests.map((i) => i.name);

  [allPapers, savedIds] = await Promise.all([getAll("papers"), getSavedIdSet()]);
  await refreshView();

  wireSaveButtons(groupsEl, "digest");
  filterEl.addEventListener("input", () => refreshView());

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
