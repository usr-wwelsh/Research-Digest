import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, paperCardHtml, navHtml, interestRowHtml } from "../ui-common.js";

test("escapeHtml escapes all five special characters", () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
});

test("escapeHtml treats null/undefined as empty string", () => {
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
});

test("paperCardHtml escapes the title so it cannot inject markup", () => {
  const html = paperCardHtml({ arxiv_id: "a", title: "<script>alert(1)</script>" }, false);
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("paperCardHtml renders a Save button reflecting saved state", () => {
  const unsaved = paperCardHtml({ arxiv_id: "a", title: "T" }, false);
  const saved = paperCardHtml({ arxiv_id: "a", title: "T" }, true);
  assert.match(unsaved, /aria-pressed="false"/);
  assert.match(unsaved, />☆ Save</);
  assert.match(saved, /aria-pressed="true"/);
  assert.match(saved, />★ Saved</);
});

test("paperCardHtml omits the layman box and tags when absent", () => {
  const html = paperCardHtml({ arxiv_id: "a", title: "T" }, false);
  assert.ok(!html.includes("layman-box"));
  assert.ok(!html.includes('class="tags"'));
});

test("paperCardHtml includes the layman box and tags when present", () => {
  const html = paperCardHtml({ arxiv_id: "a", title: "T", layman: "Explains it simply.", tags: ["edge", "efficient"] }, false);
  assert.ok(html.includes("layman-box"));
  assert.ok(html.includes(">edge<"));
  assert.ok(html.includes(">efficient<"));
});

test("paperCardHtml omits the PDF link when pdf_url is missing", () => {
  const withPdf = paperCardHtml({ arxiv_id: "a", title: "T", pdf_url: "https://x/y.pdf" }, false);
  const withoutPdf = paperCardHtml({ arxiv_id: "a", title: "T", pdf_url: null }, false);
  assert.ok(withPdf.includes("PDF"));
  assert.ok(!withoutPdf.includes("PDF"));
});

test("paperCardHtml omits related papers when byId is not given", () => {
  const html = paperCardHtml({ arxiv_id: "a", title: "T", related: ["b"] }, false);
  assert.ok(!html.includes("related-label"));
});

test("paperCardHtml omits related papers when none resolve in byId", () => {
  const html = paperCardHtml({ arxiv_id: "a", title: "T", related: ["missing"] }, false, new Map());
  assert.ok(!html.includes("related-label"));
});

test("paperCardHtml lists resolvable related papers as links", () => {
  const byId = new Map([
    ["b", { arxiv_id: "b", title: "Paper B", abs_url: "https://arxiv.org/abs/b" }],
    ["c", { arxiv_id: "c", title: "Paper C", abs_url: "https://arxiv.org/abs/c" }],
  ]);
  const html = paperCardHtml({ arxiv_id: "a", title: "T", related: ["b", "c", "missing"] }, false, byId);
  assert.ok(html.includes("related-label"));
  assert.ok(html.includes('href="https://arxiv.org/abs/b"'));
  assert.ok(html.includes(">Paper B<"));
  assert.ok(html.includes(">Paper C<"));
  assert.ok(!html.includes("missing"));
});

test("interestRowHtml checks only the interest's own enabled sources", () => {
  const html = interestRowHtml({ name: "X", keywords: ["a"], sources: ["arxiv"] }, 0);
  const arxivMatch = html.match(/data-source="arxiv"[^/]*\/>/)[0];
  const s2Match = html.match(/data-source="semanticscholar"[^/]*\/>/)[0];
  assert.ok(arxivMatch.includes("checked"));
  assert.ok(!s2Match.includes("checked"));
});

test("interestRowHtml joins keywords with a comma for editing", () => {
  const html = interestRowHtml({ name: "X", keywords: ["edge", "efficient"] }, 0);
  assert.ok(html.includes('value="edge, efficient"'));
});

test("interestRowHtml treats enabled as true unless explicitly false", () => {
  const enabledHtml = interestRowHtml({ name: "X" }, 0);
  const disabledHtml = interestRowHtml({ name: "X", enabled: false }, 0);
  assert.match(enabledHtml, /data-field="enabled" checked/);
  assert.doesNotMatch(disabledHtml, /data-field="enabled" checked/);
});

test("navHtml marks the active page's link", () => {
  const html = navHtml("search.html");
  assert.match(html, /href="search\.html" class="active"/);
  assert.ok(!html.includes('href="digest.html" class="active"'));
});
