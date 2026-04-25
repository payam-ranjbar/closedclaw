import { describe, it, expect } from "vitest";
import { resolveBindHost } from "../src/orchestrator/channels/server-bind.js";
import type { Mount } from "../src/orchestrator/channels/index.js";

const m = (path: string, isPublic: boolean): Mount => ({
  method: "POST",
  path,
  handler: (_req, _res) => {},
  public: isPublic,
});

describe("resolveBindHost", () => {
  it("returns null when no routes are mounted", () => {
    expect(resolveBindHost([])).toBeNull();
  });

  it("returns 127.0.0.1 when only private routes are mounted", () => {
    expect(resolveBindHost([m("/healthz", false)])).toBe("127.0.0.1");
  });

  it("returns 0.0.0.0 when any public route is mounted", () => {
    expect(resolveBindHost([m("/webhooks/telegram", true)])).toBe("0.0.0.0");
  });

  it("returns 0.0.0.0 when both private and public routes are mounted", () => {
    expect(resolveBindHost([m("/healthz", false), m("/webhooks/telegram", true)])).toBe("0.0.0.0");
  });

  it("returns 0.0.0.0 when multiple public routes are mounted", () => {
    expect(resolveBindHost([m("/a", true), m("/b", true)])).toBe("0.0.0.0");
  });
});
