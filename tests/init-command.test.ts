import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../src/commands/init.js";

describe("init command", () => {
  let target: string;
  beforeEach(() => { target = join(mkdtempSync(join(tmpdir(), "cc-init-")), "ws"); });

  it("creates the workspace structure with all required files", async () => {
    await runInit({ workspace: target, force: false });
    expect(existsSync(join(target, "agents.json"))).toBe(true);
    expect(existsSync(join(target, "crons.yaml"))).toBe(true);
    expect(existsSync(join(target, ".env.example"))).toBe(true);
    expect(existsSync(join(target, "state/secrets.json"))).toBe(true);
    expect(existsSync(join(target, "agents/host/CLAUDE.md"))).toBe(true);
    expect(existsSync(join(target, "agents/host/.claude/settings.json"))).toBe(true);
    expect(existsSync(join(target, "agents/backend-dev/.claude/agents/api-writer.md"))).toBe(true);
  });

  it("substitutes workspace and timestamp placeholders in agents.json", async () => {
    await runInit({ workspace: target, force: false });
    const registry = JSON.parse(readFileSync(join(target, "agents.json"), "utf8"));
    expect(registry.host.cwd).toContain(target);
    expect(registry.host.createdAt).toMatch(/^\d{4}-/);
  });

  it("refuses to overwrite existing workspace without force", async () => {
    await runInit({ workspace: target, force: false });
    await expect(runInit({ workspace: target, force: false })).rejects.toThrow(/already exists/i);
  });

  it("allows overwriting with force", async () => {
    await runInit({ workspace: target, force: false });
    await runInit({ workspace: target, force: true });
    expect(existsSync(join(target, "agents.json"))).toBe(true);
  });

  it("generates a non-empty secrets.json with telegramWebhookSecret", async () => {
    await runInit({ workspace: target, force: false });
    const secrets = JSON.parse(readFileSync(join(target, "state/secrets.json"), "utf8"));
    expect(secrets.telegramWebhookSecret).toMatch(/^[a-f0-9]{32,}$/);
  });
});
