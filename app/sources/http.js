import { withRetry } from "../retry.js";

const DEFAULT_TIMEOUT_MS = 20000;

async function httpFetch(url, label, read, options = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, sleep, ...retryOptions } = options;
  return withRetry(async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      const err = new Error(`${label} error: ${res.status}`);
      err.status = res.status;
      err.retryAfter = res.headers && res.headers.get("Retry-After");
      throw err;
    }
    return read(res);
  }, { sleep, ...retryOptions });
}

export function getJson(url, label, options) {
  return httpFetch(url, label, (res) => res.json(), options);
}
