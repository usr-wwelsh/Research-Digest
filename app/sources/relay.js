// Shared transport for all three source adapters — every call goes through
// relay.py, so they share one timeout and retry policy. The body is read
// inside the retried region: a truncated response is as transient as a
// dropped connection.
import { withRetry } from "../retry.js";

const DEFAULT_TIMEOUT_MS = 15000;

async function relayFetch(url, label, read, { timeoutMs = DEFAULT_TIMEOUT_MS, ...retryOptions } = {}) {
  return withRetry(async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      const err = new Error(`${label} relay error: ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return read(res);
  }, retryOptions);
}

export function relayText(url, label, options) {
  return relayFetch(url, label, (res) => res.text(), options);
}

export function relayJson(url, label, options) {
  return relayFetch(url, label, (res) => res.json(), options);
}
