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

// byId: optional Map(arxiv_id -> paper) used to resolve paper.related (an
// array of arxiv_ids from relate.js, computed worker-side) into titles/links.
// Omitted by callers that don't have the full corpus loaded (e.g. live
// search results, which have no .related anyway).
function relatedHtml(paper, byId) {
  if (!paper.related || !paper.related.length || !byId) return "";
  const items = paper.related
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((p) => `<a href="${escapeHtml(p.abs_url || "#")}" target="_blank" rel="noopener">${escapeHtml(p.title)}</a>`);
  if (!items.length) return "";
  return `<div class="related"><span class="related-label">Related:</span> ${items.join(" &middot; ")}</div>`;
}

export function paperCardHtml(paper, isSaved, byId = null) {
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
      ${relatedHtml(paper, byId)}
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

export function slugify(name) {
  return (name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "") || `interest-${Date.now()}`;
}

// Pure aggregation over the local corpus, split from the HTML renderer
// below so the counting logic is unit-testable without a DOM.
export function corpusStats(papers, savedCount) {
  const total = papers.length;
  const summarized = papers.filter((p) => p.summary).length;
  const pct = total ? Math.round((summarized / total) * 100) : 0;
  return { total, summarized, pct, saved: savedCount };
}

export function corpusStatsHtml(stats) {
  const paperWord = stats.total === 1 ? "paper" : "papers";
  const savedWord = stats.saved === 1 ? "paper" : "papers";
  return `${stats.total} ${paperWord} on this device &middot; ${stats.summarized} summarized (${stats.pct}%) &middot; ${stats.saved} ${savedWord} saved`;
}

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
  ["library.html", "Library"],
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

// done/total come from models.worker.js's queue counters, so total is
// always a real positive count when present — still clamp defensively
// since this also has to tolerate a bare string/null status.
export function progressPercent(done, total) {
  if (!total || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

// status: a plain string (most callers — fetchNewPapers, "Saved.", error
// messages), null/undefined (clear), or {message, done, total} (worker
// summarize progress, see models.worker.js's currentStatus()) which also
// renders a progress bar.
export function setStatus(status) {
  const el = document.getElementById("status-line");
  if (!el) return;
  const message = typeof status === "string" ? status : status && status.message;
  if (!message) {
    el.hidden = true;
    el.innerHTML = "";
    el.classList.remove("has-progress");
    return;
  }
  const hasProgress = typeof status === "object" && Number.isFinite(status.total) && status.total > 0;
  el.hidden = false;
  el.classList.toggle("has-progress", hasProgress);
  el.innerHTML = hasProgress
    ? `<span class="status-text">${escapeHtml(message)}</span>` +
      `<div class="status-bar"><div class="status-bar-fill" style="width: ${progressPercent(status.done, status.total)}%"></div></div>`
    : escapeHtml(message);
}
