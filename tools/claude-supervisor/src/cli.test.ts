import { describe, expect, it } from "vitest";

import { parseCliArgs } from "./cli.js";

describe("parseCliArgs", () => {
  it("rejects a missing --task flag", () => {
    const result = parseCliArgs(["--dry-run"]);
    expect("error" in result).toBe(true);
  });

  it("parses --task and defaults dryRun to false", () => {
    const result = parseCliArgs(["--task", "/path/to/contract.json"]);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.taskContractPath).toBe("/path/to/contract.json");
      expect(result.dryRun).toBe(false);
    }
  });

  it("recognizes --dry-run", () => {
    const result = parseCliArgs(["--task", "/path/to/contract.json", "--dry-run"]);
    if (!("error" in result)) {
      expect(result.dryRun).toBe(true);
    } else {
      throw new Error("expected a successful parse");
    }
  });

  it("recognizes an explicit --cwd override", () => {
    const result = parseCliArgs(["--task", "/c.json", "--cwd", "/other/repo"]);
    if (!("error" in result)) {
      expect(result.cwd).toBe("/other/repo");
    } else {
      throw new Error("expected a successful parse");
    }
  });

  // Test requirement 9: ACTIVE mode requires the explicit --active flag
  // -- there must be no way to reach it merely by omitting --dry-run.
  it("defaults active to false when --active is not passed", () => {
    const result = parseCliArgs(["--task", "/c.json"]);
    if (!("error" in result)) {
      expect(result.active).toBe(false);
    } else {
      throw new Error("expected a successful parse");
    }
  });

  it("recognizes an explicit --active flag", () => {
    const result = parseCliArgs(["--task", "/c.json", "--active"]);
    if (!("error" in result)) {
      expect(result.active).toBe(true);
    } else {
      throw new Error("expected a successful parse");
    }
  });

  it("--dry-run and --active are independent flags -- --dry-run alone never implies --active nor vice versa", () => {
    const result = parseCliArgs(["--task", "/c.json", "--dry-run"]);
    if (!("error" in result)) {
      expect(result.dryRun).toBe(true);
      expect(result.active).toBe(false);
    } else {
      throw new Error("expected a successful parse");
    }
  });

  it("defaults approveProductionTaskId to null when not passed", () => {
    const result = parseCliArgs(["--task", "/c.json"]);
    if (!("error" in result)) {
      expect(result.approveProductionTaskId).toBeNull();
    } else {
      throw new Error("expected a successful parse");
    }
  });

  // Phase 10: --approve-production is the ONLY human production-
  // validation completion mechanism, and it is a closed, taskId-only
  // argument -- it never accepts or forwards arbitrary command text.
  it("recognizes --approve-production <taskId> without requiring --task at all", () => {
    const result = parseCliArgs(["--approve-production", "supervisor-live-smoke-1"]);
    if (!("error" in result)) {
      expect(result.approveProductionTaskId).toBe("supervisor-live-smoke-1");
    } else {
      throw new Error("expected a successful parse");
    }
  });

  it("rejects --approve-production with no taskId argument", () => {
    const result = parseCliArgs(["--approve-production"]);
    expect("error" in result).toBe(true);
  });

  it("respects an explicit --state-dir alongside --approve-production", () => {
    const result = parseCliArgs(["--approve-production", "task-1", "--state-dir", "/custom/state"]);
    if (!("error" in result)) {
      expect(result.stateDir).toBe("/custom/state");
    } else {
      throw new Error("expected a successful parse");
    }
  });
});
