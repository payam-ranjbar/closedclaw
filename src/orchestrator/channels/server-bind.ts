import type { Mount } from "./index.js";

export type BindHost = "0.0.0.0" | "127.0.0.1" | null;

export function resolveBindHost(mounts: Mount[]): BindHost {
  if (mounts.length === 0) return null;
  if (mounts.some((m) => m.public)) return "0.0.0.0";
  return "127.0.0.1";
}
