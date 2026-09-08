// Papers per batched model call, scaled to navigator.deviceMemory (undefined on many browsers — falls back to 4).
export function computeBatchSize(deviceMemoryGiB) {
  if (!deviceMemoryGiB) return 4;
  if (deviceMemoryGiB <= 2) return 2;
  if (deviceMemoryGiB <= 4) return 4;
  if (deviceMemoryGiB <= 8) return 8;
  return 12;
}
