import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { HEAD_ZONES } from "@/lib/technical-visual-map-validators";
import { buildUnassessedGlobalEntry, buildUnassessedZoneEntry, type HairStateSnapshotPayload } from "@/lib/hair-state-snapshot-validators";
import { selectCandidateSkillsForDelta } from "@/lib/hair-state-delta-skill-candidate-selector";
import { buildProfessionalReasoningContext, type ProfessionalReasoningProposal } from "@/lib/professional-reasoning-contracts";
import { createDraftReasoningProposal } from "@/lib/professional-reasoning-repository";
import { createDraftExecutionPlan } from "@/lib/professional-execution-plan-repository";
import { compileProfessionalExecutionScenePlan } from "@/lib/professional-execution-scene-compiler";
import { compileRealExecutionPlan, realTemplates, SCENE_COMPILED_AT } from "@/lib/professional-execution-scene-fixtures";
import {
  confirmDraftScenePlan,
  createDraftScenePlan,
  findCurrentConfirmedScenePlan,
  findScenePlanByFingerprint,
  findScenePlanForOwner,
  listScenePlansForClient,
  ScenePlanConcurrencyError,
  ScenePlanStateError,
} from "@/lib/professional-execution-scene-repository";

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

suite("professional-execution-scene-repository (real Postgres)", () => {
  afterEach(async () => {
    const ids = [...owners];
    await prisma.professionalExecutionScenePlan.deleteMany({ where: { ownerUserId: { in: ids } } });
    await prisma.professionalExecutionPlan.deleteMany({ where: { ownerUserId: { in: ids } } });
    await prisma.professionalReasoningProposal.deleteMany({ where: { ownerUserId: { in: ids } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    owners.clear();
  });

  it("1. createDraftScenePlan always creates a DRAFT row, bound to the real source execution plan; the payload round-trips byte-for-byte", async () => {
    const { ownerUserId, clientId, executionPlanId } = await seed();
    const scenePlan = compileSceneFor(executionPlanId);

    const { record, created } = await createDraftScenePlan({ ownerUserId, clientId, sourceExecutionPlanId: executionPlanId, scenePlan });
    expect(created).toBe(true);
    expect(record.status).toBe("DRAFT");
    expect(record.confirmedAt).toBeNull();
    expect(record.readiness).toBe(scenePlan.readiness);

    const found = await findScenePlanForOwner(ownerUserId, record.id);
    expect(found?.scenePlan).toEqual(scenePlan);
    expect(found?.sourceExecutionPlanId).toBe(executionPlanId);
    expect(found?.sourceExecutionPlanFingerprint).toBe(scenePlan.sourceExecutionPlanFingerprint);
  });

  it("2. createDraftScenePlan is idempotent on scenePlanFingerprint -- a second identical compile resolves to the SAME row, never a duplicate", async () => {
    const { ownerUserId, clientId, executionPlanId } = await seed();
    const scenePlan = compileSceneFor(executionPlanId);
    const first = await createDraftScenePlan({ ownerUserId, clientId, sourceExecutionPlanId: executionPlanId, scenePlan });
    const second = await createDraftScenePlan({ ownerUserId, clientId, sourceExecutionPlanId: executionPlanId, scenePlan });
    expect(second.created).toBe(false);
    expect(second.record.id).toBe(first.record.id);
    const byFp = await findScenePlanByFingerprint(scenePlan.scenePlanFingerprint);
    expect(byFp?.id).toBe(first.record.id);
    expect(await listScenePlansForClient(ownerUserId, clientId)).toHaveLength(1);
  });

  it("3. confirmDraftScenePlan transitions DRAFT -> CONFIRMED and supersedes the prior confirmed one for the same source plan; the superseded row's payload is frozen", async () => {
    const { ownerUserId, clientId, executionPlanId } = await seed();
    const first = await createDraftScenePlan({ ownerUserId, clientId, sourceExecutionPlanId: executionPlanId, scenePlan: compileSceneFor(executionPlanId) });
    const confirmedFirst = await confirmDraftScenePlan(ownerUserId, first.record.id, ownerUserId, null);
    expect(confirmedFirst?.status).toBe("CONFIRMED");

    // a "regenerated" scene plan (different fingerprint) for the same source plan
    const regenerated = compileSceneFor(executionPlanId);
    const bumped = { ...regenerated, scenePlanFingerprint: "9".repeat(64), compilerVersion: "1.0.0-rev2" };
    const second = await createDraftScenePlan({ ownerUserId, clientId, sourceExecutionPlanId: executionPlanId, scenePlan: bumped });
    const confirmedSecond = await confirmDraftScenePlan(ownerUserId, second.record.id, ownerUserId, confirmedFirst!.id);
    expect(confirmedSecond?.status).toBe("CONFIRMED");

    const historical = await findScenePlanForOwner(ownerUserId, first.record.id);
    expect(historical?.status).toBe("SUPERSEDED");
    expect(historical?.supersededByScenePlanId).toBe(second.record.id);
    expect(historical?.scenePlan).toEqual(compileSceneFor(executionPlanId)); // payload never mutated

    const current = await findCurrentConfirmedScenePlan(ownerUserId, executionPlanId);
    expect(current?.id).toBe(second.record.id);
  });

  it("4. a stale expectedCurrentConfirmedScenePlanId is rejected -- concurrency-safe", async () => {
    const { ownerUserId, clientId, executionPlanId } = await seed();
    const first = await createDraftScenePlan({ ownerUserId, clientId, sourceExecutionPlanId: executionPlanId, scenePlan: compileSceneFor(executionPlanId) });
    await confirmDraftScenePlan(ownerUserId, first.record.id, ownerUserId, null);
    const second = await createDraftScenePlan({
      ownerUserId,
      clientId,
      sourceExecutionPlanId: executionPlanId,
      scenePlan: { ...compileSceneFor(executionPlanId), scenePlanFingerprint: "8".repeat(64) },
    });
    await expect(confirmDraftScenePlan(ownerUserId, second.record.id, ownerUserId, null)).rejects.toBeInstanceOf(ScenePlanConcurrencyError);
  });

  it("5. confirming a non-DRAFT scene plan is rejected; a compile is only ever a new DRAFT row, never an UPDATE to a confirmed one", async () => {
    const { ownerUserId, clientId, executionPlanId } = await seed();
    const first = await createDraftScenePlan({ ownerUserId, clientId, sourceExecutionPlanId: executionPlanId, scenePlan: compileSceneFor(executionPlanId) });
    await confirmDraftScenePlan(ownerUserId, first.record.id, ownerUserId, null);
    await expect(confirmDraftScenePlan(ownerUserId, first.record.id, ownerUserId, first.record.id)).rejects.toBeInstanceOf(ScenePlanStateError);
  });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function basePayload(): HairStateSnapshotPayload {
  return { globalState: buildUnassessedGlobalEntry(), zones: HEAD_ZONES.map((zone) => buildUnassessedZoneEntry(zone)) };
}

function buildReasoningContext() {
  const current = { id: `current-${randomUUID()}`, snapshotVersion: 1, payload: basePayload() };
  const target = { id: `target-${randomUUID()}`, snapshotVersion: 1, payload: basePayload() };
  const selection = selectCandidateSkillsForDelta(current, target, []);
  const context = buildProfessionalReasoningContext({ selection });
  const proposal: ProfessionalReasoningProposal = {
    schemaVersion: context.schemaVersion,
    planSummary: "SYNTHETIC -- fixture.",
    proposedSkills: [],
    proposedOrder: [],
    preservationConstraints: context.preserveConstraints,
    unresolvedRequirements: [],
    clarifyingQuestions: [],
    reasoningStatus: "COMPLETE_CANDIDATE_PLAN",
  };
  return { context, proposal, provider: "fake-deterministic", model: "fake-1.0" };
}

async function seed() {
  const ownerUserId = randomUUID();
  const clientId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({ data: { id: ownerUserId, email: `${ownerUserId}@scene-repo.test`, passwordHash: "test", role: "professional", locale: "en" } });
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "Scene Repo Client" } });

  const proposal = await createDraftReasoningProposal({ ownerUserId, clientId, ...buildReasoningContext() });
  const executionPlan = await createDraftExecutionPlan({ ownerUserId, clientId, sourceReasoningProposalId: proposal.id, plan: compileRealExecutionPlan() });
  return { ownerUserId, clientId, executionPlanId: executionPlan.id };
}

function compileSceneFor(sourceExecutionPlanId: string) {
  const result = compileProfessionalExecutionScenePlan({
    plan: compileRealExecutionPlan(),
    sourceExecutionPlanId,
    templates: realTemplates(),
    compiledAt: SCENE_COMPILED_AT,
  });
  if (result.status !== "COMPILED") throw new Error("scene plan did not compile in the repo fixture");
  return result.scenePlan;
}
