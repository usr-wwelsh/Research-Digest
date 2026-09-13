// Retry policy for relay calls. Only transient classes retry — a 4xx means
// the request itself is wrong and will fail identically every time.
const DEFAULT_RETRIES = 2;
const DEFAULT_BASE_MS = 500;

export function isTransient(err) {
  if (!err) return false;
  if (err.status == null) return true;
  return err.status === 429 || err.status >= 500;
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
      await sleep(backoffDelay(attempt, baseMs, random));
    }
  }
}
