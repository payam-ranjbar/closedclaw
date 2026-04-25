import {
  closeSync,
  openSync,
  readSync,
  statSync,
  unwatchFile,
  watchFile,
} from "node:fs";
import { join } from "node:path";

const CHUNK = 4096;

function tailBytes(path: string, lines: number): Buffer {
  const fd = openSync(path, "r");
  try {
    const size = statSync(path).size;
    if (size === 0) return Buffer.alloc(0);
    let pos = size;
    const collected: Buffer[] = [];
    let newlines = 0;
    while (pos > 0 && newlines <= lines) {
      const readLen = Math.min(CHUNK, pos);
      pos -= readLen;
      const buf = Buffer.alloc(readLen);
      readSync(fd, buf, 0, readLen, pos);
      for (let i = buf.length - 1; i >= 0; i--) {
        if (buf[i] === 0x0a) {
          newlines++;
          if (newlines > lines) {
            collected.unshift(buf.subarray(i + 1));
            return Buffer.concat(collected);
          }
        }
      }
      collected.unshift(buf);
    }
    return Buffer.concat(collected);
  } finally {
    closeSync(fd);
  }
}

function readRange(path: string, start: number, end: number): Buffer {
  const len = end - start;
  if (len <= 0) return Buffer.alloc(0);
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, start);
    return buf;
  } finally {
    closeSync(fd);
  }
}

export async function runLog(args: {
  workspace: string;
  lines: number;
  follow: boolean;
  out: NodeJS.WritableStream;
  err: NodeJS.WritableStream;
  signal?: AbortSignal;
  pollIntervalMs?: number;
}): Promise<number> {
  const path = join(args.workspace, "system.log");
  const interval = args.pollIntervalMs ?? 200;

  let exists = true;
  let offset = 0;
  try {
    const st = statSync(path);
    offset = st.size;
    const tail = tailBytes(path, args.lines);
    args.out.write(tail);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") exists = false;
    else throw e;
  }
  if (!exists && !args.follow) {
    args.out.write("(no system.log yet)\n");
    return 0;
  }
  if (!args.follow) return 0;

  return new Promise<number>((resolve) => {
    const onChange = (curr: { size: number }, _prev: { size: number }) => {
      if (!exists) { exists = true; offset = 0; }
      if (curr.size < offset) offset = 0;
      if (curr.size > offset) {
        const chunk = readRange(path, offset, curr.size);
        args.out.write(chunk);
        offset = curr.size;
      }
    };
    watchFile(path, { interval }, onChange);
    const stop = (): void => {
      unwatchFile(path, onChange);
      args.out.write("\n");
      resolve(0);
    };
    if (args.signal?.aborted) { stop(); return; }
    args.signal?.addEventListener("abort", stop, { once: true });
  });
}
