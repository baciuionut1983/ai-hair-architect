import { describe, expect, it } from "vitest";

import { detectCancellationRequest } from "./orchestrator-cancellation-detector";

describe("detectCancellationRequest -- task section 11", () => {
  it("recognizes exact bare cancellation phrases, case-insensitively", () => {
    for (const message of ["Stop", "STOP", "Stop.", "Cancel", "Anulează", "Anulează.", "Nu mai continua", "Oprește"]) {
      expect(detectCancellationRequest(message)).toBe(true);
    }
  });

  it("does NOT match a cancellation-shaped word embedded inside a longer sentence", () => {
    expect(detectCancellationRequest("Nu mai continua analiza asta, dar termină videoul.")).toBe(false);
    expect(detectCancellationRequest("Please stop asking me twice.")).toBe(false);
  });

  it("returns false for empty, whitespace-only, or genuinely unrelated input", () => {
    expect(detectCancellationRequest("")).toBe(false);
    expect(detectCancellationRequest("   ")).toBe(false);
    expect(detectCancellationRequest("Arată-mi rezultatul.")).toBe(false);
    expect(detectCancellationRequest("Da")).toBe(false);
  });
});
