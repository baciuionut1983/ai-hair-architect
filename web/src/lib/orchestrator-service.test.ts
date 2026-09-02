import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

import { describe, expect, it, afterEach } from "vitest";

import { prisma } from "@/lib/prisma";
import { createAnalysisForOwner } from "@/lib/analysis-repository";
import { isOrchestratorDecision } from "@/lib/orchestrator-contracts";
import { resolveOrchestratorDecision } from "@/lib/orchestrator-service";
import { ORCHESTRATOR_ACTION_REGISTRY } from "@/lib/orchestrator-action-registry";
import { OrchestratorIntentAiProvider, type OrchestratorIntentAiResult } from "@/lib/orchestrator-ai-intent-provider";

// AI Concierge / Orchestrator, Stage 3 -- a hand-built fake AI provider,
// injected through the real resolveOrchestratorDecision -> buildDecision ->
// classifyOrchestratorIntentHybrid chain via aiClassifierDependencies, so
// these tests prove the FULL real integration (real Postgres ownership
// resolution + real policy composition), not just the hybrid classifier in
// isolation (see orchestrator-hybrid-classifier.test.ts for that). No real
// network call is ever made.
class FakeAiProvider extends OrchestratorIntentAiProvider {
  readonly name = "fake-provider";
  readonly modelVersion = "fake-model";
  constructor(private readonly result: OrchestratorIntentAiResult) {
    super();
  }
  async classify(): Promise<OrchestratorIntentAiResult> {
    return this.result;
  }
}

const GEMINI_ENV = { AI_ANALYSIS_PROVIDER: "gemini", AI_ANALYSIS_API_KEY: "key", AI_ANALYSIS_MODEL: "gemini-2.5-flash" };
const NO_OP_USAGE_RECORDER = async () => {};

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
  // Stage 3: the hybrid AI classifier, wired through the REAL service (real
  // Postgres ownership resolution, real policy composition) -- see
  // orchestrator-hybrid-classifier.test.ts for the classifier's own
  // isolated unit tests (A-G, L-O). These prove the full integration.
  // -------------------------------------------------------------------------

  it("Stage 3: a message the deterministic classifier can't resolve is classified by the injected (fake) AI and reaches the real OPEN_ANALYSIS decision", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);

    const decision = await resolveOrchestratorDecision(
      {
        message: "Aș păstra lungimea, dar aș vrea mai multă mișcare.",
        roleClass: "professional",
        ownerUserId,
        currentClientId: clientId,
        currentAnalysisId: analysis.id,
      },
      {
        aiClassifierDependencies: {
          env: GEMINI_ENV,
          createAiProvider: () => new FakeAiProvider({ semanticIntent: "view_proposed_look", confidence: "high" }),
          recordAiUsageEvent: NO_OP_USAGE_RECORDER,
        },
      },
    );

    expect(decision.recommendedAction).toBe("OPEN_ANALYSIS");
    expect(decision.targetClientId).toBe(clientId);
    expect(decision.targetAnalysisId).toBe(analysis.id);
  });

  // task section 18, test G: a low-confidence AI classification produces
  // the distinct clarification outcome through the REAL service, never a
  // risky guess promoted into a real recommendation.
  it("Stage 3, test G: a low-confidence AI classification produces the clarification decision, not a guessed action", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);

    const decision = await resolveOrchestratorDecision(
      {
        message: "do it",
        roleClass: "professional",
        ownerUserId,
        currentClientId: clientId,
        currentAnalysisId: analysis.id,
      },
      {
        aiClassifierDependencies: {
          env: GEMINI_ENV,
          createAiProvider: () => new FakeAiProvider({ semanticIntent: "view_proposed_look", confidence: "low" }),
          recordAiUsageEvent: NO_OP_USAGE_RECORDER,
        },
      },
    );

    expect(decision.recommendedAction).toBeNull();
    expect(decision.reasonCode).toBe("ambiguous_intent_needs_clarification");
    expect(decision.nextStepCode).toBe("ambiguous_intent_needs_clarification");
    expect(decision.costClass).toBe("NO_INCREMENTAL_COST");
    expect(decision.requiresUserConsent).toBe(false);
    expect(decision.requiresProfessionalApproval).toBe(false);
    expect(isOrchestratorDecision(decision)).toBe(true);
  });

  // task section 18, test J: the AI classifier's own output shape
  // (AiIntentClassificationResult) structurally has no field that could
  // ever influence requiresProfessionalApproval -- this proves it end to
  // end anyway, real service, real registry lookup: no action in Stage 1-3
  // requires professional approval, and an AI classification (even one
  // that tries smuggling an extra, unrecognized field) can never change
  // that, because composeDecision only ever reads it from the STATIC
  // action registry, never from the classifier's output.
  it("Stage 3, test J: AI classification can never manufacture requiresProfessionalApproval -- it always comes from the static registry", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);

    const smuggledResult = { semanticIntent: "request_video_option", confidence: "high", requiresProfessionalApproval: true } as unknown as OrchestratorIntentAiResult;

    const decision = await resolveOrchestratorDecision(
      {
        message: "would you consider a video, maybe",
        roleClass: "professional",
        ownerUserId,
        currentClientId: clientId,
        currentAnalysisId: analysis.id,
      },
      {
        aiClassifierDependencies: {
          env: GEMINI_ENV,
          createAiProvider: () => new FakeAiProvider(smuggledResult),
          recordAiUsageEvent: NO_OP_USAGE_RECORDER,
        },
      },
    );

    expect(decision.recommendedAction).toBe("REQUEST_VIDEO");
    expect(decision.requiresProfessionalApproval).toBe(ORCHESTRATOR_ACTION_REGISTRY.REQUEST_VIDEO.requiresProfessionalApproval);
    expect(decision.requiresProfessionalApproval).toBe(false);
  });

  // task section 18, test H/I: natural-language video phrasing still only
  // ever reaches the existing NAVIGATE-only action -- never anything that
  // could itself submit a real generation, regardless of whether the
  // deterministic or the AI path produced "request_video".
  it("Stage 3, test H: natural-language video phrasing resolves to REQUEST_VIDEO, which the registry proves is navigate-only, never execute", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);

    const decision = await resolveOrchestratorDecision({
      message: "vreau un video cu rezultatul",
      roleClass: "professional",
      ownerUserId,
      currentClientId: clientId,
      currentAnalysisId: analysis.id,
    });

    expect(decision.recommendedAction).toBe("REQUEST_VIDEO");
    const definition = ORCHESTRATOR_ACTION_REGISTRY.REQUEST_VIDEO;
    expect(definition.kind).toBe("navigate");
    expect(definition.changesData).toBe(false);
    expect(definition.canExecuteAutomatically).toBe(false);
    expect(definition.requiresUserConsent).toBe(true);
  });

  it("the classifierSource used internally is never part of the returned, public OrchestratorDecision", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);

    const decision = await resolveOrchestratorDecision({
      message: "show me the expected result",
      roleClass: "professional",
      ownerUserId,
      currentClientId: clientId,
      currentAnalysisId: analysis.id,
    });

    expect(decision).not.toHaveProperty("classifierSource");
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
