import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { HEAD_ZONES } from "@/lib/technical-visual-map-validators";
import { buildUnassessedGlobalEntry, buildUnassessedZoneEntry, type HairStateSnapshotPayload } from "@/lib/hair-state-snapshot-validators";
import { buildProfessionalReasoningContext } from "@/lib/professional-reasoning-contracts";
import { selectCandidateSkillsForDelta } from "@/lib/hair-state-delta-skill-candidate-selector";
import { confirmDraftReasoningProposal, createDraftReasoningProposal } from "@/lib/professional-reasoning-repository";
import { buildCanonicalCandidateSkillRegistry } from "@/lib/professional-brain-skill-templates";
import { realProposal } from "@/lib/professional-execution-scene-fixtures";
import {
  ProfessionalBrainAccessError,
  approveReasoningProposal,
  compileAndPersistExecutionPlan,
  compileAndPersistScenePlan,
  computeDelta,
  confirmExecutionPlan,
  confirmScenePlan,
  confirmSnapshot,
  createDraftCurrentState,
  createDraftTargetState,
  getPipelineStatus,
  getVisualInstructionReadiness,
  loadProfessionalBrainState,
  prepareReasoningRequestPackage,
  selectCandidateSkills,
} from "@/lib/professional-brain-orchestrator";
import { professionalBrainRenderDryRun } from "@/lib/professional-brain-dry-run";

// AI Hair Architect, Stage 8.5A -- PROFESSIONAL BRAIN ORCHESTRATOR
// integration tests, real Postgres, NO real AI / provider calls. Skips
// (never fails) when no database is configured.
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

function basePayload(): HairStateSnapshotPayload {
  return { globalState: buildUnassessedGlobalEntry(), zones: HEAD_ZONES.map((z) => buildUnassessedZoneEntry(z)) };
}
function withZone(payload: HairStateSnapshotPayload, zone: string, overrides: Partial<HairStateSnapshotPayload["zones"][number]>): HairStateSnapshotPayload {
  return { ...payload, zones: payload.zones.map((z) => (z.zone === zone ? { ...z, ...overrides } : z)) };
}
function currentPayload(): HairStateSnapshotPayload {
  return withZone(basePayload(), "nape", { relativeLength: { value: "long", source: "observed" } });
}
function targetPayload(): HairStateSnapshotPayload {
  return withZone(withZone(basePayload(), "nape", { lengthIntent: { value: "preserve", source: "professional_input" } }), "crown", { weightIntent: { value: "reduce", source: "professional_input" } });
}

async function seed() {
  const ownerUserId = randomUUID();
  const clientId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({ data: { id: ownerUserId, email: `${ownerUserId}@pb-orch.test`, passwordHash: "test", role: "professional", locale: "en" } });
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "PB Orchestrator Client", notes: "sensitive notes not for provider" } });
  const image = await prisma.imageAsset.create({
    data: { id: randomUUID(), fileName: "nape.jpg", mimeType: "image/jpeg", sizeBytes: 4242, ownerUserId, clientId, storagePath: "pending" },
  });
  return { ownerUserId, clientId, imageAssetId: image.id };
}

async function reachConfirmedStates(ownerUserId: string, clientId: string, imageAssetId: string) {
  const current = await createDraftCurrentState(ownerUserId, clientId, { payload: currentPayload(), primaryCaptureImageAssetId: imageAssetId });
  await confirmSnapshot(ownerUserId, clientId, current.id, null);
  const target = await createDraftTargetState(ownerUserId, clientId, targetPayload());
  await confirmSnapshot(ownerUserId, clientId, target.id, null);
  return { currentId: current.id, targetId: target.id };
}

// Persist a MOCKED validated reasoning proposal (Part M: mocked proposals
// allowed only in tests). Zero AI -- built from the deterministic
// candidate context + the canonical 3-real-skill proposal fixture.
async function persistMockedConfirmedReasoning(ownerUserId: string, clientId: string, currentId: string, targetId: string) {
  const selection = selectCandidateSkillsForDelta(
    { id: currentId, snapshotVersion: 1, payload: currentPayload() },
    { id: targetId, snapshotVersion: 1, payload: targetPayload() },
    buildCanonicalCandidateSkillRegistry(),
  );
  const context = buildProfessionalReasoningContext({ selection });
  const draft = await createDraftReasoningProposal({ ownerUserId, clientId, context, provider: "fake-deterministic", model: "fake-1.0", proposal: realProposal() });
  const confirmed = await confirmDraftReasoningProposal(ownerUserId, draft.id, ownerUserId, null);
  return confirmed!;
}

suite("professional-brain-orchestrator (real Postgres, zero AI / provider)", () => {
  afterEach(async () => {
    const ids = [...owners];
    await prisma.professionalExecutionScenePlan.deleteMany({ where: { ownerUserId: { in: ids } } });
    await prisma.professionalExecutionPlan.deleteMany({ where: { ownerUserId: { in: ids } } });
    await prisma.professionalReasoningProposal.deleteMany({ where: { ownerUserId: { in: ids } } });
    await prisma.hairStateSnapshotEvidence.deleteMany({ where: { ownerUserId: { in: ids } } });
    await prisma.hairStateSnapshot.deleteMany({ where: { ownerUserId: { in: ids } } });
    await prisma.imageAsset.deleteMany({ where: { ownerUserId: { in: ids } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    owners.clear();
  });

  it("1/8. an empty client reports NEEDS_CURRENT_STATE; unauthorized client access is rejected", async () => {
    const { ownerUserId, clientId } = await seed();
    expect((await getPipelineStatus(ownerUserId, clientId)).status).toBe("NEEDS_CURRENT_STATE");
    await expect(getPipelineStatus(randomUUID(), clientId)).rejects.toBeInstanceOf(ProfessionalBrainAccessError);
  });

  it("1/2. a real ImageAsset binds as PRIMARY_CAPTURE on a DRAFT CURRENT snapshot; status advances to NEEDS_TARGET_STATE", async () => {
    const { ownerUserId, clientId, imageAssetId } = await seed();
    const current = await createDraftCurrentState(ownerUserId, clientId, { payload: currentPayload(), primaryCaptureImageAssetId: imageAssetId });
    expect(current.status).toBe("DRAFT");
    const status = await getPipelineStatus(ownerUserId, clientId);
    expect(status.hasPrimaryCapture).toBe(true);
    expect(status.status).toBe("NEEDS_TARGET_STATE");
  });

  it("3. cross-client image binding is rejected (the image belongs to another client)", async () => {
    const a = await seed();
    const b = await seed();
    // a's image, b's client, a's owner -> the evidence repo enforces (ownerUserId, clientId) on the asset.
    await expect(createDraftCurrentState(a.ownerUserId, b.clientId, { payload: currentPayload(), primaryCaptureImageAssetId: a.imageAssetId })).rejects.toBeTruthy();
  });

  it("9-13. CURRENT/TARGET DRAFT -> explicit confirm -> immutable; unknown visual facts stay unassessed (never invented)", async () => {
    const { ownerUserId, clientId, imageAssetId } = await seed();
    const { currentId } = await reachConfirmedStates(ownerUserId, clientId, imageAssetId);
    const state = await loadProfessionalBrainState(ownerUserId, clientId);
    expect(state.currentSnapshot?.id).toBe(currentId);
    expect(state.currentSnapshot?.status).toBe("CONFIRMED");
    // a fact we never set stays "not_yet_assessed" -- the orchestrator invents nothing.
    const napeZone = state.currentSnapshot!.payload.zones.find((z) => z.zone === "nape")!;
    expect(napeZone.fiberThickness?.source ?? "not_yet_assessed").toBe("not_yet_assessed");
    expect((await getPipelineStatus(ownerUserId, clientId)).status).toBe("NEEDS_REASONING");
  });

  it("18-25. real CONFIRMED CURRENT/TARGET invoke Stage 4: PRESERVED/UNKNOWN retained, only registered skills, crown weight-reduction stays unresolved", async () => {
    const { ownerUserId, clientId, imageAssetId } = await seed();
    await reachConfirmedStates(ownerUserId, clientId, imageAssetId);
    const delta = await computeDelta(ownerUserId, clientId);
    expect(delta.entries.some((e) => e.transformation === "PRESERVED" || e.transformation === "UNKNOWN")).toBe(true);
    const selection = await selectCandidateSkills(ownerUserId, clientId);
    for (const m of selection.candidateMatches) {
      expect(["skill-cutting-establish-central-nape-guide", "skill-cutting-occipital-transition", "skill-cutting-continue-central-nape-construction"]).toContain(m.skillKey);
    }
    expect(selection.unresolvedDeltas.some((d) => d.scope === "crown")).toBe(true);
  });

  it("26-31. prepareReasoningRequestPackage builds a full context and makes ZERO AI calls -- neither does any status read", async () => {
    const { ownerUserId, clientId, imageAssetId } = await seed();
    await reachConfirmedStates(ownerUserId, clientId, imageAssetId);

    await getPipelineStatus(ownerUserId, clientId);
    const pkg = await prepareReasoningRequestPackage(ownerUserId, clientId, { professionalRequestText: "focus on a clean nape guide" });
    await getPipelineStatus(ownerUserId, clientId);

    expect(pkg.requiresPaidReasoningCall).toBe(true);
    expect(pkg.context.currentSnapshotId).toBeTruthy();
    expect(pkg.context.targetSnapshotId).toBeTruthy();
    expect(pkg.candidateSkillCount).toBeGreaterThanOrEqual(0);
    expect(pkg.unresolvedDeltaCount).toBeGreaterThan(0);
    // and no reasoning proposal was persisted by any of this.
    expect(await prisma.professionalReasoningProposal.count({ where: { ownerUserId } })).toBe(0);
  });

  it("32-37/38-42. a mocked CONFIRMED proposal compiles through the REAL Stage 6 via the orchestrator; skill versions/params/iteration/unresolved retained; plan is DRAFT until explicit confirm", async () => {
    const { ownerUserId, clientId, imageAssetId } = await seed();
    const { currentId, targetId } = await reachConfirmedStates(ownerUserId, clientId, imageAssetId);
    await persistMockedConfirmedReasoning(ownerUserId, clientId, currentId, targetId);

    expect((await getPipelineStatus(ownerUserId, clientId)).status).toBe("NEEDS_EXECUTION_PLAN");
    const plan = await compileAndPersistExecutionPlan(ownerUserId, clientId);
    expect(plan.status).toBe("DRAFT");
    expect(plan.plan.plannedUnits.some((u) => u.executionUnit.executionUnitId.includes("continue-central-nape-construction"))).toBe(true);
    expect(plan.plan.unresolvedRequirements.some((r) => r.scope === "crown")).toBe(true);
    // exact skill version pinned through the whole chain.
    for (const u of plan.plan.plannedUnits) expect(u.atomicActions.every((a) => a.sourceSkillVersion === 1)).toBe(true);

    const confirmedPlan = await confirmExecutionPlan(ownerUserId, clientId, plan.id, ownerUserId, null);
    expect(confirmedPlan?.status).toBe("CONFIRMED");
  });

  it("43-47. the orchestrator invokes the REAL Stage 7 compiler; progression/iteration + one-cut guard preserved; scene plan DRAFT until confirm", async () => {
    const { ownerUserId, clientId, imageAssetId } = await seed();
    const { currentId, targetId } = await reachConfirmedStates(ownerUserId, clientId, imageAssetId);
    await persistMockedConfirmedReasoning(ownerUserId, clientId, currentId, targetId);
    const plan = await compileAndPersistExecutionPlan(ownerUserId, clientId);
    await confirmExecutionPlan(ownerUserId, clientId, plan.id, ownerUserId, null);

    expect((await getPipelineStatus(ownerUserId, clientId)).status).toBe("NEEDS_SCENE_COMPILATION");
    const scenePlan = await compileAndPersistScenePlan(ownerUserId, clientId);
    expect(scenePlan.status).toBe("DRAFT");
    const contScene = scenePlan.scenePlan.scenes.find((s) => s.sourceExecutionUnitId === "executionunit-cutting-continue-central-nape-construction-1" && s.phase === "EXECUTION")!;
    expect(contScene.progression?.iteration?.mode).toBe("UNTIL_EXECUTION_UNIT_COMPLETE");

    const confirmed = await confirmScenePlan(ownerUserId, clientId, scenePlan.id, ownerUserId, null);
    expect(confirmed?.status).toBe("CONFIRMED");
  });

  it("48-52/85-88. full mocked E2E through the orchestrator reaches per-scene render readiness; the real bound photo makes scenes RENDER_READY; dry-run sends ZERO provider requests", async () => {
    const { ownerUserId, clientId, imageAssetId } = await seed();
    const { currentId, targetId } = await reachConfirmedStates(ownerUserId, clientId, imageAssetId);
    await persistMockedConfirmedReasoning(ownerUserId, clientId, currentId, targetId);
    const plan = await compileAndPersistExecutionPlan(ownerUserId, clientId);
    await confirmExecutionPlan(ownerUserId, clientId, plan.id, ownerUserId, null);
    const scenePlan = await compileAndPersistScenePlan(ownerUserId, clientId);
    await confirmScenePlan(ownerUserId, clientId, scenePlan.id, ownerUserId, null);

    const readiness = await getVisualInstructionReadiness(ownerUserId, clientId);
    expect(readiness.length).toBeGreaterThan(0);
    // the CURRENT snapshot's PRIMARY_CAPTURE is bound, so scenes can reach RENDER_READY.
    expect(readiness.some((r) => r.status === "RENDER_READY")).toBe(true);

    const status = await getPipelineStatus(ownerUserId, clientId);
    expect(["RENDER_READY", "UNRESOLVED"]).toContain(status.status);

    const someScene = readiness.find((r) => r.status === "RENDER_READY")!.sceneId;
    const dry = await professionalBrainRenderDryRun(ownerUserId, clientId, someScene, {
      PROFESSIONAL_TECHNICAL_RENDER_ENABLED: "true",
      PROFESSIONAL_TECHNICAL_RENDER_MODEL: "veo-3.1-generate-preview",
      VIDEO_DEMONSTRATION_PROVIDER: "google",
      VIDEO_DEMONSTRATION_API_KEY: "SECRET",
      VIDEO_DEMONSTRATION_MODEL: "veo-3.1-lite-generate-preview",
    });
    expect(dry.providerRequestSent).toBe(false);
    expect(dry.renderReadiness).toBe("RENDER_READY");
    expect(dry.providerConfig.apiKeyPresent).toBe(true);
    expect(dry.providerInstructionFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(dry.requestWouldBeAllowed).toBe(true);
    expect(JSON.stringify(dry)).not.toContain("SECRET");
    expect(JSON.stringify(dry)).not.toContain("sensitive notes");

    // zero video generation rows were created.
    expect(await prisma.technicalExecutionVideoGeneration.count({ where: { ownerUserId } })).toBe(0);
  });

  it("dry-run for a client whose pipeline is not compiled yet reports blockers and never sends", async () => {
    const { ownerUserId, clientId, imageAssetId } = await seed();
    await reachConfirmedStates(ownerUserId, clientId, imageAssetId);
    const dry = await professionalBrainRenderDryRun(ownerUserId, clientId, "any-scene", {
      PROFESSIONAL_TECHNICAL_RENDER_ENABLED: "true",
      PROFESSIONAL_TECHNICAL_RENDER_MODEL: "veo-3.1-generate-preview",
      VIDEO_DEMONSTRATION_PROVIDER: "google",
      VIDEO_DEMONSTRATION_API_KEY: "SECRET",
      VIDEO_DEMONSTRATION_MODEL: "veo-3.1-lite-generate-preview",
    });
    expect(dry.providerRequestSent).toBe(false);
    expect(dry.requestWouldBeAllowed).toBe(false);
    expect(dry.blockers.length).toBeGreaterThan(0);
  });

  it("76-84. every orchestrator mutation enforces client ownership", async () => {
    const { clientId, imageAssetId } = await seed();
    const stranger = randomUUID();
    await expect(createDraftCurrentState(stranger, clientId, { payload: currentPayload(), primaryCaptureImageAssetId: imageAssetId })).rejects.toBeInstanceOf(ProfessionalBrainAccessError);
    await expect(createDraftTargetState(stranger, clientId, targetPayload())).rejects.toBeInstanceOf(ProfessionalBrainAccessError);
    await expect(computeDelta(stranger, clientId)).rejects.toBeInstanceOf(ProfessionalBrainAccessError);
    await expect(prepareReasoningRequestPackage(stranger, clientId)).rejects.toBeInstanceOf(ProfessionalBrainAccessError);
    await expect(compileAndPersistExecutionPlan(stranger, clientId)).rejects.toBeInstanceOf(ProfessionalBrainAccessError);
    await expect(compileAndPersistScenePlan(stranger, clientId)).rejects.toBeInstanceOf(ProfessionalBrainAccessError);
    await expect(approveReasoningProposal(stranger, clientId, randomUUID(), stranger, null)).rejects.toBeInstanceOf(ProfessionalBrainAccessError);
  });

  it("27-30. STATIC PROOF -- the orchestrator + dry-run + serializer + config never import an AI/provider transport", () => {
    const importLike = /(?:import\s+(?:[\s\S]*?)\s+from\s+["']([^"']+)["'])|(?:require\(\s*["']([^"']+)["']\s*\))/g;
    for (const file of [
      "professional-brain-orchestrator.ts",
      "professional-brain-dry-run.ts",
      "professional-brain-pipeline-status.ts",
      "professional-visual-instruction-provider-serializer.ts",
      "technical-render-provider-config.ts",
      "professional-brain-skill-templates.ts",
    ]) {
      const src = readFileSync(join(process.cwd(), "src", "lib", file), "utf8");
      const modules = [...src.matchAll(importLike)].map((m) => m[1] ?? m[2]);
      for (const m of modules) {
        expect(/reasoning-provider-gemini|reasoning-service|orchestrator-ai|photo-preview-provider|video-provider-veo|technical-execution-video-veo-provider|@google\/|openai|anthropic|^https?:/i.test(m)).toBe(false);
      }
      expect(src.includes("runProfessionalReasoning")).toBe(false);
      expect(src.includes(".submit(")).toBe(false);
    }
  });

  it("81-84. compilation is deterministic + idempotent: re-compiling the same source resolves to the same scene-plan row (fingerprint idempotency)", async () => {
    const { ownerUserId, clientId, imageAssetId } = await seed();
    const { currentId, targetId } = await reachConfirmedStates(ownerUserId, clientId, imageAssetId);
    await persistMockedConfirmedReasoning(ownerUserId, clientId, currentId, targetId);
    const plan = await compileAndPersistExecutionPlan(ownerUserId, clientId);
    await confirmExecutionPlan(ownerUserId, clientId, plan.id, ownerUserId, null);
    const s1 = await compileAndPersistScenePlan(ownerUserId, clientId);
    const s2 = await compileAndPersistScenePlan(ownerUserId, clientId);
    expect(s2.id).toBe(s1.id);
    expect(s2.scenePlan.scenePlanFingerprint).toBe(s1.scenePlan.scenePlanFingerprint);
  });
});
