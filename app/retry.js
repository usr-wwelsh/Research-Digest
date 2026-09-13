// Retry policy for relay calls. Only transient classes retry — a 4xx means
// the request itself is wrong and will fail identically every time.
const DEFAULT_RETRIES = 2;
const DEFAULT_BASE_MS = 500;

export function isTransient(err) {
  if (!err) return false;
  if (err.status == null) return true;
  return err.status === 429 || err.status >= 500;
}

// relay.py answers its own rate limiter with Retry-After: 1; honouring that
// beats guessing, and stops a retry landing inside the same closed window.
// Only the delta-seconds form is read — an HTTP-date falls back to backoff.
export function retryAfterMs(err) {
  const raw = err && err.retryAfter;
  if (raw == null) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

export function backoffDelay(attempt, baseMs = DEFAULT_BASE_MS, random = Math.random) {
  return Math.round(baseMs * 2 ** attempt * (0.5 + random() * 0.5));
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withRetry(fn, options = {}) {
  const {
    retries = DEFAULT_RETRIES,
    baseMs = DEFAULT_BASE_MS,
    sleep = defaultSleep,
    random = Math.random,
    shouldRetry = isTransient,
  } = options;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !shouldRetry(err)) throw err;
      await sleep(retryAfterMs(err) ?? backoffDelay(attempt, baseMs, random));
    }
  }
}
