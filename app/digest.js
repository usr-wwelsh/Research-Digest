import { getAll } from "./db.js";
import { navHtml, paperCardHtml, wireSaveButtons, ensureSeedImported, getSavedIdSet, setStatus } from "./ui-common.js";
import { runFullRefresh } from "./refresh.js";
import { DEFAULT_INTERESTS } from "./default-interests.js";

document.getElementById("nav").innerHTML = navHtml("digest.html");

const groupsEl = document.getElementById("groups");
const emptyEl = document.getElementById("empty");
const filterEl = document.getElementById("filter");
const refreshBtn = document.getElementById("refresh-btn");

let allPapers = [];
let savedIds = new Set();
let order = DEFAULT_INTERESTS.map((i) => i.name);

function render(filterText) {
  const q = (filterText || "").toLowerCase().trim();
  const grouped = new Map();
  for (const p of allPapers) {
    const text = `${p.title} ${p.summary || p.abstract || ""} ${(p.tags || []).join(" ")}`.toLowerCase();
    if (q && !text.includes(q)) continue;
    const key = p.interest || "Other";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(p);
  }

  const orderedNames = [...order.filter((n) => grouped.has(n)), ...Array.from(grouped.keys()).filter((n) => !order.includes(n))];

  emptyEl.hidden = allPapers.length !== 0;
  groupsEl.innerHTML = orderedNames
    .map((name) => {
      const papers = grouped.get(name);
      papers.sort((a, b) => (b.published || "").localeCompare(a.published || ""));
      return `
        <div class="interest-section">
          <div class="interest-header"><h2 class="interest-title">${name}</h2></div>
          <div class="papers-grid">
            ${papers.map((p) => paperCardHtml(p, savedIds.has(p.arxiv_id))).join("")}
          </div>
        </div>`;
    })
    .join("");
}

async function loadAndRender() {
  [allPapers, savedIds] = await Promise.all([getAll("papers"), getSavedIdSet()]);
  render(filterEl.value);
}

async function init() {
  await ensureSeedImported();
  const interests = await getAll("interests");
  if (interests.length) order = interests.map((i) => i.name);
  await loadAndRender();
  wireSaveButtons(groupsEl, "digest");
  filterEl.addEventListener("input", () => render(filterEl.value));

  refreshBtn.addEventListener("click", async () => {
    refreshBtn.disabled = true;
    try {
      await runFullRefresh(setStatus);
      await loadAndRender();
    } catch (err) {
      console.error("digest: refresh failed", err);
      setStatus("Refresh failed — check your connection.");
    } finally {
      refreshBtn.disabled = false;
    }
  });
}

init();
