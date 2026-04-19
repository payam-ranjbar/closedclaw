import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCronSpecs } from "../src/orchestrator/triggers/cron.js";

describe("loadCronSpecs", () => {
  let ws: string;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "cc-cron-"));
    mkdirSync(join(ws, "agents/backend-dev"), { recursive: true });
  });

  it("unions workspace-level and per-agent crons.yaml", async () => {
    writeFileSync(join(ws, "crons.yaml"), `
- id: sys-rotate
  schedule: "0 0 * * *"
  agent: host
  payload: rotate
  reply_to: null
    `);
    writeFileSync(join(ws, "agents/backend-dev/crons.yaml"), `
- id: be-dream
  schedule: "0 3 * * *"
  agent: backend-dev
  payload: dream
  reply_to: null
    `);
    const specs = await loadCronSpecs(ws);
    expect(specs.map(s => s.id).sort()).toEqual(["be-dream", "sys-rotate"]);
  });

  it("throws on duplicate id across files", async () => {
    writeFileSync(join(ws, "crons.yaml"), `
- id: dup
  schedule: "0 0 * * *"
  agent: host
  payload: x
  reply_to: null
    `);
    writeFileSync(join(ws, "agents/backend-dev/crons.yaml"), `
- id: dup
  schedule: "0 1 * * *"
  agent: backend-dev
  payload: y
  reply_to: null
    `);
    await expect(loadCronSpecs(ws)).rejects.toThrow(/duplicate/i);
  });
});
