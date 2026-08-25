import { describe, expect, it } from "vitest";

import { buildProductionValidationRequest, needsProductionValidation } from "./production-validation.js";
import { validateTaskContract } from "./task-contract.js";
import type { TaskContract } from "./types.js";

function contract(overrides: Partial<TaskContract> = {}): TaskContract {
  const result = validateTaskContract({
    taskId: "task-1",
    title: "TTS A/B experiment",
    approvedPrompt: "Do the thing.",
    scope: ["TTS experiment"],
    protectedAreas: ["VAD"],
    requiredChecks: [],
    ...overrides,
  });
  if (!result.ok) throw new Error("invalid fixture");
  return result.contract;
}

describe("needsProductionValidation", () => {
  it("returns false by default (matches v1.1 behavior)", () => {
    expect(needsProductionValidation(contract())).toBe(false);
  });

  it("returns true when the contract explicitly requires it", () => {
    expect(needsProductionValidation(contract({ productionValidation: "required" }))).toBe(true);
  });
});

describe("buildProductionValidationRequest", () => {
  it("includes the real commit sha, taskId, and title -- never fabricated", () => {
    const request = buildProductionValidationRequest(contract(), "abc123def456");
    expect(request.commitSha).toBe("abc123def456");
    expect(request.taskId).toBe("task-1");
    expect(request.title).toBe("TTS A/B experiment");
  });

  it("derives the test matrix from the contract's own real scope/protectedAreas, never invented specifics", () => {
    const request = buildProductionValidationRequest(contract({ scope: ["voice reply latency"], protectedAreas: ["billing", "auth"] }), "sha1");
    expect(request.testMatrix.some((line) => line.includes("voice reply latency"))).toBe(true);
    expect(request.testMatrix.some((line) => line.includes("billing") && line.includes("auth"))).toBe(true);
  });
});
