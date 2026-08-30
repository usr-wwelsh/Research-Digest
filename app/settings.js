import { getAll, put, del } from "./db.js";
import { navHtml, interestRowHtml, setStatus } from "./ui-common.js";
import { fetchNewPapers } from "./refresh.js";
import { DEFAULT_INTERESTS } from "./default-interests.js";

document.getElementById("nav").innerHTML = navHtml("settings.html");

const rowsEl = document.getElementById("rows");
const addBtn = document.getElementById("add-btn");
const saveBtn = document.getElementById("save-btn");
const resetBtn = document.getElementById("reset-btn");
const refreshBtn = document.getElementById("refresh-btn");

let interests = [];
let removedIds = [];

function slugify(name) {
  return (name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "") || `interest-${Date.now()}`;
}

function render() {
  rowsEl.innerHTML = interests.map((it, i) => interestRowHtml(it, i)).join("");
}

function readFormIntoModel() {
  for (const rowEl of rowsEl.querySelectorAll(".interest-row")) {
    const interest = interests[Number(rowEl.dataset.index)];
    if (!interest) continue;
    interest.name = rowEl.querySelector('[data-field="name"]').value.trim();
    interest.keywords = rowEl.querySelector('[data-field="keywords"]').value
      .split(",").map((s) => s.trim()).filter(Boolean);
    interest.sources = Array.from(rowEl.querySelectorAll('[data-field="source"]'))
      .filter((cb) => cb.checked).map((cb) => cb.dataset.source);
    interest.enabled = rowEl.querySelector('[data-field="enabled"]').checked;
  }
}

rowsEl.addEventListener("click", (event) => {
  const delBtn = event.target.closest('[data-action="delete"]');
  if (!delBtn) return;
  readFormIntoModel();
  const index = Number(delBtn.closest(".interest-row").dataset.index);
  const [removed] = interests.splice(index, 1);
  if (removed && removed.id) removedIds.push(removed.id);
  render();
});

addBtn.addEventListener("click", () => {
  readFormIntoModel();
  interests.push({ id: null, name: "", keywords: [], sources: ["arxiv"], enabled: true, query_by_source: {} });
  render();
});

saveBtn.addEventListener("click", async () => {
  readFormIntoModel();
  interests = interests.filter((it) => it.name);
  for (const it of interests) {
    if (!it.id) it.id = slugify(it.name);
  }
  for (const id of removedIds) await del("interests", id);
  removedIds = [];
  for (const it of interests) await put("interests", it);
  render();
  setStatus("Saved.");
  setTimeout(() => setStatus(null), 1500);
});

resetBtn.addEventListener("click", async () => {
  if (!confirm("Reset interests to the 5 defaults? Your custom interests will be removed.")) return;
  const current = await getAll("interests");
  for (const it of current) await del("interests", it.id);
  for (const it of DEFAULT_INTERESTS) await put("interests", it);
  interests = await getAll("interests");
  removedIds = [];
  render();
});

// Settings doesn't display papers, so there's nothing to lazily summarize
// here — just pull new candidates; the digest page summarizes whatever's
// visible next time you open it.
refreshBtn.addEventListener("click", async () => {
  refreshBtn.disabled = true;
  try {
    await fetchNewPapers(setStatus);
  } finally {
    refreshBtn.disabled = false;
  }
});

async function init() {
  interests = await getAll("interests");
  if (!interests.length) {
    for (const it of DEFAULT_INTERESTS) await put("interests", it);
    interests = await getAll("interests");
  }
  render();
}

init();
