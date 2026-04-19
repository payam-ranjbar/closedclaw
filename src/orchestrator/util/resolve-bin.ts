export interface ResolvedBin {
  command: string;
  prefixArgs: string[];
}

// Node >=20.12 blocks spawn(".cmd") with EINVAL (CVE-2024-27980 mitigation).
// Invoke via cmd.exe; Node escapes each argv element safely when the executable
// is cmd.exe, so this is not equivalent to shell:true and does not concatenate
// user-controlled payload into a shell string.
export function resolveBin(name: string): ResolvedBin {
  if (process.platform === "win32") {
    return { command: process.env.ComSpec ?? "cmd.exe", prefixArgs: ["/d", "/s", "/c", `${name}.cmd`] };
  }
  return { command: name, prefixArgs: [] };
}
