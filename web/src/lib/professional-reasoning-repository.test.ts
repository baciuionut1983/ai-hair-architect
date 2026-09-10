import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { HEAD_ZONES } from "@/lib/technical-visual-map-validators";
import { buildUnassessedGlobalEntry, buildUnassessedZoneEntry, type HairStateSnapshotPayload } from "@/lib/hair-state-snapshot-validators";
import { selectCandidateSkillsForDelta } from "@/lib/hair-state-delta-skill-candidate-selector";
import { buildProfessionalReasoningContext, type ProfessionalReasoningProposal } from "@/lib/professional-reasoning-contracts";
import {
  confirmDraftReasoningProposal,
  createDraftReasoningProposal,
  findCurrentConfirmedReasoningProposal,
  findReasoningProposalByFingerprint,
  findReasoningProposalForOwner,
  ProfessionalReasoningConcurrencyError,
  ProfessionalReasoningStateError,
  rejectDraftReasoningProposal,
} from "@/lib/professional-reasoning-repository";

// Professional Skill Engine, Stage 5 -- PROFESSIONAL REASONING PROPOSAL
// repository, real Postgres, no mocks. Mirrors hair-state-snapshot-
// repository.test.ts's own conventions. Skips (never fails) when no
// database is configured.
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

suite("professional-reasoning-repository (real Postgres)", () => {
  afterEach(async () => {
    const ownerUserIds = [...owners];
    await prisma.professionalReasoningProposal.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownerUserIds } } });
    owners.clear();
  });

  it("1. createDraftReasoningProposal always creates a DRAFT row -- never any other status", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { context, proposal } = buildValidContext();
    const record = await createDraftReasoningProposal({ ownerUserId, clientId, context, provider: "fake-deterministic", model: "fake-1.0", proposal });
    expect(record.status).toBe("DRAFT");
    expect(record.confirmedAt).toBeNull();
  });

  it("2. the frozen context and proposal round-trip byte-for-byte", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { context, proposal } = buildValidContext();
    const created = await createDraftReasoningProposal({ ownerUserId, clientId, context, provider: "fake-deterministic", model: "fake-1.0", proposal });
    const found = await findReasoningProposalForOwner(ownerUserId, created.id);
    expect(found?.context).toEqual(context);
    expect(found?.proposal).toEqual(proposal);
    expect(found?.currentSnapshotId).toBe(context.currentSnapshotId);
    expect(found?.targetSnapshotId).toBe(context.targetSnapshotId);
  });

  it("3. an identical (contextFingerprint, provider, model) is found by fingerprint lookup, never a silent duplicate", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { context, proposal } = buildValidContext();
    const created = await createDraftReasoningProposal({ ownerUserId, clientId, context, provider: "fake-deterministic", model: "fake-1.0", proposal });
    const found = await findReasoningProposalByFingerprint(context.contextFingerprint, "fake-deterministic", "fake-1.0");
    expect(found?.id).toBe(created.id);

    await expect(createDraftReasoningProposal({ ownerUserId, clientId, context, provider: "fake-deterministic", model: "fake-1.0", proposal })).rejects.toThrow();
  });

  it("4. confirmDraftReasoningProposal transitions DRAFT -> CONFIRMED and supersedes the prior confirmed one", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const professionalUserId = ownerUserId;
    const first = await createDraftReasoningProposal({ ownerUserId, clientId, ...buildValidContext() });
    const confirmedFirst = await confirmDraftReasoningProposal(ownerUserId, first.id, professionalUserId, null);
    expect(confirmedFirst?.status).toBe("CONFIRMED");
    expect(confirmedFirst?.confirmedByUserId).toBe(professionalUserId);

    const second = await createDraftReasoningProposal({ ownerUserId, clientId, ...buildValidContext({ variant: 2 }) });
    const confirmedSecond = await confirmDraftReasoningProposal(ownerUserId, second.id, professionalUserId, confirmedFirst!.id);
    expect(confirmedSecond?.status).toBe("CONFIRMED");

    const historicalFirst = await findReasoningProposalForOwner(ownerUserId, first.id);
    expect(historicalFirst?.status).toBe("SUPERSEDED");
    expect(historicalFirst?.supersededByProposalId).toBe(second.id);

    const currentConfirmed = await findCurrentConfirmedReasoningProposal(ownerUserId, clientId);
    expect(currentConfirmed?.id).toBe(second.id);
  });

  it("5. a stale expectedCurrentConfirmedProposalId is rejected -- concurrency-safe", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const first = await createDraftReasoningProposal({ ownerUserId, clientId, ...buildValidContext() });
    await confirmDraftReasoningProposal(ownerUserId, first.id, ownerUserId, null);
    const second = await createDraftReasoningProposal({ ownerUserId, clientId, ...buildValidContext({ variant: 2 }) });
    await expect(confirmDraftReasoningProposal(ownerUserId, second.id, ownerUserId, null)).rejects.toBeInstanceOf(ProfessionalReasoningConcurrencyError);
  });

  it("6. confirming a non-DRAFT proposal is rejected", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const first = await createDraftReasoningProposal({ ownerUserId, clientId, ...buildValidContext() });
    await confirmDraftReasoningProposal(ownerUserId, first.id, ownerUserId, null);
    await expect(confirmDraftReasoningProposal(ownerUserId, first.id, ownerUserId, first.id)).rejects.toBeInstanceOf(ProfessionalReasoningStateError);
  });

  it("7. rejectDraftReasoningProposal transitions DRAFT -> REJECTED -- never auto-confirms, never re-confirmable", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const draft = await createDraftReasoningProposal({ ownerUserId, clientId, ...buildValidContext() });
    const rejected = await rejectDraftReasoningProposal(ownerUserId, draft.id);
    expect(rejected?.status).toBe("REJECTED");
    await expect(confirmDraftReasoningProposal(ownerUserId, draft.id, ownerUserId, null)).rejects.toBeInstanceOf(ProfessionalReasoningStateError);
  });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function createOwnerAndClient() {
  const ownerUserId = randomUUID();
  const clientId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({
    data: { id: ownerUserId, email: `${ownerUserId}@professional-reasoning-repository.test`, passwordHash: "test", role: "professional", locale: "en" },
  });
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "Professional Reasoning Repository Client" } });
  return { ownerUserId, clientId };
}

function basePayload(): HairStateSnapshotPayload {
  return { globalState: buildUnassessedGlobalEntry(), zones: HEAD_ZONES.map((zone) => buildUnassessedZoneEntry(zone)) };
}

function buildValidContext(options: { variant?: number } = {}) {
  const variant = options.variant ?? 1;
  const current = { id: `current-${variant}-${randomUUID()}`, snapshotVersion: 1, payload: basePayload() };
  const target = { id: `target-${variant}-${randomUUID()}`, snapshotVersion: 1, payload: basePayload() };
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
