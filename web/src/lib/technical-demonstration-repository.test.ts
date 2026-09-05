import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import type { TechnicalCutPlan } from "@/lib/contracts";
import { createAnalysisForOwner } from "@/lib/analysis-repository";
import { prisma } from "@/lib/prisma";
import { confirmProposal, createProposalForOwner, editDraftProposal, rejectProposal } from "@/lib/proposal-repository";
import {
  applyOverridesToDraft,
  confirmTechnicalDemonstrationPlan,
  createTechnicalDemonstrationPlanFromProposal,
  findCurrentConfirmedTechnicalDemonstrationPlan,
  findTechnicalDemonstrationPlanForOwner,
  listTechnicalDemonstrationStepsForPlan,
  resolveEffectiveCuttingStepsForRecord,
  TechnicalDemonstrationConcurrencyError,
  TechnicalDemonstrationDependencyError,
  TechnicalDemonstrationOverrideValidationError,
  TechnicalDemonstrationStateError,
} from "@/lib/technical-demonstration-repository";
import type { CuttingStepOverrideInput } from "@/lib/technical-demonstration-cutting-overrides";
import { TECHNICAL_DEMONSTRATION_CUTTING_GENERATOR_VERSION } from "@/lib/technical-demonstration-derivation";

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

      // Stage 2.5.a: `sectioning` is phase-scoped -- only the
      // PREPARATION_AND_SECTIONING-phase step ("Mapping and sectioning",
      // step 1 of this fixture) genuinely carries it.
      const sectioning = outcome.steps[0].payload.sectioning as { value: unknown; provenance: unknown };
      expect(sectioning.value).toBe("horseshoe_crown"); // the professional's real edited value
      expect(sectioning.value).not.toBe("diagonal_back"); // the stale frozen baseline must never appear
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

      // Stage 2.5.a: each field is only genuinely present on its own
      // applicable-phase step (step 1 = PREPARATION_AND_SECTIONING =
      // sectioning; step 3 = STRUCTURAL_CUTTING = structuralTechnique).
      const sectioning = outcome.steps[0].payload.sectioning as { value: unknown; provenance: unknown };
      const structuralTechnique = outcome.steps[2].payload.structuralTechnique as { value: unknown; provenance: unknown };
      expect(sectioning.provenance).toBe("PROFESSIONAL_OVERRIDE");
      // A field that was NOT edited stays INFERRED -- the override tag
      // is specific to the actually-edited field, never smeared across
      // every plan-level field.
      expect(structuralTechnique.provenance).toBe("INFERRED");
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

      // Stage 2.5.a: both fields are STRUCTURAL_CUTTING-phase-scoped --
      // step 3 ("Bulk and shape control") of this fixture.
      const structuralTechnique = outcome.steps[2].payload.structuralTechnique as { value: unknown; provenance: unknown };
      const combingDirection = outcome.steps[2].payload.combingDirection as { value: unknown; provenance: unknown };
      expect(structuralTechnique).toEqual({ value: "internal_layering", provenance: "PROFESSIONAL_OVERRIDE" }); // last edit wins
      expect(combingDirection).toEqual({
        value: "Comb the section to fall naturally, with no directional pull.",
        provenance: "PROFESSIONAL_OVERRIDE",
      });
    });

    // Required test 1 (repository level): a genuinely UNEDITED confirmed
    // proposal still derives exactly as it did before this fix.
    it("1. an unedited confirmed proposal still derives exactly as before -- every plan-level field stays INFERRED", async () => {
      const { ownerUserId, clientId } = await createOwnerAndClient();
      const analysis = await createAnalysis(ownerUserId, clientId);
      const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id); // never edited

      const outcome = await createTechnicalDemonstrationPlanFromProposal(ownerUserId, clientId, proposal.id);

      // Stage 2.5.a: `sectioning` only genuinely appears on the
      // PREPARATION_AND_SECTIONING-phase step (step 1 of this fixture).
      const sectioning = outcome.steps[0].payload.sectioning as { value: unknown; provenance: unknown };
      expect(sectioning).toEqual({ value: "diagonal_back", provenance: "INFERRED" });
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

  // ---------------------------------------------------------------------
  // Stage 2.5.a -- Cutting V1 professional execution step foundation.
  // ---------------------------------------------------------------------
  describe("Stage 2.5.a -- cutting execution foundation", () => {
    // Required test 3 (real-DB level): steps are assigned to valid
    // execution phases, and that assignment survives a real write.
    it("3. persisted steps carry a valid execution phase, matching the source's own known phase labels", async () => {
      const { ownerUserId, clientId } = await createOwnerAndClient();
      const analysis = await createAnalysis(ownerUserId, clientId);
      const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);
      const outcome = await createTechnicalDemonstrationPlanFromProposal(ownerUserId, clientId, proposal.id);

      const phases = outcome.steps.map((s) => (s.payload.phase as { value: unknown; provenance: unknown }).value);
      expect(phases).toEqual(["PREPARATION_AND_SECTIONING", "GUIDE_AND_STRUCTURE", "STRUCTURAL_CUTTING"]);
    });

    // Required test 15: provenance survives serialization/persistence.
    // Reads back from a FRESH query (not the create() return value) --
    // proves the round-trip through real Postgres JSONB, not just an
    // in-memory object.
    it("15. provenance survives real Postgres JSONB round-trip, for both phase-scoped and always-UNKNOWN fields", async () => {
      const { ownerUserId, clientId } = await createOwnerAndClient();
      const analysis = await createAnalysis(ownerUserId, clientId);
      const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);
      const created = await createTechnicalDemonstrationPlanFromProposal(ownerUserId, clientId, proposal.id);

      const reread = await listTechnicalDemonstrationStepsForPlan(ownerUserId, clientId, created.plan.id);
      expect(reread).toHaveLength(created.steps.length);
      for (let i = 0; i < reread.length; i += 1) {
        expect(reread[i].payload).toEqual(created.steps[i].payload);
      }
      // Spot-check a phase-scoped field and an always-UNKNOWN field
      // specifically, on the freshly re-read rows.
      const sectioning = reread[0].payload.sectioning as { value: unknown; provenance: unknown };
      expect(sectioning).toEqual({ value: "diagonal_back", provenance: "INFERRED" });
      const styling = reread[0].payload.styling as { value: unknown; provenance: unknown };
      expect(styling).toEqual({ value: null, provenance: "UNKNOWN" });
    });

    // Required test 23: existing production-style historical rows (from
    // BEFORE this stage -- e.g. the real DRAFT created during manual
    // production testing, missing every Stage 2.5.a field entirely, on
    // the original "1.0.0-td1" schemaVersion) remain readable and
    // uncorrupted. The repository's own read path
    // (toTechnicalDemonstrationStepRecord) never re-validates a step's
    // payload against the current cutting-specific shape -- proven here
    // with a raw, deliberately OLD-shaped row inserted directly.
    it("23. a pre-Stage-2.5.a historical step row (old schema, missing every new field) remains readable, uncorrupted, and unmodified", async () => {
      const { ownerUserId, clientId } = await createOwnerAndClient();
      const analysis = await createAnalysis(ownerUserId, clientId);
      const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);

      const oldPlan = await prisma.technicalDemonstrationPlan.create({
        data: {
          id: randomUUID(),
          ownerUserId,
          clientId,
          analysisProposalId: proposal.id,
          analysisProposalConfirmedAt: new Date(proposal.confirmedAt as string),
          vertical: "cutting",
          status: "DRAFT",
          planVersion: 1,
          schemaVersion: "1.0.0-td1", // the real, original Stage 1 schema version
          generatorVersion: "1.0.0-td1", // the real, original Stage 1 generator version
          requestFingerprint: randomUUID(),
        },
      });
      const oldShapedPayload = {
        zones: { value: null, provenance: "UNKNOWN" },
        elevation: { value: "0_deg_blunt", provenance: "OBSERVED" },
        tool: { value: "shears", provenance: "OBSERVED" },
        // Deliberately NO `phase`, `fingerAngle`, `subsectionThickness`,
        // `toolOrientation`, `progression`, `stateBefore`, `stateAfter` --
        // this is the exact real-production pre-2.5.a shape.
        sectioning: { value: "diagonal_back", provenance: "INFERRED" },
        guideType: { value: "stationary", provenance: "INFERRED" },
        structuralTechnique: { value: "graduation", provenance: "INFERRED" },
        cuttingTechnique: { value: "slice_cutting", provenance: "INFERRED" },
        texturizingTechnique: { value: "point_cutting", provenance: "INFERRED" },
        combingDirection: { value: "Comb the section overdirected toward the back of the head.", provenance: "INFERRED" },
        overdirection: { value: true, provenance: "INFERRED" },
        headBodyPositioning: { value: null, provenance: "UNKNOWN" },
        fingerPosition: { value: null, provenance: "UNKNOWN" },
        cuttingAngle: { value: null, provenance: "UNKNOWN" },
        cuttingLine: { value: null, provenance: "UNKNOWN" },
        subsectioning: { value: null, provenance: "UNKNOWN" },
        zoneConnection: { value: null, provenance: "UNKNOWN" },
        crossCheck: { value: null, provenance: "UNKNOWN" },
        styling: { value: null, provenance: "UNKNOWN" },
        constraints: [],
      };
      await prisma.technicalDemonstrationStep.create({
        data: {
          id: randomUUID(),
          ownerUserId,
          clientId,
          planId: oldPlan.id,
          vertical: "cutting",
          stepNumber: 1,
          stepSchemaVersion: "1.0.0-td1",
          payload: oldShapedPayload,
          explanation: "A real, pre-2.5.a production step.",
        },
      });

      const rereadSteps = await listTechnicalDemonstrationStepsForPlan(ownerUserId, clientId, oldPlan.id);
      expect(rereadSteps).toHaveLength(1);
      expect(rereadSteps[0].stepSchemaVersion).toBe("1.0.0-td1");
      // The exact old payload, byte-for-byte -- never migrated, never
      // silently backfilled, never rejected.
      expect(rereadSteps[0].payload).toEqual(oldShapedPayload);

      const rereadPlan = await findTechnicalDemonstrationPlanForOwner(ownerUserId, oldPlan.id);
      expect(rereadPlan?.generatorVersion).toBe("1.0.0-td1");
      expect(rereadPlan?.status).toBe("DRAFT");
    });

    // Backward compatibility: the generatorVersion bump this stage
    // introduces must never collide with, or mutate, an existing
    // production DRAFT created under the OLD generator version -- a new
    // derivation for the SAME confirmed proposal produces a genuinely
    // separate, new plan (never touching the old one), exactly the same
    // guarantee that already protects "proposal version N vs N+1" (test
    // 4/25), applied here to a "same proposal, old vs new generator
    // version" scenario.
    it("re-deriving after the Stage 2.5.a generatorVersion bump creates a NEW, separate plan -- the old-generatorVersion DRAFT is never mutated or collided with", async () => {
      const { ownerUserId, clientId } = await createOwnerAndClient();
      const analysis = await createAnalysis(ownerUserId, clientId);
      const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);

      const oldPlan = await prisma.technicalDemonstrationPlan.create({
        data: {
          id: randomUUID(),
          ownerUserId,
          clientId,
          analysisProposalId: proposal.id,
          analysisProposalConfirmedAt: new Date(proposal.confirmedAt as string),
          vertical: "cutting",
          status: "DRAFT",
          planVersion: 1,
          schemaVersion: "1.0.0-td1",
          generatorVersion: "1.0.0-td1", // simulates the real production DRAFT from manual testing
          requestFingerprint: randomUUID(), // a fingerprint that could only ever have been computed under the OLD generatorVersion
        },
      });

      // The real, current code path -- uses the NEW generatorVersion
      // internally (TECHNICAL_DEMONSTRATION_CUTTING_GENERATOR_VERSION).
      const outcome = await createTechnicalDemonstrationPlanFromProposal(ownerUserId, clientId, proposal.id);

      expect(outcome.created).toBe(true); // a genuinely NEW plan, not a collision
      expect(outcome.plan.id).not.toBe(oldPlan.id);
      expect(outcome.plan.planVersion).toBe(2); // the old plan already occupies planVersion 1
      expect(outcome.plan.generatorVersion).not.toBe("1.0.0-td1");

      // The old plan is completely untouched.
      const stillOld = await findTechnicalDemonstrationPlanForOwner(ownerUserId, oldPlan.id);
      expect(stillOld?.status).toBe("DRAFT");
      expect(stillOld?.generatorVersion).toBe("1.0.0-td1");
      expect(stillOld?.planVersion).toBe(1);

      const allPlans = await prisma.technicalDemonstrationPlan.findMany({ where: { ownerUserId, clientId, analysisProposalId: proposal.id } });
      expect(allPlans).toHaveLength(2);
    });

    // Stage 2.5.e.1 -- the SAME guarantee proven above for the Stage 2.5.a
    // generatorVersion bump, now proven for the Stage 2.5.e.1 bump
    // specifically, seeded with the REAL value production's own current V2
    // DRAFT plan was created under ("1.1.0-td25a"). This is invariant C
    // (the new generator version does not collide with the prior one) at
    // the full create-function level, plus invariant D (idempotency
    // resumes immediately after the one-time invalidation -- a second call
    // under the now-current version returns the SAME newly-created plan,
    // never a third).
    it("re-deriving after the Stage 2.5.e.1 generatorVersion bump creates a NEW, separate plan once, then stays idempotent -- the old-generatorVersion DRAFT is never mutated or collided with", async () => {
      const { ownerUserId, clientId } = await createOwnerAndClient();
      const analysis = await createAnalysis(ownerUserId, clientId);
      const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);

      const oldPlan = await prisma.technicalDemonstrationPlan.create({
        data: {
          id: randomUUID(),
          ownerUserId,
          clientId,
          analysisProposalId: proposal.id,
          analysisProposalConfirmedAt: new Date(proposal.confirmedAt as string),
          vertical: "cutting",
          status: "DRAFT",
          planVersion: 1,
          schemaVersion: "1.1.0-td25a",
          generatorVersion: "1.1.0-td25a", // the real value production's own current V2 DRAFT was created under, pre-Stage-2.5.e.1
          requestFingerprint: randomUUID(), // a fingerprint that could only ever have been computed under the OLD generatorVersion
        },
      });

      // The real, current code path -- uses the NEW generatorVersion
      // internally (TECHNICAL_DEMONSTRATION_CUTTING_GENERATOR_VERSION,
      // imported here only to assert against, never to compute the
      // fingerprint ourselves -- the repository's own real code path does
      // that).
      const firstOutcome = await createTechnicalDemonstrationPlanFromProposal(ownerUserId, clientId, proposal.id);

      expect(firstOutcome.created).toBe(true); // invariant C: a genuinely NEW plan, not a collision with the old one
      expect(firstOutcome.plan.id).not.toBe(oldPlan.id);
      expect(firstOutcome.plan.planVersion).toBe(2); // the old plan already occupies planVersion 1
      expect(firstOutcome.plan.generatorVersion).toBe(TECHNICAL_DEMONSTRATION_CUTTING_GENERATOR_VERSION);
      expect(firstOutcome.plan.generatorVersion).not.toBe("1.1.0-td25a");

      // The old plan is completely untouched.
      const stillOld = await findTechnicalDemonstrationPlanForOwner(ownerUserId, oldPlan.id);
      expect(stillOld?.status).toBe("DRAFT");
      expect(stillOld?.generatorVersion).toBe("1.1.0-td25a");
      expect(stillOld?.planVersion).toBe(1);

      // Invariant D: a SECOND call under the now-current version is
      // idempotent again -- it resolves to the SAME newly-created plan,
      // never a third (V4).
      const secondOutcome = await createTechnicalDemonstrationPlanFromProposal(ownerUserId, clientId, proposal.id);
      expect(secondOutcome.created).toBe(false);
      expect(secondOutcome.plan.id).toBe(firstOutcome.plan.id);

      const allPlans = await prisma.technicalDemonstrationPlan.findMany({ where: { ownerUserId, clientId, analysisProposalId: proposal.id } });
      expect(allPlans).toHaveLength(2); // old (v1) + the one new plan (v2) -- never a third
    });
  });

  // ---------------------------------------------------------------------
  // Stage 2.5.b -- professional adjustment layer.
  // ---------------------------------------------------------------------
  describe("Stage 2.5.b -- applyOverridesToDraft / resolveEffectiveCuttingStepsForRecord", () => {
    it("appends a valid override to a DRAFT plan and it is immediately reflected in the effective steps", async () => {
      const { ownerUserId, clientId } = await createOwnerAndClient();
      const analysis = await createAnalysis(ownerUserId, clientId);
      const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);
      const outcome = await createTechnicalDemonstrationPlanFromProposal(ownerUserId, clientId, proposal.id);

      const overrides: CuttingStepOverrideInput[] = [{ op: "set_value", stepNumber: 1, field: "zones", value: ["nape"] }];
      const updated = await applyOverridesToDraft(ownerUserId, clientId, outcome.plan.id, overrides, new Date("2026-09-04T12:00:00.000Z"));
      expect(updated?.professionalOverrides).toHaveLength(1);
      expect((updated!.professionalOverrides[0] as { source: string }).source).toBe("professional");
      expect((updated!.professionalOverrides[0] as { setAt: string }).setAt).toBe("2026-09-04T12:00:00.000Z");

      const steps = await listTechnicalDemonstrationStepsForPlan(ownerUserId, clientId, outcome.plan.id);
      const effectiveSteps = resolveEffectiveCuttingStepsForRecord(updated!, steps);
      const step1 = effectiveSteps.find((s) => s.stepNumber === 1)!;
      expect((step1.payload as { zones: unknown }).zones).toEqual({ value: ["nape"], provenance: "PROFESSIONAL_OVERRIDE" });
    });

    it("multiple overrides across multiple steps all persist and resolve correctly, each scoped to its own step", async () => {
      const { ownerUserId, clientId } = await createOwnerAndClient();
      const analysis = await createAnalysis(ownerUserId, clientId);
      const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);
      const outcome = await createTechnicalDemonstrationPlanFromProposal(ownerUserId, clientId, proposal.id);

      const first = await applyOverridesToDraft(ownerUserId, clientId, outcome.plan.id, [
        { op: "set_value", stepNumber: 1, field: "tool", value: "custom-comb" },
      ]);
      const second = await applyOverridesToDraft(ownerUserId, clientId, outcome.plan.id, [
        { op: "mark_not_applicable", stepNumber: 2, field: "crossCheck" },
      ]);
      expect(second?.professionalOverrides).toHaveLength(2); // both calls append to the SAME array

      const steps = await listTechnicalDemonstrationStepsForPlan(ownerUserId, clientId, outcome.plan.id);
      const effectiveSteps = resolveEffectiveCuttingStepsForRecord(second!, steps);
      const step1 = effectiveSteps.find((s) => s.stepNumber === 1)!;
      const step2 = effectiveSteps.find((s) => s.stepNumber === 2)!;
      expect((step1.payload as { tool: unknown }).tool).toEqual({ value: "custom-comb", provenance: "PROFESSIONAL_OVERRIDE" });
      expect((step2.payload as { crossCheck: unknown }).crossCheck).toEqual({ value: null, provenance: "NOT_APPLICABLE" });
      // Untouched: step 1's own crossCheck and step 2's own tool are unaffected.
      expect((step1.payload as { crossCheck: unknown }).crossCheck).toEqual({ value: null, provenance: "UNKNOWN" });
      void first;
    });

    it("rejects applying an override to a CONFIRMED plan -- the plan is never silently reopened", async () => {
      const { ownerUserId, clientId } = await createOwnerAndClient();
      const analysis = await createAnalysis(ownerUserId, clientId);
      const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);
      const outcome = await createTechnicalDemonstrationPlanFromProposal(ownerUserId, clientId, proposal.id);
      await confirmTechnicalDemonstrationPlan(ownerUserId, outcome.plan.id, null);

      await expect(
        applyOverridesToDraft(ownerUserId, clientId, outcome.plan.id, [{ op: "set_value", stepNumber: 1, field: "tool", value: "x" }]),
      ).rejects.toThrow(TechnicalDemonstrationStateError);

      // And the plan's own overrides remain exactly what they were before the attempt (empty).
      const stillConfirmed = await findTechnicalDemonstrationPlanForOwner(ownerUserId, outcome.plan.id);
      expect(stillConfirmed?.professionalOverrides).toEqual([]);
      expect(stillConfirmed?.status).toBe("CONFIRMED");
    });

    it("rejects an override targeting a stepNumber that does not exist on this plan", async () => {
      const { ownerUserId, clientId } = await createOwnerAndClient();
      const analysis = await createAnalysis(ownerUserId, clientId);
      const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);
      const outcome = await createTechnicalDemonstrationPlanFromProposal(ownerUserId, clientId, proposal.id);

      await expect(
        applyOverridesToDraft(ownerUserId, clientId, outcome.plan.id, [{ op: "set_value", stepNumber: 999, field: "tool", value: "x" }]),
      ).rejects.toThrow(TechnicalDemonstrationOverrideValidationError);

      const stillEmpty = await findTechnicalDemonstrationPlanForOwner(ownerUserId, outcome.plan.id);
      expect(stillEmpty?.professionalOverrides).toEqual([]);
    });

    it("rejects a structurally malformed override input, writing nothing", async () => {
      const { ownerUserId, clientId } = await createOwnerAndClient();
      const analysis = await createAnalysis(ownerUserId, clientId);
      const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);
      const outcome = await createTechnicalDemonstrationPlanFromProposal(ownerUserId, clientId, proposal.id);

      await expect(
        applyOverridesToDraft(ownerUserId, clientId, outcome.plan.id, [
          { op: "set_value", stepNumber: 1, field: "elevation", value: "not_a_real_elevation" },
        ]),
      ).rejects.toThrow(TechnicalDemonstrationOverrideValidationError);

      await expect(applyOverridesToDraft(ownerUserId, clientId, outcome.plan.id, [])).rejects.toThrow(TechnicalDemonstrationOverrideValidationError);
    });

    it("returns null (never throws) for a nonexistent plan id or a foreign owner/client, never leaking existence", async () => {
      const { ownerUserId, clientId } = await createOwnerAndClient();
      const { ownerUserId: otherOwner, clientId: otherClient } = await createOwnerAndClient();
      const analysis = await createAnalysis(ownerUserId, clientId);
      const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);
      const outcome = await createTechnicalDemonstrationPlanFromProposal(ownerUserId, clientId, proposal.id);

      const overrides: CuttingStepOverrideInput[] = [{ op: "set_value", stepNumber: 1, field: "tool", value: "x" }];
      expect(await applyOverridesToDraft(ownerUserId, clientId, randomUUID(), overrides)).toBeNull();
      expect(await applyOverridesToDraft(otherOwner, otherClient, outcome.plan.id, overrides)).toBeNull();
      expect(await applyOverridesToDraft(ownerUserId, otherClient, outcome.plan.id, overrides)).toBeNull();
    });

    it("provenance survives a real Postgres JSONB round-trip for professionalOverrides too", async () => {
      const { ownerUserId, clientId } = await createOwnerAndClient();
      const analysis = await createAnalysis(ownerUserId, clientId);
      const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);
      const outcome = await createTechnicalDemonstrationPlanFromProposal(ownerUserId, clientId, proposal.id);

      await applyOverridesToDraft(ownerUserId, clientId, outcome.plan.id, [
        { op: "set_value", stepNumber: 1, field: "stateBefore", value: "Nape section not yet established.", reason: "professional review" },
      ]);

      const reread = await findTechnicalDemonstrationPlanForOwner(ownerUserId, outcome.plan.id);
      expect(reread?.professionalOverrides).toEqual([
        {
          op: "set_value",
          stepNumber: 1,
          field: "stateBefore",
          value: "Nape section not yet established.",
          source: "professional",
          reason: "professional review",
          setAt: expect.any(String),
        },
      ]);
    });

    it("a plan created before this stage (professionalOverrides column is NULL) reads back as an honest empty array, not an error", async () => {
      const { ownerUserId, clientId } = await createOwnerAndClient();
      const analysis = await createAnalysis(ownerUserId, clientId);
      const proposal = await confirmedProposal(ownerUserId, clientId, analysis.id);
      const outcome = await createTechnicalDemonstrationPlanFromProposal(ownerUserId, clientId, proposal.id);
      // createTechnicalDemonstrationPlanFromProposal never sets
      // professionalOverrides itself -- the column is NULL by construction
      // for a freshly-derived plan, exactly like every real pre-2.5.b
      // production row.
      expect(outcome.plan.professionalOverrides).toEqual([]);

      const steps = await listTechnicalDemonstrationStepsForPlan(ownerUserId, clientId, outcome.plan.id);
      const effectiveSteps = resolveEffectiveCuttingStepsForRecord(outcome.plan, steps);
      expect(effectiveSteps).toEqual(steps); // no overrides -- effective === baseline
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

// Stage 2.5.a note: `cuttingSteps` below uses the EXACT step "zone" label
// strings cutting-plan-engine.ts's own generateTechnicalCutPlan really
// emits ("Mapping and sectioning", "Baseline guideline", "Bulk and shape
// control") -- real production shape, not an arbitrary HeadZone-named
// stand-in, so this fixture correctly exercises the phase-scoped
// propagation fix (see technical-demonstration-derivation.ts's own header
// comment) rather than accidentally landing every step in the honest
// "phase UNKNOWN" fallback.
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
      { stepNumber: 1, zone: "Mapping and sectioning", action: "Establish the guideline.", elevationAngle: "0_deg_blunt", toolRequired: "shears" },
      { stepNumber: 2, zone: "Baseline guideline", action: "Blend the sides.", elevationAngle: "45_deg_graduation", toolRequired: "shears" },
      { stepNumber: 3, zone: "Bulk and shape control", action: "Connect the crown.", elevationAngle: "90_deg_uniform_layer", toolRequired: "shears" },
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
