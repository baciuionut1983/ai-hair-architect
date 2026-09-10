import { describe, expect, it } from "vitest";

import {
  AlwaysFailingProfessionalReasoningProvider,
  FakeProfessionalReasoningProvider,
  getProfessionalReasoningProvider,
  LlmProfessionalReasoningProviderSkeleton,
} from "@/lib/professional-reasoning-provider";
import type { ProfessionalReasoningContext } from "@/lib/professional-reasoning-contracts";

// Professional Skill Engine, Stage 5 -- PROVIDER ABSTRACTION pure tests.
// No I/O, no AI, no real network call anywhere -- proves the skeleton is
// structurally incapable of reaching production.

const FIXTURE_CONTEXT = {} as ProfessionalReasoningContext; // never inspected by any provider in this file.

describe("ProfessionalReasoningProvider implementations", () => {
  it("FakeProfessionalReasoningProvider returns the caller-supplied canned response verbatim", async () => {
    const provider = new FakeProfessionalReasoningProvider({ some: "canned shape" });
    const outcome = await provider.reason(FIXTURE_CONTEXT);
    expect(outcome.rawProposal).toEqual({ some: "canned shape" });
    expect(outcome.providerRequestId).toBe("fake-request-id");
  });

  it("AlwaysFailingProfessionalReasoningProvider always throws a retryable PROVIDER_ERROR", async () => {
    const provider = new AlwaysFailingProfessionalReasoningProvider();
    await expect(provider.reason(FIXTURE_CONTEXT)).rejects.toMatchObject({ code: "PROVIDER_ERROR", retryable: true });
  });

  it("LlmProfessionalReasoningProviderSkeleton always throws NOT_IMPLEMENTED -- structurally cannot reach the network", async () => {
    const provider = new LlmProfessionalReasoningProviderSkeleton("gemini", "gemini-test-model");
    await expect(provider.reason(FIXTURE_CONTEXT)).rejects.toMatchObject({ code: "NOT_IMPLEMENTED", retryable: false });
    expect(provider.name).toBe("gemini");
    expect(provider.modelVersion).toBe("gemini-test-model");
  });

  it("getProfessionalReasoningProvider resolves 'fake-deterministic' to the fake provider", async () => {
    const provider = getProfessionalReasoningProvider("fake-deterministic", "fake-1.0", { echo: true });
    expect(provider).toBeInstanceOf(FakeProfessionalReasoningProvider);
    const outcome = await provider.reason(FIXTURE_CONTEXT);
    expect(outcome.rawProposal).toEqual({ echo: true });
  });

  it("getProfessionalReasoningProvider resolves any unrecognized/real provider name to the safe, non-network skeleton -- never a real call by default", () => {
    const provider = getProfessionalReasoningProvider("gemini", "gemini-2.5-pro");
    expect(provider).toBeInstanceOf(LlmProfessionalReasoningProviderSkeleton);
    const providerUndefined = getProfessionalReasoningProvider(undefined, "n/a");
    expect(providerUndefined).toBeInstanceOf(LlmProfessionalReasoningProviderSkeleton);
  });
});
