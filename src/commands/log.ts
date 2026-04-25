import { closeSync, openSync, readSync, statSync } from "node:fs";
import { join } from "node:path";

const CHUNK = 4096;

function tailBytes(path: string, lines: number): Buffer {
  const fd = openSync(path, "r");
  try {
    const size = statSync(path).size;
    if (size === 0) return Buffer.alloc(0);
    let pos = size;
    let collected: Buffer[] = [];
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

export async function runLog(args: {
  workspace: string;
  lines: number;
  follow: boolean;
  out: NodeJS.WritableStream;
  err: NodeJS.WritableStream;
}): Promise<number> {
  const path = join(args.workspace, "system.log");
  let exists = true;
  try { statSync(path); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") exists = false;
    else throw e;
  }
  if (!exists) {
    if (!args.follow) {
      args.out.write("(no system.log yet)\n");
      return 0;
    }
  } else {
    const tail = tailBytes(path, args.lines);
    args.out.write(tail);
  }
  if (!args.follow) return 0;
  return 0;
}
