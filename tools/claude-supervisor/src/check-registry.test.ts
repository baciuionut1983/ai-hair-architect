import { describe, expect, it } from "vitest";

import { CHECK_REGISTRY, RUNNABLE_CHECK_NAMES, isKnownCheckName, resolveCheckExecution, type CheckName } from "./check-registry.js";

const ROOTS = { supervisorRoot: "/repo/tools/claude-supervisor", repoRoot: "/repo", nodeExecutable: "/usr/bin/node" };

describe("isKnownCheckName", () => {
  it("accepts every registered check name", () => {
    for (const name of Object.keys(CHECK_REGISTRY)) {
      expect(isKnownCheckName(name)).toBe(true);
    }
  });

  // Test requirement 3: unknown check rejected.
  it("rejects an unregistered name, e.g. a free-form shell string", () => {
    expect(isKnownCheckName("rm -rf /")).toBe(false);
    expect(isKnownCheckName("tsc")).toBe(false);
    expect(isKnownCheckName("")).toBe(false);
  });
});

describe("RUNNABLE_CHECK_NAMES", () => {
  it("contains only the four supervisor_* checks this round actually runs", () => {
    expect([...RUNNABLE_CHECK_NAMES].sort()).toEqual(["supervisor_build", "supervisor_lint", "supervisor_test", "supervisor_typecheck"]);
  });

  it("does not mark any web_* check as runnable yet -- unverified placeholders", () => {
    for (const name of RUNNABLE_CHECK_NAMES) {
      expect(name.startsWith("web_")).toBe(false);
    }
  });
});

describe("resolveCheckExecution", () => {
  it("resolves a supervisor_* check against supervisorRoot, never repoRoot", () => {
    const resolved = resolveCheckExecution("supervisor_typecheck", ROOTS);
    expect(resolved.cwd.replace(/\\/g, "/")).toBe("/repo/tools/claude-supervisor");
    expect(resolved.program).toBe("/usr/bin/node");
    expect(resolved.args[0].replace(/\\/g, "/")).toContain("node_modules/typescript/bin/tsc");
    expect(resolved.args.slice(1)).toEqual(["--noEmit", "-p", "tsconfig.json"]);
  });

  it("resolves a web_* check against repoRoot/web, never supervisorRoot", () => {
    const resolved = resolveCheckExecution("web_typecheck", ROOTS);
    expect(resolved.cwd.replace(/\\/g, "/")).toBe("/repo/web");
    expect(resolved.args[0].replace(/\\/g, "/")).toContain("node_modules/typescript/bin/tsc");
  });

  it("never resolves to npx/npm as the program -- always the injected real node executable", () => {
    for (const checkName of Object.keys(CHECK_REGISTRY) as CheckName[]) {
      const resolved = resolveCheckExecution(checkName, ROOTS);
      expect(resolved.program).toBe(ROOTS.nodeExecutable);
      expect(resolved.program).not.toBe("npx");
      expect(resolved.program).not.toBe("npm");
    }
  });

  it("uses each check's own registered timeout", () => {
    expect(resolveCheckExecution("supervisor_typecheck", ROOTS).timeoutMs).toBe(60_000);
    expect(resolveCheckExecution("web_tests_full", ROOTS).timeoutMs).toBe(600_000);
  });
});
