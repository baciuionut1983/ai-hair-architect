import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import type { ProfessionalExecutionPlan } from "@/lib/professional-execution-plan-contracts";
import {
  confirmDraftExecutionPlan,
  createDraftExecutionPlan,
  ExecutionPlanConcurrencyError,
  ExecutionPlanStateError,
  findCurrentConfirmedExecutionPlan,
  findExecutionPlanForOwner,
  listExecutionPlansForClient,
} from "@/lib/professional-execution-plan-repository";
import { HEAD_ZONES } from "@/lib/technical-visual-map-validators";
import { buildUnassessedGlobalEntry, buildUnassessedZoneEntry, type HairStateSnapshotPayload } from "@/lib/hair-state-snapshot-validators";
import { selectCandidateSkillsForDelta } from "@/lib/hair-state-delta-skill-candidate-selector";
import { buildProfessionalReasoningContext, type ProfessionalReasoningProposal } from "@/lib/professional-reasoning-contracts";
import { createDraftReasoningProposal } from "@/lib/professional-reasoning-repository";

// Professional Skill Engine, Stage 6 -- PROFESSIONAL EXECUTION PLAN
// repository, real Postgres, no mocks. Mirrors professional-reasoning-
// repository.test.ts's own conventions exactly. Skips (never fails) when
// no database is configured.
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

suite("professional-execution-plan-repository (real Postgres)", () => {
  afterEach(async () => {
    const ownerUserIds = [...owners];
    await prisma.professionalExecutionPlan.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.professionalReasoningProposal.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownerUserIds } } });
    owners.clear();
  });

  it("1. createDraftExecutionPlan always creates a DRAFT row -- never any other status", async () => {
    const { ownerUserId, clientId, sourceReasoningProposalId } = await createOwnerClientAndProposal();
    const plan = buildValidPlan();
    const record = await createDraftExecutionPlan({ ownerUserId, clientId, sourceReasoningProposalId, plan });
    expect(record.status).toBe("DRAFT");
    expect(record.confirmedAt).toBeNull();
    expect(record.readiness).toBe(plan.readiness);
  });

  it("2. the frozen plan payload round-trips byte-for-byte -- source snapshot/proposal identity preserved exactly", async () => {
    const { ownerUserId, clientId, sourceReasoningProposalId } = await createOwnerClientAndProposal();
    const plan = buildValidPlan();
    const created = await createDraftExecutionPlan({ ownerUserId, clientId, sourceReasoningProposalId, plan });
    const found = await findExecutionPlanForOwner(ownerUserId, created.id);
    expect(found?.plan).toEqual(plan);
    expect(found?.currentSnapshotId).toBe(plan.currentSnapshotId);
    expect(found?.sourceReasoningProposalId).toBe(sourceReasoningProposalId);
    expect(found?.reasoningProposalContextFingerprint).toBe(plan.reasoningProposalContextFingerprint);
  });

  it("3. confirmDraftExecutionPlan transitions DRAFT -> CONFIRMED and supersedes the prior confirmed one -- the superseded row's own planPayload is never mutated", async () => {
    const { ownerUserId, clientId, sourceReasoningProposalId } = await createOwnerClientAndProposal();
    const professionalUserId = ownerUserId;

    const first = await createDraftExecutionPlan({ ownerUserId, clientId, sourceReasoningProposalId, plan: buildValidPlan() });
    const confirmedFirst = await confirmDraftExecutionPlan(ownerUserId, first.id, professionalUserId, null);
    expect(confirmedFirst?.status).toBe("CONFIRMED");
    expect(confirmedFirst?.confirmedByUserId).toBe(professionalUserId);

    const second = await createDraftExecutionPlan({ ownerUserId, clientId, sourceReasoningProposalId, plan: buildValidPlan({ currentSnapshotVersion: 2 }) });
    const confirmedSecond = await confirmDraftExecutionPlan(ownerUserId, second.id, professionalUserId, confirmedFirst!.id);
    expect(confirmedSecond?.status).toBe("CONFIRMED");

    const historicalFirst = await findExecutionPlanForOwner(ownerUserId, first.id);
    expect(historicalFirst?.status).toBe("SUPERSEDED");
    expect(historicalFirst?.supersededByPlanId).toBe(second.id);
    // Part S -- an approved historical plan's own content is permanently
    // frozen; only lifecycle fields changed.
    expect(historicalFirst?.plan).toEqual(buildValidPlan());

    const currentConfirmed = await findCurrentConfirmedExecutionPlan(ownerUserId, clientId);
    expect(currentConfirmed?.id).toBe(second.id);
  });

  it("4. a stale expectedCurrentConfirmedPlanId is rejected -- concurrency-safe", async () => {
    const { ownerUserId, clientId, sourceReasoningProposalId } = await createOwnerClientAndProposal();
    const first = await createDraftExecutionPlan({ ownerUserId, clientId, sourceReasoningProposalId, plan: buildValidPlan() });
    await confirmDraftExecutionPlan(ownerUserId, first.id, ownerUserId, null);
    const second = await createDraftExecutionPlan({ ownerUserId, clientId, sourceReasoningProposalId, plan: buildValidPlan({ currentSnapshotVersion: 2 }) });
    await expect(confirmDraftExecutionPlan(ownerUserId, second.id, ownerUserId, null)).rejects.toBeInstanceOf(ExecutionPlanConcurrencyError);
  });

  it("5. confirming a non-DRAFT plan is rejected -- and a professional edit always creates a NEW draft row, never an UPDATE to an already-confirmed row's planPayload", async () => {
    const { ownerUserId, clientId, sourceReasoningProposalId } = await createOwnerClientAndProposal();
    const first = await createDraftExecutionPlan({ ownerUserId, clientId, sourceReasoningProposalId, plan: buildValidPlan() });
    await confirmDraftExecutionPlan(ownerUserId, first.id, ownerUserId, null);
    await expect(confirmDraftExecutionPlan(ownerUserId, first.id, ownerUserId, first.id)).rejects.toBeInstanceOf(ExecutionPlanStateError);

    // A "professional edit" (Part L) is persisted as a brand-new DRAFT row
    // pointing at the SAME source proposal -- never a mutation of the
    // first row.
    const edited = await createDraftExecutionPlan({ ownerUserId, clientId, sourceReasoningProposalId, plan: buildValidPlan({ currentSnapshotVersion: 3 }) });
    expect(edited.id).not.toBe(first.id);
    const rows = await listExecutionPlansForClient(ownerUserId, clientId);
    expect(rows).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function createOwnerClientAndProposal() {
  const ownerUserId = randomUUID();
  const clientId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({
    data: { id: ownerUserId, email: `${ownerUserId}@professional-execution-plan-repository.test`, passwordHash: "test", role: "professional", locale: "en" },
  });
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "Professional Execution Plan Repository Client" } });

  const proposal = await createDraftReasoningProposal({ ownerUserId, clientId, ...buildValidReasoningContext() });
  return { ownerUserId, clientId, sourceReasoningProposalId: proposal.id };
}

function basePayload(): HairStateSnapshotPayload {
  return { globalState: buildUnassessedGlobalEntry(), zones: HEAD_ZONES.map((zone) => buildUnassessedZoneEntry(zone)) };
}

function buildValidReasoningContext() {
  const current = { id: `current-${randomUUID()}`, snapshotVersion: 1, payload: basePayload() };
  const target = { id: `target-${randomUUID()}`, snapshotVersion: 1, payload: basePayload() };
  const selection = selectCandidateSkillsForDelta(current, target, []);
  const context = buildProfessionalReasoningContext({ selection });
  const proposal: ProfessionalReasoningProposal = {
    schemaVersion: context.schemaVersion,
    planSummary: "SYNTHETIC -- fixture plan.",
    proposedSkills: [],
    proposedOrder: [],
    preservationConstraints: context.preserveConstraints,
    unresolvedRequirements: [],
    clarifyingQuestions: [],
    reasoningStatus: "COMPLETE_CANDIDATE_PLAN",
  };
  return { context, proposal, provider: "fake-deterministic", model: "fake-1.0" };
}

function buildValidPlan(overrides: Partial<ProfessionalExecutionPlan> = {}): ProfessionalExecutionPlan {
  return {
    schemaVersion: "1.0.0-pep6",
    currentSnapshotId: "current-1",
    currentSnapshotVersion: 1,
    targetSnapshotId: "target-1",
    targetSnapshotVersion: 1,
    reasoningProposalId: "reasoning-proposal-fixture",
    reasoningProposalContextFingerprint: "e".repeat(64),
    plannedUnits: [],
    preservationConstraints: [],
    unresolvedRequirements: [{ scope: "crown", field: "weightIntent", reason: "SYNTHETIC -- no capability." }],
    readiness: "NEEDS_SKILL",
    ...overrides,
  };
}
