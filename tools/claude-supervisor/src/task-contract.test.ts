import { describe, expect, it } from "vitest";

import { isSameContract, validateTaskContract } from "./task-contract.js";

function validRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    taskId: "task-1",
    title: "TTS A/B experiment",
    approvedPrompt: "Do the thing exactly as approved.",
    scope: ["TTS experiment"],
    protectedAreas: ["VAD", "billing", "auth"],
    requiredChecks: ["web_typecheck", "web_lint", "web_tests_relevant", "web_build"],
    ...overrides,
  };
}

describe("validateTaskContract", () => {
  it("accepts a fully-populated, valid contract", () => {
    const result = validateTaskContract(validRaw());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contract.taskId).toBe("task-1");
      expect(result.contract.requiredChecks).toEqual(["web_typecheck", "web_lint", "web_tests_relevant", "web_build"]);
    }
  });

  it("defaults ciPolicy to 'optional' and productionValidation to 'not_required' when absent -- v1.1 contracts stay valid unmodified", () => {
    const result = validateTaskContract(validRaw());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contract.ciPolicy).toBe("optional");
      expect(result.contract.productionValidation).toBe("not_required");
    }
  });

  it("accepts an explicit ciPolicy/productionValidation and preserves them", () => {
    const result = validateTaskContract(validRaw({ ciPolicy: "required", productionValidation: "required" }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contract.ciPolicy).toBe("required");
      expect(result.contract.productionValidation).toBe("required");
    }
  });

  it("rejects an unrecognized ciPolicy value", () => {
    expect(validateTaskContract(validRaw({ ciPolicy: "sometimes" }))).toEqual({ ok: false, reason: "invalid_ciPolicy:sometimes" });
  });

  it("rejects an unrecognized productionValidation value", () => {
    expect(validateTaskContract(validRaw({ productionValidation: "maybe" }))).toEqual({ ok: false, reason: "invalid_productionValidation:maybe" });
  });

  it("rejects a non-object payload", () => {
    expect(validateTaskContract(null)).toEqual({ ok: false, reason: "not_an_object" });
    expect(validateTaskContract("a string")).toEqual({ ok: false, reason: "not_an_object" });
    expect(validateTaskContract(42)).toEqual({ ok: false, reason: "not_an_object" });
  });

  it("rejects a missing taskId", () => {
    const raw = validRaw();
    delete raw.taskId;
    expect(validateTaskContract(raw)).toEqual({ ok: false, reason: "missing_or_invalid_taskId" });
  });

  it("rejects an empty-string taskId", () => {
    expect(validateTaskContract(validRaw({ taskId: "   " }))).toEqual({ ok: false, reason: "missing_or_invalid_taskId" });
  });

  it("rejects a missing approvedPrompt", () => {
    const raw = validRaw();
    delete raw.approvedPrompt;
    expect(validateTaskContract(raw)).toEqual({ ok: false, reason: "missing_or_invalid_approvedPrompt" });
  });

  // The whole point of protectedAreas -- a contract that never names
  // anything to protect has nothing for scope-guard.ts to enforce.
  it("rejects an empty protectedAreas array", () => {
    expect(validateTaskContract(validRaw({ protectedAreas: [] }))).toEqual({
      ok: false,
      reason: "missing_or_invalid_protectedAreas",
    });
  });

  // An empty requiredChecks array is legitimate (e.g. a "make no
  // repository changes" smoke-test task has nothing to build/lint/test)
  // -- protectedAreas, not requiredChecks, is what must never be empty.
  it("accepts an empty requiredChecks array", () => {
    const result = validateTaskContract(validRaw({ requiredChecks: [] }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contract.requiredChecks).toEqual([]);
    }
  });

  it("rejects a non-array requiredChecks", () => {
    expect(validateTaskContract(validRaw({ requiredChecks: "tsc" }))).toEqual({
      ok: false,
      reason: "missing_or_invalid_requiredChecks",
    });
  });

  it("rejects an unrecognized requiredChecks entry -- never a free-form string the Supervisor would need to interpret", () => {
    expect(validateTaskContract(validRaw({ requiredChecks: ["supervisor_typecheck", "run-rm-rf"] }))).toEqual({
      ok: false,
      reason: "invalid_required_check:run-rm-rf",
    });
  });

  it("rejects a non-string-array scope", () => {
    expect(validateTaskContract(validRaw({ scope: "TTS experiment" }))).toEqual({
      ok: false,
      reason: "missing_or_invalid_scope",
    });
  });

  it("accepts optional allowedOperations/forbiddenOperations when present and valid", () => {
    const result = validateTaskContract(
      validRaw({ allowedOperations: ["edit files"], forbiddenOperations: ["force push"] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contract.allowedOperations).toEqual(["edit files"]);
      expect(result.contract.forbiddenOperations).toEqual(["force push"]);
    }
  });

  it("rejects an invalid forbiddenOperations shape", () => {
    expect(validateTaskContract(validRaw({ forbiddenOperations: "force push" }))).toEqual({
      ok: false,
      reason: "invalid_forbiddenOperations",
    });
  });

  it("defaults createdAt to now when absent, never leaving it undefined", () => {
    const result = validateTaskContract(validRaw());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.contract.createdAt).toBe("string");
      expect(Number.isNaN(Date.parse(result.contract.createdAt))).toBe(false);
    }
  });

  it("preserves an explicit createdAt when present", () => {
    const result = validateTaskContract(validRaw({ createdAt: "2026-01-01T00:00:00.000Z" }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contract.createdAt).toBe("2026-01-01T00:00:00.000Z");
    }
  });
});

describe("isSameContract", () => {
  it("treats two contracts with identical enforcement-relevant fields as the same, even with different createdAt", () => {
    const a = validateTaskContract(validRaw({ createdAt: "2026-01-01T00:00:00.000Z" }));
    const b = validateTaskContract(validRaw({ createdAt: "2026-01-02T00:00:00.000Z" }));
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(isSameContract(a.contract, b.contract)).toBe(true);
    }
  });

  it("treats a contract with a different protectedAreas list as a different contract", () => {
    const a = validateTaskContract(validRaw());
    const b = validateTaskContract(validRaw({ protectedAreas: ["VAD", "billing", "auth", "migrations"] }));
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(isSameContract(a.contract, b.contract)).toBe(false);
    }
  });

  it("treats a contract with a different approvedPrompt as a different contract", () => {
    const a = validateTaskContract(validRaw());
    const b = validateTaskContract(validRaw({ approvedPrompt: "Do a completely different thing." }));
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(isSameContract(a.contract, b.contract)).toBe(false);
    }
  });
});
