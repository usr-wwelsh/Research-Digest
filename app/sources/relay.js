// Shared transport for all three source adapters — every call goes through
// relay.py, so they share one timeout and retry policy. The body is read
// inside the retried region: a truncated response is as transient as a
// dropped connection.
import { withRetry } from "../retry.js";

// Longer than relay.py's own UPSTREAM_TIMEOUT (15s) so a slow upstream comes
// back as the relay's 502 rather than an abort here that tells us nothing.
const DEFAULT_TIMEOUT_MS = 20000;

// relay.py meters each source at 1 req/sec (TokenBucket, capacity 3). A fetch
// cycle hits one source once per interest back-to-back, so without pacing the
// fourth interest onward is rate-limited by our own relay before arXiv ever
// sees it.
const DEFAULT_MIN_INTERVAL_MS = 1100;

const nextSlot = new Map();
const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pace(label, minIntervalMs, now, sleep) {
  if (!minIntervalMs) return;
  const t = now();
  const at = Math.max(t, nextSlot.get(label) || 0);
  nextSlot.set(label, at + minIntervalMs);
  if (at > t) await sleep(at - t);
}

async function relayFetch(url, label, read, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
    now = Date.now,
    sleep = realSleep,
    ...retryOptions
  } = options;
  return withRetry(async () => {
    await pace(label, minIntervalMs, now, sleep);
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      const err = new Error(`${label} relay error: ${res.status}`);
      err.status = res.status;
      err.retryAfter = res.headers && res.headers.get("Retry-After");
      throw err;
    }
    return read(res);
  }, { sleep, ...retryOptions });
}

export function relayText(url, label, options) {
  return relayFetch(url, label, (res) => res.text(), options);
}

export function relayJson(url, label, options) {
  return relayFetch(url, label, (res) => res.json(), options);
}
