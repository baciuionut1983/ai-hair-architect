import { describe, expect, it } from "vitest";

import { detectBareConfirmation } from "./orchestrator-confirmation-detector";

describe("detectBareConfirmation -- task section 4/17 (tests A/B/C/M)", () => {
  it("recognizes exact bare yes replies across languages, case-insensitively", () => {
    for (const message of ["Yes", "yes", "YES", "Da", "DA", "Hai", "Ok", "Okay", "Sì", "Oui", "Ja", "Sí", "Sim", "Tak", "Evet", "はい", "예", "네", "是", "हाँ"]) {
      expect(detectBareConfirmation(message)).toBe("yes");
    }
  });

  it("recognizes exact bare no replies across languages, case-insensitively", () => {
    for (const message of ["No", "no", "NO", "Nu", "Non", "Nein", "Não", "Nao", "Nee", "Nie", "Hayır", "いいえ", "아니요", "否", "नहीं"]) {
      expect(detectBareConfirmation(message)).toBe("no");
    }
  });

  it("tolerates trailing punctuation and surrounding whitespace only", () => {
    expect(detectBareConfirmation("Da.")).toBe("yes");
    expect(detectBareConfirmation("Da!")).toBe("yes");
    expect(detectBareConfirmation("  Da  ")).toBe("yes");
    expect(detectBareConfirmation("Nu?")).toBe("no");
  });

  // task section 4: a bare word must be the WHOLE message -- never a
  // substring match, since this decision is safety-relevant.
  it("does NOT match a yes/no word embedded inside a longer sentence", () => {
    expect(detectBareConfirmation("Da, dar nu acum.")).toBeNull();
    expect(detectBareConfirmation("Nu vreau video.")).toBeNull();
    expect(detectBareConfirmation("Yes please, show me the client.")).toBeNull();
    expect(detectBareConfirmation("No thanks, maybe later.")).toBeNull();
  });

  it("returns null for empty, whitespace-only, or genuinely unrecognized input", () => {
    expect(detectBareConfirmation("")).toBeNull();
    expect(detectBareConfirmation("   ")).toBeNull();
    expect(detectBareConfirmation("Arată-mi rezultatul.")).toBeNull();
    expect(detectBareConfirmation("continue")).toBeNull();
  });
});
