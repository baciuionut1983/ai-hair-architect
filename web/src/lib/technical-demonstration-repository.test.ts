import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import type { TechnicalCutPlan } from "@/lib/contracts";
import { createAnalysisForOwner } from "@/lib/analysis-repository";
import { prisma } from "@/lib/prisma";
import { confirmProposal, createProposalForOwner, editDraftProposal, rejectProposal } from "@/lib/proposal-repository";
import {
  confirmTechnicalDemonstrationPlan,
  createTechnicalDemonstrationPlanFromProposal,
  findCurrentConfirmedTechnicalDemonstrationPlan,
  findTechnicalDemonstrationPlanForOwner,
  listTechnicalDemonstrationStepsForPlan,
  TechnicalDemonstrationConcurrencyError,
  TechnicalDemonstrationDependencyError,
  TechnicalDemonstrationStateError,
} from "@/lib/technical-demonstration-repository";

// Technical Demonstration, Stage 1 -- real Postgres, no mocks, mirroring
// this codebase's own established convention for every domain-repository
// test (e.g. photo-preview-generation-repository.test.ts,
// orchestrator-service.test.ts's own Gap #3 fixtures).
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

suite("technical-demonstration-repository (real Postgres)", () => {
  afterEach(async () => {
    const ownerUserIds = [...owners];
    await prisma.technicalDemonstrationStep.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.technicalDemonstrationPlan.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.analysisProposal.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.analysis.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownerUserIds } } });
    owners.clear();
  });

  // Required test 1.
  it("1. derives a real DRAFT plan + ordered steps from a real CONFIRMED cutting proposal", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);

    const outcome = await createTechnicalDemonstrationPlanFromProposal(ownerUserId, clientId, proposal.id);

    expect(outcome.created).toBe(true);
    expect(outcome.plan.status).toBe("DRAFT");
    expect(outcome.plan.vertical).toBe("cutting");
    expect(outcome.plan.analysisProposalId).toBe(proposal.id);
    expect(outcome.plan.planVersion).toBe(1);
    expect(outcome.steps).toHaveLength(3);
    expect(outcome.steps.map((s) => s.stepNumber)).toEqual([1, 2, 3]);
  });

  // Required test 2.
  it("2. rejects a non-CONFIRMED (DRAFT) proposal", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    const draft = await createProposalForOwner(ownerUserId, clientId, analysis.id, "cutting", cuttingPayload(), evidenceSnapshot(), "1.0.0-m8");

    await expect(createTechnicalDemonstrationPlanFromProposal(ownerUserId, clientId, draft.id)).rejects.toThrow(TechnicalDemonstrationDependencyError);
  });

  it("2b. rejects a REJECTED proposal", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    const draft = await createProposalForOwner(ownerUserId, clientId, analysis.id, "cutting", cuttingPayload(), evidenceSnapshot(), "1.0.0-m8");
    await rejectProposal(ownerUserId, draft.id);

    await expect(createTechnicalDemonstrationPlanFromProposal(ownerUserId, clientId, draft.id)).rejects.toThrow(TechnicalDemonstrationDependencyError);
  });

  it("rejects a proposal that does not exist, and one belonging to a different client", async () => {
    const { ownerUserId, clientId: clientA } = await createOwnerAndClient();
    const { clientId: clientB } = await createOwnerAndClient(ownerUserId);
    const analysisB = await createAnalysis(ownerUserId, clientB);
    const proposalB = await confirmedProposal(ownerUserId, clientB, analysisB.id);

    await expect(createTechnicalDemonstrationPlanFromProposal(ownerUserId, clientA, randomUUID())).rejects.toThrow(TechnicalDemonstrationDependencyError);
    await expect(createTechnicalDemonstrationPlanFromProposal(ownerUserId, clientA, proposalB.id)).rejects.toThrow(TechnicalDemonstrationDependencyError);
  });

  // Required test 4: proposal/version provenance is sealed.
  it("4. seals the exact proposal id + confirmedAt anchor -- a later, different confirmed proposal produces a SEPARATE plan, never a mutation of the first", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysisA = await createAnalysis(ownerUserId, clientId);
    const proposalA = await confirmedProposal(ownerUserId, clientId, analysisA.id);

    const outcomeA = await createTechnicalDemonstrationPlanFromProposal(ownerUserId, clientId, proposalA.id);
    expect(outcomeA.plan.analysisProposalId).toBe(proposalA.id);
    expect(outcomeA.plan.analysisProposalConfirmedAt).toBe(proposalA.confirmedAt);

    // A newer proposal is confirmed for the SAME client, superseding A.
    const analysisB = await createAnalysis(ownerUserId, clientId);
    const draftB = await createProposalForOwner(ownerUserId, clientId, analysisB.id, "cutting", cuttingPayload(), evidenceSnapshot(), "1.0.0-m8");
    const proposalB = await confirmProposal(ownerUserId, draftB.id, ownerUserId, proposalA.id);
    if (!proposalB) throw new Error("expected proposalB to be confirmed");

    const outcomeB = await createTechnicalDemonstrationPlanFromProposal(ownerUserId, clientId, proposalB.id);

    // Two genuinely separate plan rows -- A's own plan is completely
    // untouched by B's derivation.
    expect(outcomeB.plan.id).not.toBe(outcomeA.plan.id);
    expect(outcomeB.plan.analysisProposalId).toBe(proposalB.id);
    const stillA = await findTechnicalDemonstrationPlanForOwner(ownerUserId, outcomeA.plan.id);
    expect(stillA?.analysisProposalId).toBe(proposalA.id);
    expect(stillA?.status).toBe("DRAFT");

    // Confirmation itself is scoped BY analysisProposalId (see the
    // confirmTechnicalDemonstrationPlan describe block's own header
    // comment on WHY) -- plan A and plan B belong to different proposals,
    // so BOTH can be confirmed independently, with expectedCurrentConfirmedPlanId
    // null each, never contending with each other at all.
    const confirmedA = await confirmTechnicalDemonstrationPlan(ownerUserId, outcomeA.plan.id, null);
    const confirmedB = await confirmTechnicalDemonstrationPlan(ownerUserId, outcomeB.plan.id, null);
    expect(confirmedA?.status).toBe("CONFIRMED");
    expect(confirmedB?.status).toBe("CONFIRMED");
  });

  // Required test 5.
  it("5. repeated derivation for the same confirmed proposal is idempotent -- no duplicate plan, no duplicate steps", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);

    const first = await createTechnicalDemonstrationPlanFromProposal(ownerUserId, clientId, proposal.id);
    const second = await createTechnicalDemonstrationPlanFromProposal(ownerUserId, clientId, proposal.id);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.plan.id).toBe(first.plan.id);
    expect(second.steps.map((s) => s.id)).toEqual(first.steps.map((s) => s.id));

    const allPlans = await prisma.technicalDemonstrationPlan.findMany({ where: { ownerUserId, clientId, analysisProposalId: proposal.id } });
    expect(allPlans).toHaveLength(1);
  });

  // Required test 10.
  it("10. sourceKind defaults to AI_ANALYSIS and is readable for every existing proposal-creation path -- backward compatible", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);

    expect(proposal.sourceKind).toBe("AI_ANALYSIS");
  });

  // -------------------------------------------------------------------------
  // RELEASE-BLOCKER FIX -- professional edit provenance / effective payload.
  // Real Postgres, real editDraftProposal (the SAME function a real
  // professional edit already goes through), real confirmProposal.
  // -------------------------------------------------------------------------
  describe("professional edit provenance (release-blocker fix)", () => {
    // Required test 2 + 3 combined -- the literal example from the fix
    // authorization: elevation-shaped field edited before confirmation
    // must be what derivation uses; the original frozen value must never
    // leak through.
    it("2+3. a professional-edited technical field is used in derivation -- the original frozen proposal value is NEVER used", async () => {
      const { ownerUserId, clientId } = await createOwnerAndClient();
      const analysis = await createAnalysis(ownerUserId, clientId);
      const draft = await createProposalForOwner(ownerUserId, clientId, analysis.id, "cutting", cuttingPayload(), evidenceSnapshot(), "1.0.0-m8");
      expect(draft.payload.sectioning).toBe("diagonal_back"); // the real, original AI-proposed value

      await editDraftProposal(ownerUserId, draft.id, [
        { field: "sectioning", previousValue: "diagonal_back", newValue: "horseshoe_crown", source: "stylist_confirmed" },
      ]);
      const proposal = await confirmProposal(ownerUserId, draft.id, ownerUserId, null);
      if (!proposal) throw new Error("expected confirmed proposal");
      // The frozen baseline itself is untouched by the edit -- confirms
      // editDraftProposal's own "payload is never overwritten" contract.
      expect(proposal.payload.sectioning).toBe("diagonal_back");
      expect(proposal.edits).toHaveLength(1);

      const outcome = await createTechnicalDemonstrationPlanFromProposal(ownerUserId, clientId, proposal.id);

      for (const step of outcome.steps) {
        const sectioning = step.payload.sectioning as { value: unknown; provenance: unknown };
        expect(sectioning.value).toBe("horseshoe_crown"); // the professional's real edited value
        expect(sectioning.value).not.toBe("diagonal_back"); // the stale frozen baseline must never appear
      }
    });

    // Required test 5.
    it("5. professional edit provenance is retained/distinguishable -- PROFESSIONAL_OVERRIDE, not a generic INFERRED", async () => {
      const { ownerUserId, clientId } = await createOwnerAndClient();
      const analysis = await createAnalysis(ownerUserId, clientId);
      const draft = await createProposalForOwner(ownerUserId, clientId, analysis.id, "cutting", cuttingPayload(), evidenceSnapshot(), "1.0.0-m8");
      await editDraftProposal(ownerUserId, draft.id, [
        { field: "sectioning", previousValue: "diagonal_back", newValue: "horseshoe_crown", source: "stylist_confirmed" },
      ]);
      const proposal = await confirmProposal(ownerUserId, draft.id, ownerUserId, null);
      if (!proposal) throw new Error("expected confirmed proposal");

      const outcome = await createTechnicalDemonstrationPlanFromProposal(ownerUserId, clientId, proposal.id);

      for (const step of outcome.steps) {
        const sectioning = step.payload.sectioning as { value: unknown; provenance: unknown };
        const structuralTechnique = step.payload.structuralTechnique as { value: unknown; provenance: unknown };
        expect(sectioning.provenance).toBe("PROFESSIONAL_OVERRIDE");
        // A field that was NOT edited stays INFERRED -- the override tag
        // is specific to the actually-edited field, never smeared across
        // every plan-level field.
        expect(structuralTechnique.provenance).toBe("INFERRED");
      }
    });

    // Required test 4 -- multiple supported edits, same semantics as
    // Technical Visual Map's own "last matching edit wins" merge rule.
    it("4. multiple real edits resolve through the SAME semantics as Technical Visual Map -- last matching edit per field wins", async () => {
      const { ownerUserId, clientId } = await createOwnerAndClient();
      const analysis = await createAnalysis(ownerUserId, clientId);
      const draft = await createProposalForOwner(ownerUserId, clientId, analysis.id, "cutting", cuttingPayload(), evidenceSnapshot(), "1.0.0-m8");
      await editDraftProposal(ownerUserId, draft.id, [
        { field: "structuralTechnique", previousValue: "graduation", newValue: "one_length", source: "stylist_confirmed" },
        { field: "distribution", previousValue: "overdirected_back", newValue: "natural_fall", source: "stylist_confirmed" },
      ]);
      // A SECOND edit on the SAME field -- the later one must win, exactly
      // like computeEffectiveTechnicalCutPlan's own documented rule.
      await editDraftProposal(ownerUserId, draft.id, [
        { field: "structuralTechnique", previousValue: "one_length", newValue: "internal_layering", source: "stylist_confirmed" },
      ]);
      const proposal = await confirmProposal(ownerUserId, draft.id, ownerUserId, null);
      if (!proposal) throw new Error("expected confirmed proposal");
      expect(proposal.edits).toHaveLength(3);

      const outcome = await createTechnicalDemonstrationPlanFromProposal(ownerUserId, clientId, proposal.id);

      for (const step of outcome.steps) {
        const structuralTechnique = step.payload.structuralTechnique as { value: unknown; provenance: unknown };
        const combingDirection = step.payload.combingDirection as { value: unknown; provenance: unknown };
        expect(structuralTechnique).toEqual({ value: "internal_layering", provenance: "PROFESSIONAL_OVERRIDE" }); // last edit wins
        expect(combingDirection).toEqual({
          value: "Comb the section to fall naturally, with no directional pull.",
          provenance: "PROFESSIONAL_OVERRIDE",
        });
      }
    });

    // Required test 1 (repository level): a genuinely UNEDITED confirmed
    // proposal still derives exactly as it did before this fix.
    it("1. an unedited confirmed proposal still derives exactly as before -- every plan-level field stays INFERRED", async () => {
      const { ownerUserId, clientId } = await createOwnerAndClient();
      const analysis = await createAnalysis(ownerUserId, clientId);
      const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id); // never edited

      const outcome = await createTechnicalDemonstrationPlanFromProposal(ownerUserId, clientId, proposal.id);

      for (const step of outcome.steps) {
        const sectioning = step.payload.sectioning as { value: unknown; provenance: unknown };
        expect(sectioning).toEqual({ value: "diagonal_back", provenance: "INFERRED" });
      }
    });

    // Required test 6: idempotency remains intact through this fix --
    // repeated derivation for the SAME edited-and-confirmed proposal is
    // still idempotent, and the fingerprint still correctly distinguishes
    // an edited proposal's own plan from an unedited one (never colliding).
    it("6. idempotency remains intact for an edited-and-confirmed proposal", async () => {
      const { ownerUserId, clientId } = await createOwnerAndClient();
      const analysis = await createAnalysis(ownerUserId, clientId);
      const draft = await createProposalForOwner(ownerUserId, clientId, analysis.id, "cutting", cuttingPayload(), evidenceSnapshot(), "1.0.0-m8");
      await editDraftProposal(ownerUserId, draft.id, [
        { field: "sectioning", previousValue: "diagonal_back", newValue: "horseshoe_crown", source: "stylist_confirmed" },
      ]);
      const proposal = await confirmProposal(ownerUserId, draft.id, ownerUserId, null);
      if (!proposal) throw new Error("expected confirmed proposal");

      const first = await createTechnicalDemonstrationPlanFromProposal(ownerUserId, clientId, proposal.id);
      const second = await createTechnicalDemonstrationPlanFromProposal(ownerUserId, clientId, proposal.id);

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.plan.id).toBe(first.plan.id);
      const allPlans = await prisma.technicalDemonstrationPlan.findMany({ where: { ownerUserId, clientId, analysisProposalId: proposal.id } });
      expect(allPlans).toHaveLength(1);
    });
  });

  it("never leaks another owner's or another client's plan into findCurrentConfirmedTechnicalDemonstrationPlan", async () => {
    const { ownerUserId: ownerA, clientId: clientA } = await createOwnerAndClient();
    const { ownerUserId: ownerB, clientId: clientB } = await createOwnerAndClient();
    const analysisB = await createAnalysis(ownerB, clientB);
    const proposalB = await confirmedProposal(ownerB, clientB, analysisB.id);
    const outcomeB = await createTechnicalDemonstrationPlanFromProposal(ownerB, clientB, proposalB.id);
    await confirmTechnicalDemonstrationPlan(ownerB, outcomeB.plan.id, null);

    const result = await findCurrentConfirmedTechnicalDemonstrationPlan(ownerA, clientA, proposalB.id, "cutting");
    expect(result).toBeNull();
  });

  describe("confirmTechnicalDemonstrationPlan", () => {
    it("confirms a real DRAFT plan", async () => {
      const { ownerUserId, clientId } = await createOwnerAndClient();
      const analysis = await createAnalysis(ownerUserId, clientId);
      const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);
      const outcome = await createTechnicalDemonstrationPlanFromProposal(ownerUserId, clientId, proposal.id);

      const confirmed = await confirmTechnicalDemonstrationPlan(ownerUserId, outcome.plan.id, null);

      expect(confirmed?.status).toBe("CONFIRMED");
      expect(confirmed?.confirmedAt).not.toBeNull();
    });

    it("rejects confirming an already-CONFIRMED plan a second time", async () => {
      const { ownerUserId, clientId } = await createOwnerAndClient();
      const analysis = await createAnalysis(ownerUserId, clientId);
      const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);
      const outcome = await createTechnicalDemonstrationPlanFromProposal(ownerUserId, clientId, proposal.id);
      await confirmTechnicalDemonstrationPlan(ownerUserId, outcome.plan.id, null);

      await expect(confirmTechnicalDemonstrationPlan(ownerUserId, outcome.plan.id, null)).rejects.toThrow(TechnicalDemonstrationStateError);
    });

    // Supersession is scoped BY analysisProposalId (mirroring
    // TechnicalVisualMap's own identical mapVersion-per-proposal scoping)
    // -- deliberately: a planVersion is a REGENERATION of the SAME
    // confirmed technical intent (e.g. improved derivation logic), never a
    // cross-proposal concept. Confirming plan B (a DIFFERENT proposal's own
    // plan) never contends with plan A's own confirmed status at all --
    // proven separately by the "seals the exact proposal id" test above
    // (test 4), where both plans stay independently DRAFT/whatever they
    // were. This test exercises the real same-proposal version-2 case:
    // Stage 1 has no public "regenerate" action yet, so the second version
    // is inserted directly, exactly simulating what a later stage's own
    // regenerate function would produce.
    it("supersedes the previously-confirmed plan version when a NEW version of the SAME proposal's plan is confirmed", async () => {
      const { ownerUserId, clientId } = await createOwnerAndClient();
      const analysis = await createAnalysis(ownerUserId, clientId);
      const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);
      const outcomeV1 = await createTechnicalDemonstrationPlanFromProposal(ownerUserId, clientId, proposal.id);
      const confirmedV1 = await confirmTechnicalDemonstrationPlan(ownerUserId, outcomeV1.plan.id, null);
      if (!confirmedV1) throw new Error("expected confirmedV1");

      const planV2 = await prisma.technicalDemonstrationPlan.create({
        data: {
          id: randomUUID(),
          ownerUserId,
          clientId,
          analysisProposalId: proposal.id,
          analysisProposalConfirmedAt: new Date(proposal.confirmedAt as string),
          vertical: "cutting",
          status: "DRAFT",
          planVersion: 2,
          schemaVersion: outcomeV1.plan.schemaVersion,
          generatorVersion: `${outcomeV1.plan.generatorVersion}-simulated-v2`,
          requestFingerprint: randomUUID(),
        },
      });

      const confirmedV2 = await confirmTechnicalDemonstrationPlan(ownerUserId, planV2.id, confirmedV1.id);
      expect(confirmedV2?.status).toBe("CONFIRMED");

      const supersededV1 = await findTechnicalDemonstrationPlanForOwner(ownerUserId, outcomeV1.plan.id);
      expect(supersededV1?.status).toBe("SUPERSEDED");
      expect(supersededV1?.supersededByPlanId).toBe(planV2.id);
    });

    it("rejects a confirmation whose expectedCurrentConfirmedPlanId does not match real DB state", async () => {
      const { ownerUserId, clientId } = await createOwnerAndClient();
      const analysis = await createAnalysis(ownerUserId, clientId);
      const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);
      const outcome = await createTechnicalDemonstrationPlanFromProposal(ownerUserId, clientId, proposal.id);

      await expect(confirmTechnicalDemonstrationPlan(ownerUserId, outcome.plan.id, randomUUID())).rejects.toThrow(TechnicalDemonstrationConcurrencyError);
    });

    it("returns null for a nonexistent plan id -- never throws for a plain not-found", async () => {
      const { ownerUserId } = await createOwnerAndClient();
      const result = await confirmTechnicalDemonstrationPlan(ownerUserId, randomUUID(), null);
      expect(result).toBeNull();
    });
  });

  it("listTechnicalDemonstrationStepsForPlan returns every step in order, scoped to the exact plan", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);
    const outcome = await createTechnicalDemonstrationPlanFromProposal(ownerUserId, clientId, proposal.id);

    const steps = await listTechnicalDemonstrationStepsForPlan(ownerUserId, clientId, outcome.plan.id);
    expect(steps.map((s) => s.stepNumber)).toEqual([1, 2, 3]);
    expect(steps.every((s) => s.planId === outcome.plan.id)).toBe(true);
  });
});

async function createOwnerAndClient(existingOwnerUserId?: string): Promise<{ ownerUserId: string; clientId: string }> {
  const ownerUserId = existingOwnerUserId ?? randomUUID();
  if (!existingOwnerUserId) {
    owners.add(ownerUserId);
    await prisma.user.create({
      data: { id: ownerUserId, email: `${ownerUserId}@technical-demonstration.test`, passwordHash: "test", role: "professional", locale: "en" },
    });
  }
  const clientId = randomUUID();
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "Technical Demonstration Client" } });
  return { ownerUserId, clientId };
}

async function createAnalysis(ownerUserId: string, clientId: string) {
  return createAnalysisForOwner(ownerUserId, clientId, {
    goal: "refresh",
    hairType: "medium",
    density: "medium",
    porosity: "low",
    phase: "ready",
    clarificationRound: 0,
    confidenceScore: 0.87,
    uncertaintyReasons: [],
    followUpQuestions: [],
    recommendations: ["Document the service."],
    safetyNotes: ["Perform a strand test."],
  });
}

async function confirmedProposal(ownerUserId: string, clientId: string, analysisId: string, expectedCurrentConfirmedProposalId: string | null = null) {
  const draft = await createProposalForOwner(ownerUserId, clientId, analysisId, "cutting", cuttingPayload(), evidenceSnapshot(), "1.0.0-m8");
  const confirmed = await confirmProposal(ownerUserId, draft.id, ownerUserId, expectedCurrentConfirmedProposalId);
  if (!confirmed) throw new Error("expected confirmed proposal");
  return confirmed;
}

function cuttingPayload(): TechnicalCutPlan {
  return {
    structuralTechnique: "graduation",
    cuttingTechnique: "slice_cutting",
    texturizingTechnique: "point_cutting",
    sectioning: "diagonal_back",
    elevation: "45_deg_graduation",
    distribution: "overdirected_back",
    guideline: "stationary",
    cuttingSteps: [
      { stepNumber: 1, zone: "nape", action: "Establish the guideline.", elevationAngle: "0_deg_blunt", toolRequired: "shears" },
      { stepNumber: 2, zone: "sides", action: "Blend the sides.", elevationAngle: "45_deg_graduation", toolRequired: "shears" },
      { stepNumber: 3, zone: "crown", action: "Connect the crown.", elevationAngle: "90_deg_uniform_layer", toolRequired: "shears" },
    ],
    stylistExplanation: "Explain the sectioning.",
    clientExplanation: "Explain the shape.",
    professionalReason: "Control weight through the interior.",
    warnings: [],
    contraindications: [],
    assumptions: [],
    missingData: [],
    confidence: 0.9,
    stylistValidationDisclaimer: "Validate before cutting.",
    version: "1.0.0-m8",
  };
}

function evidenceSnapshot() {
  return { goal: "refresh", density: "medium", porosity: "low", hairCondition: "virgin_healthy", contraindications: [] };
}
