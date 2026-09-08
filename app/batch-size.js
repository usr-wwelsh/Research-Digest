// Chooses how many papers to summarize/embed per batched model call.
// navigator.deviceMemory (Chrome/Android only; undefined on Firefox/Safari
// and desktop-class devices report `undefined` too on some builds) reports a
// rounded, capped-at-8-GiB estimate — used to keep batch size (and the
// tokenizer padding cost a larger batch brings) proportional to what a
// cheap phone can actually hold, without requiring the API to exist.
export function computeBatchSize(deviceMemoryGiB) {
  if (!deviceMemoryGiB) return 4;
  if (deviceMemoryGiB <= 2) return 2;
  if (deviceMemoryGiB <= 4) return 4;
  if (deviceMemoryGiB <= 8) return 8;
  return 12;
}
