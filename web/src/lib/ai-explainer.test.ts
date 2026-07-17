import { afterEach, describe, expect, it, vi } from "vitest";

import type { TechnicalCutPlan } from "./contracts";
import { enrichTechnicalPlanExplanations } from "./ai-explainer";

const basePlan: TechnicalCutPlan = {
  structuralTechnique: "graduation",
  cuttingTechnique: "slice_cutting",
  texturizingTechnique: "point_cutting",
  sectioning: "diagonal_back",
  elevation: "45_deg_graduation",
  distribution: "overdirected_back",
  guideline: "stationary",
  cuttingSteps: [],
  stylistExplanation: "deterministic stylist",
  clientExplanation: "deterministic client",
  professionalReason: "structural reason",
  warnings: [],
  contraindications: [],
  assumptions: [],
  missingData: [],
  confidence: 0.9,
  stylistValidationDisclaimer: "validate",
  version: "1.0.0-m8"
};

afterEach(() => {
  delete process.env.AI_EXPLAINER_TIMEOUT_MS;
  delete process.env.AI_EXPLAINER_ENDPOINT;
  delete process.env.AI_EXPLAINER_API_KEY;
  vi.useRealTimers();
});

describe("ai-explainer", () => {
  it("uses provider explanations when valid", async () => {
    const plan = await enrichTechnicalPlanExplanations(basePlan, {
      async generate() {
        return {
          stylistExplanation: "provider stylist",
          clientExplanation: "provider client"
        };
      }
    });

    expect(plan.stylistExplanation).toBe("provider stylist");
    expect(plan.clientExplanation).toBe("provider client");
  });

  it("falls back deterministically on provider error", async () => {
    const plan = await enrichTechnicalPlanExplanations(basePlan, {
      async generate() {
        throw new Error("provider failed");
      }
    });

    expect(plan.stylistExplanation).toBe(basePlan.stylistExplanation);
    expect(plan.clientExplanation).toBe(basePlan.clientExplanation);
    expect(plan.warnings).toContain("AI explanation service unavailable. Deterministic explanations used.");
  });

  it("falls back deterministically on timeout", async () => {
    vi.useFakeTimers();
    process.env.AI_EXPLAINER_TIMEOUT_MS = "500";

    const planPromise = enrichTechnicalPlanExplanations(basePlan, {
      generate(_plan, signal) {
        return new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      }
    });

    await vi.advanceTimersByTimeAsync(600);
    const plan = await planPromise;

    expect(plan.stylistExplanation).toBe(basePlan.stylistExplanation);
    expect(plan.clientExplanation).toBe(basePlan.clientExplanation);
  });

  it("keeps the deterministic plan when provider returns invalid payload", async () => {
    const plan = await enrichTechnicalPlanExplanations(basePlan, {
      async generate() {
        return {};
      }
    });

    expect(plan.stylistExplanation).toBe(basePlan.stylistExplanation);
    expect(plan.clientExplanation).toBe(basePlan.clientExplanation);
    expect(plan.warnings).toContain("AI explanation service returned an invalid payload. Deterministic explanations used.");
  });
});
