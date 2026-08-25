import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { runResolvedCheck, truncateSummary, type ExecImpl } from "./check-runner.js";
import { resolveCheckExecution } from "./check-registry.js";
import type { ResolvedCheck } from "./check-registry.js";

const FAKE_RESOLVED: ResolvedCheck = { checkName: "supervisor_typecheck", cwd: "/repo/tools/claude-supervisor", program: "/usr/bin/node", args: ["/repo/bin/tsc", "--noEmit"], timeoutMs: 60_000 };

describe("truncateSummary", () => {
  it("returns short text unchanged", () => {
    expect(truncateSummary("all good")).toBe("all good");
  });

  // Test requirement (Phase 1): "Do not persist huge logs."
  it("truncates long text, keeping the END (most recent output), never the start", () => {
    const long = "x".repeat(10_000) + "REAL_ERROR_AT_THE_END";
    const result = truncateSummary(long, 100);
    expect(result.length).toBeLessThan(200);
    expect(result).toContain("REAL_ERROR_AT_THE_END");
    expect(result).toContain("truncated");
  });
});

describe("runResolvedCheck (fake execImpl -- no real spawn)", () => {
  // Test requirement 1: allowed check passes.
  it("reports passed:true on exit code 0", async () => {
    const execImpl: ExecImpl = async () => ({ exitCode: 0, stdout: "ok", stderr: "", timedOut: false });
    const result = await runResolvedCheck(FAKE_RESOLVED, execImpl);
    expect(result.passed).toBe(true);
    expect(result.check).toBe("supervisor_typecheck");
  });

  // Test requirement 2: allowed check fails.
  it("reports passed:false on a non-zero exit code, with the real output in the summary", async () => {
    const execImpl: ExecImpl = async () => ({ exitCode: 1, stdout: "", stderr: "src/foo.ts(3,1): error TS2304", timedOut: false });
    const result = await runResolvedCheck(FAKE_RESOLVED, execImpl);
    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.summary).toContain("TS2304");
  });

  // Test requirement 4: check timeout.
  it("reports passed:false and timedOut:true when the process is killed for exceeding its timeout", async () => {
    const execImpl: ExecImpl = async () => ({ exitCode: null, stdout: "", stderr: "", timedOut: true });
    const result = await runResolvedCheck(FAKE_RESOLVED, execImpl);
    expect(result.passed).toBe(false);
    expect(result.timedOut).toBe(true);
  });

  it("measures a real (non-negative) duration even with a fake execImpl", async () => {
    const execImpl: ExecImpl = async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false });
    const result = await runResolvedCheck(FAKE_RESOLVED, execImpl);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("never persists an unbounded summary, even for very large real output", async () => {
    const execImpl: ExecImpl = async () => ({ exitCode: 1, stdout: "y".repeat(50_000), stderr: "", timedOut: false });
    const result = await runResolvedCheck(FAKE_RESOLVED, execImpl);
    expect(result.summary.length).toBeLessThan(5_000);
  });
});

describe("runResolvedCheck (REAL execution -- proves the node.exe + tsc bin path resolution genuinely works)", () => {
  const SUPERVISOR_ROOT = resolve(import.meta.dirname, "..");

  it("really runs supervisor_typecheck against this actual package and reports success", async () => {
    const resolved = resolveCheckExecution("supervisor_typecheck", {
      supervisorRoot: SUPERVISOR_ROOT,
      repoRoot: resolve(SUPERVISOR_ROOT, "..", ".."),
      nodeExecutable: process.execPath,
    });
    const result = await runResolvedCheck(resolved);
    expect(result.passed).toBe(true);
    expect(result.exitCode).toBe(0);
  }, 30_000);
});
