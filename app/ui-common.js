// Shared rendering + wiring used by every app page. Pure string-generating
// functions (escapeHtml, paperCardHtml, navHtml) are unit-testable without
// a DOM; the DOM-wiring and IndexedDB-touching functions below them are not
// (verified manually in-browser), consistent with the rest of this app.
import { getAll, putMany, get, put, del, getSetting, setSetting } from "./db.js";

export function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

export function paperCardHtml(paper, isSaved) {
  const diffBadge = paper.difficulty
    ? `<span class="difficulty-badge">${escapeHtml(paper.difficulty)}</span>`
    : "";
  const laymanBox = paper.layman ? `<div class="layman-box">${escapeHtml(paper.layman)}</div>` : "";
  const tagsHtml = (paper.tags && paper.tags.length)
    ? `<div class="tags">${paper.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>`
    : "";
  const summary = escapeHtml(paper.summary || paper.abstract || "");
  const pdfLink = paper.pdf_url ? `<a href="${escapeHtml(paper.pdf_url)}" target="_blank" rel="noopener">PDF ↗</a>` : "";

  return `
    <div class="paper" data-id="${escapeHtml(paper.arxiv_id)}">
      ${diffBadge}
      <h3>${escapeHtml(paper.title)}</h3>
      ${laymanBox}
      <div class="summary">${summary}</div>
      ${tagsHtml}
      <div class="paper-footer">
        <span class="category-tag">${escapeHtml(paper.primary_category || paper.source || "")}</span>
        <span class="date">${escapeHtml(paper.published || "")}</span>
      </div>
      <div class="links">
        <a href="${escapeHtml(paper.abs_url || "#")}" target="_blank" rel="noopener">Abstract ↗</a>
        ${pdfLink}
        <button class="save-btn" data-save-id="${escapeHtml(paper.arxiv_id)}" aria-pressed="${isSaved ? "true" : "false"}">${isSaved ? "★ Saved" : "☆ Save"}</button>
      </div>
    </div>`;
}

export const ALL_SOURCES = ["arxiv", "semanticscholar", "openreview"];

export function interestRowHtml(interest, index) {
  const sourcesHtml = ALL_SOURCES.map((s) => {
    const checked = (interest.sources || []).includes(s) ? "checked" : "";
    return `<label><input type="checkbox" data-field="source" data-source="${s}" ${checked}/> ${s}</label>`;
  }).join("");
  return `
    <div class="interest-row" data-index="${index}">
      <label>Name</label>
      <input type="text" data-field="name" value="${escapeHtml(interest.name || "")}" />
      <label>Keywords (comma-separated)</label>
      <input type="text" data-field="keywords" value="${escapeHtml((interest.keywords || []).join(", "))}" />
      <label>Sources</label>
      <div class="sources">${sourcesHtml}</div>
      <label><input type="checkbox" data-field="enabled" ${interest.enabled !== false ? "checked" : ""}/> Enabled</label>
      <div class="links"><button class="btn btn-danger" data-action="delete" type="button">Delete</button></div>
    </div>`;
}

const NAV_LINKS = [
  ["digest.html", "Digest"],
  ["search.html", "Search"],
  ["saved.html", "Saved"],
  ["settings.html", "Settings"],
];

// Same glyph as icons/icon.svg / index.html's landing-page mark — kept in
// sync by hand since there are only these two places it appears.
const BRAND_GLYPH_SVG = `<svg class="brand-glyph" viewBox="0 0 512 512" aria-hidden="true">
        <path d="M256,168 C256,158 250,152 240,155 L128,136 C111,133 98,146 98,163
                 L98,362 C98,379 111,392 128,389 L240,370 C250,368 256,360 256,350 Z" fill="#d4d4dc" />
        <path d="M256,168 C256,158 262,152 272,155 L384,136 C401,133 414,146 414,163
                 L414,362 C414,379 401,392 384,389 L272,370 C262,368 256,360 256,350 Z" fill="#e8e8ee" />
        <rect x="251" y="152" width="10" height="204" rx="4" fill="#9a9aa4" />
      </svg>`;

export function navHtml(active) {
  const links = NAV_LINKS
    .map(([href, label]) => `<a href="${href}"${href === active ? ' class="active"' : ""}>${label}</a>`)
    .join("\n        ");
  return `
    <div class="topbar">
      <a class="brand" href="../index.html">${BRAND_GLYPH_SVG} Research Digest</a>
      <nav>
        ${links}
        <button id="refresh-btn" class="refresh-btn" type="button" title="Fetch and summarize new papers">Refresh</button>
      </nav>
    </div>
    <div id="status-line" class="status-line" hidden></div>`;
}

// --- DOM/IndexedDB glue (not unit-tested; verified manually in-browser) ---

export async function ensureSeedImported() {
  const already = await getSetting("last_seed_import_at", null);
  if (already) return false;
  const existing = await getAll("papers");
  if (existing.length > 0) {
    await setSetting("last_seed_import_at", new Date().toISOString());
    return false;
  }
  try {
    const res = await fetch("/seed-corpus.json");
    if (!res.ok) return false;
    const papers = await res.json();
    if (Array.isArray(papers) && papers.length) {
      await putMany("papers", papers);
    }
    await setSetting("last_seed_import_at", new Date().toISOString());
    return true;
  } catch (err) {
    console.warn("ui-common: seed import failed", err);
    return false;
  }
}

export async function getSavedIdSet() {
  const rows = await getAll("saved");
  return new Set(rows.map((r) => r.arxiv_id));
}

export async function toggleSave(arxivId, isCurrentlySaved, source = "digest") {
  if (isCurrentlySaved) {
    await del("saved", arxivId);
  } else {
    await put("saved", { arxiv_id: arxivId, saved_at: new Date().toISOString(), source });
  }
  return !isCurrentlySaved;
}

// Delegated click handler for every "Save"/"Saved" button inside `container`.
// Flips IndexedDB state and the button's own label/aria-pressed in place —
// callers don't need to re-render the whole list on every click.
export function wireSaveButtons(container, source = "digest", onToggled = null) {
  container.addEventListener("click", async (event) => {
    const btn = event.target.closest(".save-btn");
    if (!btn) return;
    const id = btn.dataset.saveId;
    const wasSaved = btn.getAttribute("aria-pressed") === "true";
    btn.disabled = true;
    try {
      const nowSaved = await toggleSave(id, wasSaved, source);
      btn.setAttribute("aria-pressed", String(nowSaved));
      btn.textContent = nowSaved ? "★ Saved" : "☆ Save";
      if (onToggled) onToggled(id, nowSaved);
    } finally {
      btn.disabled = false;
    }
  });
}

// Like wireSaveButtons, but for results that may not exist in the local
// corpus yet (live search results, not yet fetched by any interest) —
// saving one also upserts it into the papers store first, so it shows up
// in the digest and can feed the save→future-fetch feedback loop and
// "related papers", the same as anything the pipeline fetched itself.
export function wireSearchSaveButtons(container, getResultById, source = "search") {
  container.addEventListener("click", async (event) => {
    const btn = event.target.closest(".save-btn");
    if (!btn) return;
    const id = btn.dataset.saveId;
    const wasSaved = btn.getAttribute("aria-pressed") === "true";
    btn.disabled = true;
    try {
      if (!wasSaved) {
        const paper = getResultById(id);
        if (paper) await put("papers", paper);
      }
      const nowSaved = await toggleSave(id, wasSaved, source);
      btn.setAttribute("aria-pressed", String(nowSaved));
      btn.textContent = nowSaved ? "★ Saved" : "☆ Save";
    } finally {
      btn.disabled = false;
    }
  });
}

export function setStatus(text) {
  const el = document.getElementById("status-line");
  if (!el) return;
  if (!text) {
    el.hidden = true;
    el.textContent = "";
  } else {
    el.hidden = false;
    el.textContent = text;
  }
}
