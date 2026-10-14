export function withFallback(...sources) {
  const attempt = (method) => async (...args) => {
    let lastError;
    for (const source of sources) {
      try {
        return await source[method](...args);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  };
  return { fetchForInterest: attempt("fetchForInterest"), search: attempt("search") };
}
