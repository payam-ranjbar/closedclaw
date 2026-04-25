import type { Mount } from "./index.js";

export function resolveBindHost(mounts: Mount[]): string | null {
  if (mounts.length === 0) return null;
  if (mounts.some((m) => m.public)) return "0.0.0.0";
  return "127.0.0.1";
}
