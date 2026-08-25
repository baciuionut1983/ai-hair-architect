import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createExecutorCanUseTool,
  EXECUTOR_ALLOWED_TOOLS,
  EXECUTOR_DISALLOWED_TOOLS,
  EXECUTOR_PERMISSION_MODE,
  isPathWithinCwd,
  resolveCanonicalContainment,
} from "./agent-sdk-permission-policy.js";

const FAKE_CWD = "C:\\repo";

function fakeCanUseToolOptions(): Parameters<ReturnType<typeof createExecutorCanUseTool>>[2] {
  return { signal: new AbortController().signal, toolUseID: "tool-use-1", requestId: "request-1" };
}

describe("EXECUTOR_ALLOWED_TOOLS / EXECUTOR_DISALLOWED_TOOLS / EXECUTOR_PERMISSION_MODE", () => {
  it("is exactly Read, Write, Edit -- the literal Phase 3 minimum, confirmed with the user (no Glob/Grep/Bash)", () => {
    expect(EXECUTOR_ALLOWED_TOOLS).toEqual(["Read", "Write", "Edit"]);
  });

  it("explicitly disallows Bash, WebFetch, WebSearch, Task, and NotebookEdit", () => {
    expect(EXECUTOR_DISALLOWED_TOOLS).toEqual(["Bash", "WebFetch", "WebSearch", "Task", "NotebookEdit"]);
  });

  it("never uses acceptEdits or bypassPermissions -- always default", () => {
    expect(EXECUTOR_PERMISSION_MODE).toBe("default");
  });
});

// v1.3.1: a real, live clean-path isolation test proved cwd itself gives
// zero filesystem containment (an out-of-cwd Read/Edit succeeded with no
// denial), and that resolving the tool's own file_path against cwd here
// DOES provide real containment (the same out-of-cwd Read/Edit was
// blocked once this check existed, while an in-cwd edit still worked
// normally). These tests pin the PURE LEXICAL primitive's own behavior
// -- it never touches the filesystem, so a nonexistent FAKE_CWD is fine
// here (unlike resolveCanonicalContainment below, which does).
describe("isPathWithinCwd (pure, lexical only)", () => {
  it("accepts the cwd itself", () => {
    expect(isPathWithinCwd(FAKE_CWD, "C:\\repo")).toBe(true);
  });

  it("accepts an absolute path nested inside cwd", () => {
    expect(isPathWithinCwd(FAKE_CWD, "C:\\repo\\tools\\claude-supervisor\\fixtures\\marker.txt")).toBe(true);
  });

  it("accepts a relative path (resolved against cwd)", () => {
    expect(isPathWithinCwd(FAKE_CWD, "tools\\claude-supervisor\\fixtures\\marker.txt")).toBe(true);
  });

  it("rejects an absolute path outside cwd, even a sibling directory with a similar name", () => {
    expect(isPathWithinCwd(FAKE_CWD, "C:\\repo-other\\marker.txt")).toBe(false);
    expect(isPathWithinCwd(FAKE_CWD, "C:\\elsewhere\\marker.txt")).toBe(false);
  });

  it("rejects a relative path that escapes cwd via ..", () => {
    expect(isPathWithinCwd(FAKE_CWD, "..\\outside-fixture.txt")).toBe(false);
  });

  it("is case-insensitive, matching Windows path semantics", () => {
    expect(isPathWithinCwd(FAKE_CWD, "c:\\REPO\\Tools\\Marker.txt")).toBe(true);
  });
});

// v1.3.2: real capability probe, run once at module load. This
// environment was empirically found to lack the privilege to create
// real NTFS symlinks (EPERM -- no Administrator elevation, no Developer
// Mode enabled) but CAN create Windows directory junctions without
// elevation. Symlink-specific tests below are explicitly SKIPPED (not
// silently omitted -- a console.warn fires, and this round's own final
// report states this exact gap) when this is false. Junction tests
// still exercise the identical OS-level realpath/GetFinalPathNameByHandle
// resolution path a real symlink would, so coverage of the actual
// containment LOGIC is not reduced -- only the specific "is this really
// an NTFS symlink and not a junction" distinction goes untested here.
function probeFileSymlinkSupport(): boolean {
  const probeDir = mkdtempSync(join(tmpdir(), "claude-supervisor-symlink-capability-"));
  try {
    writeFileSync(join(probeDir, "target.txt"), "x");
    symlinkSync(join(probeDir, "target.txt"), join(probeDir, "link.txt"), "file");
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
}

const SYMLINKS_SUPPORTED = probeFileSymlinkSupport();
if (!SYMLINKS_SUPPORTED) {
  console.warn(
    "[agent-sdk-permission-policy.test.ts] Real NTFS symlink containment tests SKIPPED: this environment cannot create symlinks (no Administrator elevation / Developer Mode). Junction-based tests still run for real against the same OS-level realpath resolution path. See this round's own final report.",
  );
}

// v1.3.2: real, filesystem-backed tests -- see git-inspect.test.ts's own
// established convention for boundary-critical modules in this package:
// prove the resolution is correct against a REAL OS filesystem, never a
// hand-written fixture that might not match what the OS actually does.
// This is the exact module responsible for closing the symlink/junction
// containment gap this round's own task spec names.
describe("resolveCanonicalContainment (real filesystem)", () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "claude-supervisor-containment-root-"));
    outside = mkdtempSync(join(tmpdir(), "claude-supervisor-containment-outside-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("allows a normal, real, existing path inside root", () => {
    writeFileSync(join(root, "inside.txt"), "x");
    const result = resolveCanonicalContainment(root, join(root, "inside.txt"));
    expect(result.within).toBe(true);
  });

  it("denies a .. traversal that escapes root", () => {
    const result = resolveCanonicalContainment(root, join("..", "escaped.txt"));
    expect(result.within).toBe(false);
  });

  it("denies an absolute path outside root", () => {
    writeFileSync(join(outside, "secret.txt"), "x");
    const result = resolveCanonicalContainment(root, join(outside, "secret.txt"));
    expect(result.within).toBe(false);
  });

  // Requirement 4's own explicit case: Write needs to create files that
  // do not exist yet. A brand-new file under a real, legitimate,
  // in-root directory must never be blocked merely for not existing.
  it("allows a brand-new, nonexistent file under a real in-root directory (Write must still work)", () => {
    const result = resolveCanonicalContainment(root, join(root, "new-file.txt"));
    expect(result.within).toBe(true);
  });

  it("allows a brand-new, nonexistent file under a brand-new, nonexistent in-root subdirectory too", () => {
    const result = resolveCanonicalContainment(root, join(root, "brand-new-subdir", "new-file.txt"));
    expect(result.within).toBe(true);
  });

  it.skipIf(!SYMLINKS_SUPPORTED)("denies a real NTFS file symlink that points from inside root to outside", () => {
    writeFileSync(join(outside, "secret.txt"), "x");
    symlinkSync(join(outside, "secret.txt"), join(root, "escape-link.txt"), "file");
    const result = resolveCanonicalContainment(root, join(root, "escape-link.txt"));
    expect(result.within).toBe(false);
  });

  it.skipIf(!SYMLINKS_SUPPORTED)("allows a real NTFS symlink that stays physically inside root", () => {
    const realSubdir = join(root, "real-subdir");
    mkdirSync(realSubdir);
    writeFileSync(join(realSubdir, "inner.txt"), "x");
    symlinkSync(join(realSubdir, "inner.txt"), join(root, "internal-link.txt"), "file");
    const result = resolveCanonicalContainment(root, join(root, "internal-link.txt"));
    expect(result.within).toBe(true);
  });

  // Real Windows directory junction -- this ran for real in this
  // environment (no elevation required, unlike symlinks above).
  it("denies a real Windows directory junction that points from inside root to outside", () => {
    writeFileSync(join(outside, "secret.txt"), "outside content\n");
    symlinkSync(outside, join(root, "escape-junction"), "junction");
    const result = resolveCanonicalContainment(root, join(root, "escape-junction", "secret.txt"));
    expect(result.within).toBe(false);
  });

  it("allows a real Windows directory junction that stays physically inside root", () => {
    const realSubdir = join(root, "real-subdir");
    mkdirSync(realSubdir);
    writeFileSync(join(realSubdir, "inner.txt"), "x");
    symlinkSync(realSubdir, join(root, "internal-junction"), "junction");
    const result = resolveCanonicalContainment(root, join(root, "internal-junction", "inner.txt"));
    expect(result.within).toBe(true);
  });

  // The exact scenario requirement 4 calls out by name: the FILE itself
  // doesn't exist yet, but its parent directory is a real junction that
  // escapes root. The walk-up must find and canonicalize the junction
  // (the nearest EXISTING ancestor), not stop at "doesn't exist, so
  // allow."
  it("denies a brand-new, not-yet-created file whose parent directory is a junction escaping root", () => {
    symlinkSync(outside, join(root, "escape-junction-2"), "junction");
    const result = resolveCanonicalContainment(root, join(root, "escape-junction-2", "not-yet-created.txt"));
    expect(result.within).toBe(false);
  });

  it("denies when cwd itself does not exist -- fails closed rather than falling back to a lexical-only check", () => {
    const result = resolveCanonicalContainment(join(root, "does-not-exist"), "some-file.txt");
    expect(result.within).toBe(false);
  });
});

describe("createExecutorCanUseTool (real filesystem, end-to-end through the real callback)", () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "claude-supervisor-canusetool-root-"));
    outside = mkdtempSync(join(tmpdir(), "claude-supervisor-canusetool-outside-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it.each(["Read", "Write", "Edit"])("allows %s when file_path is a brand-new file inside root", async (toolName) => {
    const canUseTool = createExecutorCanUseTool(root);
    const result = await canUseTool(toolName, { file_path: join(root, "thing.ts") }, fakeCanUseToolOptions());
    expect(result).toEqual({ behavior: "allow" });
  });

  it.each(["Read", "Write", "Edit"])("denies %s when file_path resolves outside root", async (toolName) => {
    const canUseTool = createExecutorCanUseTool(root);
    const result = await canUseTool(toolName, { file_path: join(outside, "place.txt") }, fakeCanUseToolOptions());
    expect(result?.behavior).toBe("deny");
    expect(result && "message" in result ? result.message : null).toContain("canonical path-boundary check");
  });

  // The real end-to-end version of the junction-escape case, through the
  // ACTUAL callback wired into agent-sdk-executor-launcher.ts, not just
  // the pure resolveCanonicalContainment function in isolation.
  it("denies Write through a real junction that escapes root, via the real callback", async () => {
    writeFileSync(join(outside, "secret.txt"), "x");
    symlinkSync(outside, join(root, "escape-junction"), "junction");
    const canUseTool = createExecutorCanUseTool(root);
    const result = await canUseTool("Write", { file_path: join(root, "escape-junction", "secret.txt") }, fakeCanUseToolOptions());
    expect(result?.behavior).toBe("deny");
  });

  it.each(["Read", "Write", "Edit"])("fail-closed denies %s when file_path is missing", async (toolName) => {
    const canUseTool = createExecutorCanUseTool(root);
    const result = await canUseTool(toolName, {}, fakeCanUseToolOptions());
    expect(result?.behavior).toBe("deny");
  });

  it.each(["Read", "Write", "Edit"])("fail-closed denies %s when file_path is not a string", async (toolName) => {
    const canUseTool = createExecutorCanUseTool(root);
    const result = await canUseTool(toolName, { file_path: 12345 }, fakeCanUseToolOptions());
    expect(result?.behavior).toBe("deny");
  });

  it("denies Bash with a fixed, non-negotiable message, regardless of any file_path supplied", async () => {
    const canUseTool = createExecutorCanUseTool(root);
    const result = await canUseTool("Bash", { command: "rm -rf /" }, fakeCanUseToolOptions());
    expect(result?.behavior).toBe("deny");
    expect(result && "message" in result ? result.message : null).toContain("Bash");
  });

  // Fail-closed backstop: an unrecognized tool name (e.g. one a future
  // SDK version adds that this policy hasn't been updated for) must be
  // denied, never allowed by default.
  it("denies an entirely unrecognized future tool name", async () => {
    const canUseTool = createExecutorCanUseTool(root);
    const result = await canUseTool("SomeFutureTool", {}, fakeCanUseToolOptions());
    expect(result?.behavior).toBe("deny");
  });
});
