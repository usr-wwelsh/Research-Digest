import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const sw = readFileSync(join(appDir, "..", "sw.js"), "utf8");

// Built by esbuild into vendor/, never loaded by the browser directly.
const BUILD_ONLY = new Set(["vendor-entry.js"]);

function appModules(dir = appDir, prefix = "") {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["tests", "node_modules", "vendor"].includes(entry.name)) continue;
    if (entry.isDirectory()) out.push(...appModules(join(dir, entry.name), `${prefix}${entry.name}/`));
    else if (entry.name.endsWith(".js")) out.push(`${prefix}${entry.name}`);
  }
  return out;
}

test("every app module is precached, so the shell can't ship half-stale", () => {
  const listed = new Set([...sw.matchAll(/"\/app\/([^"]+)"/g)].map((m) => m[1]));
  const missing = appModules().filter((f) => !BUILD_ONLY.has(f) && !listed.has(f));
  assert.deepEqual(missing, [], `add these to PRECACHE_URLS in sw.js: ${missing.join(", ")}`);
});

test("precache entries all point at files that exist", () => {
  const onDisk = new Set(appModules());
  const stale = [...sw.matchAll(/"\/app\/([^"]+\.js)"/g)]
    .map((m) => m[1])
    .filter((f) => !f.startsWith("vendor/") && !onDisk.has(f));
  assert.deepEqual(stale, [], `these are precached but gone: ${stale.join(", ")}`);
});
