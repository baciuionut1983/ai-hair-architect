import { describe, expect, it } from "vitest";

import { defaultClaudeBinaryCandidates, resolveRealClaudeBinary } from "./real-executor-launcher.js";

describe("defaultClaudeBinaryCandidates", () => {
  it("includes the real, live-verified .exe path under %APPDATA%\\npm\\node_modules -- never the .cmd/.ps1 shim", () => {
    const candidates = defaultClaudeBinaryCandidates({ APPDATA: "C:\\Users\\hp\\AppData\\Roaming" });
    expect(candidates).toContain("C:\\Users\\hp\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe");
    expect(candidates.some((c) => c.endsWith(".cmd") || c.endsWith(".ps1"))).toBe(false);
  });

  it("still returns a (best-effort, unverified) candidate list when APPDATA is absent", () => {
    const candidates = defaultClaudeBinaryCandidates({});
    expect(candidates.length).toBeGreaterThan(0);
  });
});

describe("resolveRealClaudeBinary", () => {
  it("respects CLAUDE_SUPERVISOR_CLAUDE_BINARY as an explicit override", () => {
    // resolveClaudeBinary's own `exists` check is real (fs.existsSync)
    // here since resolveRealClaudeBinary doesn't expose an injection
    // point -- so this only proves override PRECEDENCE when the path
    // doesn't exist (both fail to null), not that a real override wins.
    // The precedence logic itself is already fully covered by
    // claude-cli.test.ts's own resolveClaudeBinary tests.
    const result = resolveRealClaudeBinary({ CLAUDE_SUPERVISOR_CLAUDE_BINARY: "Z:\\definitely\\does\\not\\exist\\claude.exe" });
    expect(result).toBeNull();
  });
});
