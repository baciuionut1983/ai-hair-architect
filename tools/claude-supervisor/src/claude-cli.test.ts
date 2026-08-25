import { describe, expect, it } from "vitest";

import { RESUME_INSTRUCTION, buildLaunchArgs, buildResumeArgs, resolveClaudeBinary } from "./claude-cli.js";

describe("resolveClaudeBinary", () => {
  it("prefers an explicit env override when it exists on disk", () => {
    const result = resolveClaudeBinary({
      envOverride: "/custom/claude",
      candidates: ["/other/claude"],
      exists: (p: string) => p === "/custom/claude",
    });
    expect(result).toBe("/custom/claude");
  });

  it("ignores an env override that does not actually exist on disk", () => {
    const result = resolveClaudeBinary({
      envOverride: "/custom/claude",
      candidates: ["/other/claude"],
      exists: (p: string) => p === "/other/claude",
    });
    expect(result).toBe("/other/claude");
  });

  it("falls through the candidate list in order", () => {
    const result = resolveClaudeBinary({
      candidates: ["/first/claude", "/second/claude"],
      exists: (p: string) => p === "/second/claude",
    });
    expect(result).toBe("/second/claude");
  });

  // The exact real finding from this round's own Phase 0 audit: `claude`
  // bare is NOT assumed to resolve, so it must be reachable only via an
  // explicit candidate entry, never a hardcoded fallback inside this
  // function itself.
  it("returns null when nothing in the candidate list exists -- never silently assumes bare 'claude' works", () => {
    const result = resolveClaudeBinary({ candidates: ["/first/claude", "/second/claude"], exists: () => false });
    expect(result).toBeNull();
  });
});

describe("buildLaunchArgs", () => {
  it("includes the approved prompt VERBATIM, never paraphrased", () => {
    const args = buildLaunchArgs({
      sessionId: "11111111-1111-1111-1111-111111111111",
      prompt: "Exact approved prompt text, byte for byte.",
      permissionMode: "acceptEdits",
      cwd: "/repo",
    });
    const promptIndex = args.indexOf("-p");
    expect(args[promptIndex + 1]).toBe("Exact approved prompt text, byte for byte.");
  });

  it("pre-assigns the session id via --session-id rather than discovering it after launch", () => {
    const args = buildLaunchArgs({
      sessionId: "11111111-1111-1111-1111-111111111111",
      prompt: "task",
      permissionMode: "acceptEdits",
      cwd: "/repo",
    });
    const idIndex = args.indexOf("--session-id");
    expect(args[idIndex + 1]).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("always requests stream-json output -- the structured protocol, never plain text", () => {
    const args = buildLaunchArgs({ sessionId: "id", prompt: "task", permissionMode: "acceptEdits", cwd: "/repo" });
    const formatIndex = args.indexOf("--output-format");
    expect(args[formatIndex + 1]).toBe("stream-json");
  });

  it("passes through the requested permission mode exactly, never upgrading it to bypassPermissions", () => {
    const args = buildLaunchArgs({ sessionId: "id", prompt: "task", permissionMode: "manual", cwd: "/repo" });
    const modeIndex = args.indexOf("--permission-mode");
    expect(args[modeIndex + 1]).toBe("manual");
    expect(args).not.toContain("bypassPermissions");
    expect(args).not.toContain("--dangerously-skip-permissions");
  });

  it("never includes --resume -- a first launch is always a fresh session", () => {
    const args = buildLaunchArgs({ sessionId: "id", prompt: "task", permissionMode: "acceptEdits", cwd: "/repo" });
    expect(args).not.toContain("--resume");
  });

  // v1.2.1 root-cause fix: --permission-mode acceptEdits ALONE never
  // unlocks a real Write/Edit tool call in non-interactive -p mode --
  // confirmed live, repeatedly (see this round's own final report). An
  // explicit --allowedTools Write/Edit rule is required or every
  // Write/Edit is denied as "...which is a sensitive file", regardless
  // of the target path.
  it("includes an explicit --allowedTools rule authorizing Write and Edit -- required for real file edits in -p mode", () => {
    const args = buildLaunchArgs({ sessionId: "id", prompt: "task", permissionMode: "acceptEdits", cwd: "/repo" });
    const toolsIndex = args.indexOf("--allowedTools");
    expect(toolsIndex).toBeGreaterThanOrEqual(0);
    expect(args.slice(toolsIndex + 1, toolsIndex + 3)).toEqual(expect.arrayContaining([expect.stringContaining("Write"), expect.stringContaining("Edit")]));
  });
});

describe("buildResumeArgs", () => {
  it("resumes the exact given session id via --resume", () => {
    const args = buildResumeArgs({ sessionId: "22222222-2222-2222-2222-222222222222", prompt: RESUME_INSTRUCTION, permissionMode: "acceptEdits", cwd: "/repo" });
    const resumeIndex = args.indexOf("--resume");
    expect(args[resumeIndex + 1]).toBe("22222222-2222-2222-2222-222222222222");
  });

  it("uses the fixed, non-negotiable continuation instruction when explicitly passed -- never re-paraphrased per call", () => {
    const args = buildResumeArgs({ sessionId: "id", prompt: RESUME_INSTRUCTION, permissionMode: "acceptEdits", cwd: "/repo" });
    const promptIndex = args.indexOf("-p");
    expect(args[promptIndex + 1]).toContain("Continuă exact din starea actuală");
    expect(args[promptIndex + 1]).toContain("nu recrea munca finalizată");
  });

  // v1.2: the correction loop (Phase 2/7) resumes the SAME session with
  // a DIFFERENT fixed instruction (correction-loop.ts's own
  // buildCorrectionPrompt) -- prompt is now an explicit parameter, never
  // hardcoded inside this function, so both use cases share one argv
  // builder.
  it("accepts any explicit fixed prompt, e.g. a correction-loop prompt, not only RESUME_INSTRUCTION", () => {
    const args = buildResumeArgs({ sessionId: "id", prompt: "The following check failed: supervisor_typecheck", permissionMode: "acceptEdits", cwd: "/repo" });
    const promptIndex = args.indexOf("-p");
    expect(args[promptIndex + 1]).toBe("The following check failed: supervisor_typecheck");
  });

  it("never includes --session-id on a resume -- --resume alone identifies the session", () => {
    const args = buildResumeArgs({ sessionId: "id", prompt: RESUME_INSTRUCTION, permissionMode: "acceptEdits", cwd: "/repo" });
    expect(args).not.toContain("--session-id");
  });

  it("produces the identical resume instruction across repeated calls -- deterministic, not regenerated text", () => {
    const first = buildResumeArgs({ sessionId: "id", prompt: RESUME_INSTRUCTION, permissionMode: "acceptEdits", cwd: "/repo" });
    const second = buildResumeArgs({ sessionId: "id", prompt: RESUME_INSTRUCTION, permissionMode: "acceptEdits", cwd: "/repo" });
    expect(first).toEqual(second);
  });

  it("also includes the --allowedTools Write/Edit rule on resume, same as launch", () => {
    const args = buildResumeArgs({ sessionId: "id", prompt: RESUME_INSTRUCTION, permissionMode: "acceptEdits", cwd: "/repo" });
    expect(args.indexOf("--allowedTools")).toBeGreaterThanOrEqual(0);
  });
});
