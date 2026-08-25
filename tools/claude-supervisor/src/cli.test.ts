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
});
