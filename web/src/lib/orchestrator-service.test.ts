import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

import { describe, expect, it, afterEach } from "vitest";

import { prisma } from "@/lib/prisma";
import { createAnalysisForOwner } from "@/lib/analysis-repository";
import { isOrchestratorDecision } from "@/lib/orchestrator-contracts";
import { resolveOrchestratorDecision } from "@/lib/orchestrator-service";

// AI Concierge / Orchestrator, Stage 1 -- the service layer, tested
// against real Postgres, no mocks -- mirrors this codebase's own
// established convention for every other repository-touching feature
// (video-generation-execution-repository.test.ts and friends).
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

suite("resolveOrchestratorDecision (real Postgres -- security boundary + decision correctness)", () => {
  afterEach(async () => {
    const ownerUserIds = [...owners];
    await prisma.analysis.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownerUserIds } } });
    owners.clear();
  });

  // -------------------------------------------------------------------------
  // Correctness: a real, owned client + analysis resolves and recommends
  // the right existing page.
  // -------------------------------------------------------------------------

  it("resolves a real, owned client + analysis and recommends OPEN_ANALYSIS", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);

    const decision = await resolveOrchestratorDecision({
      message: "show me the expected result",
      roleClass: "professional",
      ownerUserId,
      currentClientId: clientId,
      currentAnalysisId: analysis.id,
    });

    expect(decision.recommendedAction).toBe("OPEN_ANALYSIS");
    expect(decision.targetClientId).toBe(clientId);
    expect(decision.targetAnalysisId).toBe(analysis.id);
    expect(decision.reasonCode).toBe("client_and_analysis_identified");
  });

  it("a known client with no analysis context recommends START_ANALYSIS", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();

    const decision = await resolveOrchestratorDecision({
      message: "analyze this client",
      roleClass: "professional",
      ownerUserId,
      currentClientId: clientId,
    });

    expect(decision.recommendedAction).toBe("START_ANALYSIS");
    expect(decision.targetClientId).toBe(clientId);
  });

  it("no client context at all recommends OPEN_CLIENTS -- never guesses", async () => {
    const { ownerUserId } = await createOwnerAndClient();

    const decision = await resolveOrchestratorDecision({
      message: "show me the expected result",
      roleClass: "professional",
      ownerUserId,
    });

    expect(decision.recommendedAction).toBe("OPEN_CLIENTS");
    expect(decision.targetClientId).toBeNull();
    expect(decision.reasonCode).toBe("no_client_selected");
  });

  // -------------------------------------------------------------------------
  // Test E (task section 13): forged resource ids are rejected by existing
  // server-side authority -- never trusted merely because the caller
  // supplied them.
  // -------------------------------------------------------------------------

  it("a real clientId belonging to a DIFFERENT owner is silently rejected -- never leaked as 'found'", async () => {
    const { ownerUserId: ownerA } = await createOwnerAndClient();
    const { clientId: foreignClientId } = await createOwnerAndClient();

    const decision = await resolveOrchestratorDecision({
      message: "show me the expected result",
      roleClass: "professional",
      ownerUserId: ownerA,
      currentClientId: foreignClientId,
    });

    // Falls back exactly as if no client had been supplied at all --
    // no distinguishable "forbidden" vs "not found" signal is ever leaked.
    expect(decision.currentContext.currentClientId).toBeNull();
    expect(decision.recommendedAction).toBe("OPEN_CLIENTS");
  });

  it("a real analysisId belonging to a DIFFERENT client of the SAME owner is rejected -- cross-client, not just cross-owner", async () => {
    const { ownerUserId, clientId: client1 } = await createOwnerAndClient();
    const { clientId: client2 } = await createOwnerAndClient(ownerUserId);
    const analysisUnderClient2 = await createAnalysis(ownerUserId, client2);

    const decision = await resolveOrchestratorDecision({
      message: "show me the expected result",
      roleClass: "professional",
      ownerUserId,
      currentClientId: client1,
      currentAnalysisId: analysisUnderClient2.id,
    });

    expect(decision.currentContext.currentClientId).toBe(client1);
    expect(decision.currentContext.currentAnalysisId).toBeNull();
    // client1 is real and owned, so this falls through to START_ANALYSIS
    // for client1 -- never silently attaches the wrong client's analysis.
    expect(decision.recommendedAction).toBe("START_ANALYSIS");
  });

  it("a nonexistent clientId/analysisId (never created at all) is rejected the same way a forged one is", async () => {
    const { ownerUserId } = await createOwnerAndClient();

    const decision = await resolveOrchestratorDecision({
      message: "show me the expected result",
      roleClass: "professional",
      ownerUserId,
      currentClientId: randomUUID(),
      currentAnalysisId: randomUUID(),
    });

    expect(decision.currentContext.currentClientId).toBeNull();
    expect(decision.currentContext.currentAnalysisId).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Test F (task section 13): role-inappropriate actions are rejected.
  // -------------------------------------------------------------------------

  it("the public role class gets no available actions in Stage 1, for any intent -- fails honestly", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);

    for (const message of ["show me the expected result", "analyze this client", "prepare a video", "find a client"]) {
      const decision = await resolveOrchestratorDecision({
        message,
        roleClass: "public",
        ownerUserId,
        currentClientId: clientId,
        currentAnalysisId: analysis.id,
      });
      expect(decision.recommendedAction).toBeNull();
      expect(decision.availableActions).toEqual([]);
      expect(decision.reasonCode).toBe("role_not_yet_supported");
    }
  });

  // -------------------------------------------------------------------------
  // The video offer -- task section 5's conversational moment.
  // -------------------------------------------------------------------------

  it("offers video when hasCompletedPhotoPreview is true and a real client+analysis are both resolved", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);

    const decision = await resolveOrchestratorDecision({
      message: "anything, even unrelated text",
      roleClass: "professional",
      ownerUserId,
      currentClientId: clientId,
      currentAnalysisId: analysis.id,
      hasCompletedPhotoPreview: true,
    });

    // Stage 2: the OFFER itself is presentational and NO_INCREMENTAL_COST --
    // MEANINGFUL_COST/requiresUserConsent only apply once the user says yes
    // and the SEPARATE REQUEST_VIDEO action is what gets reached (see the
    // Stage 2 test suite for that boundary).
    expect(decision.recommendedAction).toBe("OFFER_VIDEO");
    expect(decision.reasonCode).toBe("video_offer_after_completed_preview");
    expect(decision.costClass).toBe("NO_INCREMENTAL_COST");
    expect(decision.requiresUserConsent).toBe(false);
    expect(decision.availableActions).toContain("REQUEST_VIDEO");
  });

  it("does NOT offer video when hasCompletedPhotoPreview is true but no real client/analysis is resolved -- the flag alone is never trusted", async () => {
    const { ownerUserId } = await createOwnerAndClient();

    const decision = await resolveOrchestratorDecision({
      message: "anything",
      roleClass: "professional",
      ownerUserId,
      hasCompletedPhotoPreview: true,
    });

    expect(decision.recommendedAction).not.toBe("REQUEST_VIDEO");
    expect(decision.reasonCode).not.toBe("video_offer_after_completed_preview");
  });

  // Stage 2's own "LIVE CONTEXT" trigger: a real, system-observed
  // completion check with NO message at all -- never a fabricated user
  // utterance (see orchestrator-service.ts's own header comment on
  // ResolveOrchestratorDecisionInput.message).
  it("a context-only call (no message at all) still produces the offer -- the system-triggered path, not a fabricated ask", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);

    const decision = await resolveOrchestratorDecision({
      roleClass: "professional",
      ownerUserId,
      currentClientId: clientId,
      currentAnalysisId: analysis.id,
      hasCompletedPhotoPreview: true,
    });

    expect(decision.recommendedAction).toBe("OFFER_VIDEO");
    expect(decision.reasonCode).toBe("video_offer_after_completed_preview");
  });

  it("a context-only call (no message) with no completed-preview flag produces an honest 'unsupported' answer, never a guess", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);

    const decision = await resolveOrchestratorDecision({
      roleClass: "professional",
      ownerUserId,
      currentClientId: clientId,
      currentAnalysisId: analysis.id,
    });

    expect(decision.intent).toBe("unsupported");
    expect(decision.recommendedAction).not.toBe("OFFER_VIDEO");
  });

  // Test I (task section 13): forged/foreign resource context cannot
  // produce an authorized Video handoff -- extends the earlier forged-id
  // tests (which prove the ids themselves are rejected) by proving the
  // SPECIFIC video-offer/handoff path is unreachable through a forged id
  // too, not just the ordinary navigation actions.
  it("I: a forged/foreign clientId with hasCompletedPhotoPreview:true can NEVER produce OFFER_VIDEO or any Video handoff", async () => {
    const { ownerUserId: ownerA } = await createOwnerAndClient();
    const { clientId: foreignClientId } = await createOwnerAndClient();
    const foreignAnalysis = await createAnalysis((await prisma.client.findUniqueOrThrow({ where: { id: foreignClientId } })).ownerUserId, foreignClientId);

    const decision = await resolveOrchestratorDecision({
      roleClass: "professional",
      ownerUserId: ownerA,
      currentClientId: foreignClientId,
      currentAnalysisId: foreignAnalysis.id,
      hasCompletedPhotoPreview: true,
    });

    expect(decision.currentContext.currentClientId).toBeNull();
    expect(decision.currentContext.currentAnalysisId).toBeNull();
    expect(decision.recommendedAction).not.toBe("OFFER_VIDEO");
    expect(decision.recommendedAction).not.toBe("REQUEST_VIDEO");
    expect(decision.costClass).not.toBe("MEANINGFUL_COST");
  });

  it("I: a real analysisId belonging to a DIFFERENT client of the SAME owner, with hasCompletedPhotoPreview:true, cannot produce OFFER_VIDEO", async () => {
    const { ownerUserId, clientId: client1 } = await createOwnerAndClient();
    const { clientId: client2 } = await createOwnerAndClient(ownerUserId);
    const analysisUnderClient2 = await createAnalysis(ownerUserId, client2);

    const decision = await resolveOrchestratorDecision({
      roleClass: "professional",
      ownerUserId,
      currentClientId: client1,
      currentAnalysisId: analysisUnderClient2.id,
      hasCompletedPhotoPreview: true,
    });

    expect(decision.currentContext.currentAnalysisId).toBeNull();
    expect(decision.recommendedAction).not.toBe("OFFER_VIDEO");
  });

  // -------------------------------------------------------------------------
  // Test G (task section 13): orchestration result is schema/type validated.
  // -------------------------------------------------------------------------

  it("every real decision produced by the service passes isOrchestratorDecision", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);

    const messages = ["show me the expected result", "analyze this client", "prepare a video", "find a client", "gibberish unrelated text"];
    for (const message of messages) {
      const decision = await resolveOrchestratorDecision({ message, roleClass: "professional", ownerUserId, currentClientId: clientId, currentAnalysisId: analysis.id });
      expect(isOrchestratorDecision(decision)).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // Test A/B/C (task section 13): structural -- this file cannot call any
  // Video/Photo Preview engine, under any outcome.
  // -------------------------------------------------------------------------

  it("source-level lock: orchestrator-service.ts never references any Video/Photo Preview create/submit/execute function", () => {
    const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "orchestrator-service.ts"), "utf8");
    expect(source).not.toMatch(/generateVideos/);
    expect(source).not.toMatch(/createVideoDemonstrationGeneration/);
    expect(source).not.toMatch(/createPhotoPreviewGeneration/);
    expect(source).not.toMatch(/executeVideoDemonstrationGeneration/);
    expect(source).not.toMatch(/executePhotoPreviewGeneration/);
    expect(source).not.toMatch(/reconcileVideoDemonstrationGeneration/);
  });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function createOwnerAndClient(existingOwnerUserId?: string): Promise<{ ownerUserId: string; clientId: string }> {
  const ownerUserId = existingOwnerUserId ?? randomUUID();
  if (!existingOwnerUserId) {
    owners.add(ownerUserId);
    await prisma.user.create({
      data: { id: ownerUserId, email: `${ownerUserId}@orchestrator-service.test`, passwordHash: "test", role: "professional", locale: "en" },
    });
  }
  const clientId = randomUUID();
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "Orchestrator Service Client" } });
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
