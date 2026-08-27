import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import type { TechnicalCutPlan } from "@/lib/contracts";
import { createAnalysisForOwner } from "@/lib/analysis-repository";
import { prisma } from "@/lib/prisma";
import {
  ProposalConcurrencyError,
  ProposalDependencyError,
  ProposalPersistenceError,
  ProposalStateError,
  ProposalValidationError,
  confirmProposal,
  createProposalForOwner,
  editDraftProposal,
  findCurrentConfirmedProposal,
  findProposalForOwner,
  listProposalsForOwner,
  rejectProposal,
  type ProposalRecord,
} from "@/lib/proposal-repository";
import type { ProposalEditEntry } from "@/lib/proposal-validators";

// Real Postgres, not mocks -- exactly the style of
// tests/integration/analysis-repository.integration.test.ts. The Stage 2
// guarantees this suite proves depend on genuine database behaviour: a
// serializable transaction retry loop, a hand-authored partial unique index
// backstopping a concurrent-confirmation race, and JSON provenance that stays
// frozen after its source rows change. Skips (never fails) when no database is
// configured; tests/test-bootstrap.ts promotes TEST_DATABASE_URL when present.
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

suite("proposal-repository (durable AnalysisProposal domain layer)", () => {
  afterEach(async () => {
    const ownerUserIds = [...owners];
    await prisma.analysisProposal.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.consultationMessage.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.professionalMemoryAudit.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.professionalMemory.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.analysis.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownerUserIds } } });
    owners.clear();
  });

  // -------------------------------------------------------------------------
  // createProposalForOwner
  // -------------------------------------------------------------------------

  it("creates a DRAFT proposal from an owned analysis and freezes analysisSnapshotAt from the source Analysis.updatedAt", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    const payload = cuttingPayload();

    const proposal = await createProposalForOwner(
      ownerUserId,
      clientId,
      analysis.id,
      "cutting",
      payload,
      evidenceSnapshot(),
      "1.0.0-m8",
    );

    expect(proposal).toMatchObject({
      ownerUserId,
      clientId,
      analysisId: analysis.id,
      vertical: "cutting",
      status: "DRAFT",
      engineVersion: "1.0.0-m8",
      confirmedByUserId: null,
      confirmedAt: null,
      rejectedAt: null,
      supersededByProposalId: null,
    });
    expect(proposal.payload).toEqual(payload);
    expect(proposal.edits).toEqual([]);
    expect(proposal.consideredMemory).toEqual([]);
    expect(proposal.promotedConsultationSources).toEqual([]);

    const sourceRow = await prisma.analysis.findUniqueOrThrow({ where: { id: analysis.id } });
    expect(new Date(proposal.analysisSnapshotAt).getTime()).toBe(sourceRow.updatedAt.getTime());

    // The row genuinely landed in Postgres with the owner-scoped shape.
    const row = await prisma.analysisProposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(row).toMatchObject({
      ownerUserId,
      clientId,
      analysisId: analysis.id,
      vertical: "cutting",
      status: "DRAFT",
    });
    expect(row.edits).toBeNull();
  });

  it("rejects creation for a client owned by a different professional and writes no row", async () => {
    const a = await createOwnerAndClient();
    const b = await createOwnerAndClient();
    const analysisA = await createAnalysis(a.ownerUserId, a.clientId);

    const error = await createProposalForOwner(
      a.ownerUserId,
      b.clientId, // belongs to owner B
      analysisA.id,
      "cutting",
      cuttingPayload(),
      evidenceSnapshot(),
      "1.0.0-m8",
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProposalDependencyError);
    expect(error).toMatchObject({ code: "PROPOSAL_CLIENT_NOT_FOUND", httpStatus: 404 });

    await expect(
      prisma.analysisProposal.count({ where: { ownerUserId: { in: [a.ownerUserId, b.ownerUserId] } } }),
    ).resolves.toBe(0);
  });

  it("rejects creation when the analysis belongs to a different client of the same owner, and writes no row", async () => {
    const { ownerUserId, clientId: clientOne } = await createOwnerAndClient();
    const clientTwo = randomUUID();
    await prisma.client.create({ data: { id: clientTwo, ownerUserId, fullName: "Second Client" } });
    const analysisOne = await createAnalysis(ownerUserId, clientOne);

    const error = await createProposalForOwner(
      ownerUserId,
      clientTwo,
      analysisOne.id, // belongs to clientOne
      "cutting",
      cuttingPayload(),
      evidenceSnapshot(),
      "1.0.0-m8",
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProposalDependencyError);
    expect(error).toMatchObject({ code: "PROPOSAL_ANALYSIS_CLIENT_MISMATCH" });

    await expect(prisma.analysisProposal.count({ where: { ownerUserId } })).resolves.toBe(0);
  });

  it("rejects creation for a vertical outside the PROPOSAL_VERTICALS allowlist before touching the database", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);

    await expect(
      createProposalForOwner(
        ownerUserId,
        clientId,
        analysis.id,
        "coloring",
        cuttingPayload(),
        evidenceSnapshot(),
        "1.0.0-m8",
      ),
    ).rejects.toMatchObject({ name: "ProposalValidationError", code: "PROPOSAL_INVALID_VERTICAL" });

    await expect(prisma.analysisProposal.count({ where: { ownerUserId } })).resolves.toBe(0);
  });

  it("rejects creation when the cutting payload is not a structurally valid TechnicalCutPlan", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);

    await expect(
      createProposalForOwner(
        ownerUserId,
        clientId,
        analysis.id,
        "cutting",
        { ...cuttingPayload(), cuttingSteps: [{ stepNumber: 0 }] },
        evidenceSnapshot(),
        "1.0.0-m8",
      ),
    ).rejects.toMatchObject({ name: "ProposalValidationError", code: "PROPOSAL_INVALID_PAYLOAD" });

    await expect(prisma.analysisProposal.count({ where: { ownerUserId } })).resolves.toBe(0);
  });

  // -------------------------------------------------------------------------
  // findProposalForOwner
  // -------------------------------------------------------------------------

  it("findProposalForOwner is owner-scoped and returns null (never throws) for a proposal that is not the caller's", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const other = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    const proposal = await draftProposal(ownerUserId, clientId, analysis.id);

    await expect(findProposalForOwner(ownerUserId, proposal.id)).resolves.toMatchObject({ id: proposal.id });
    await expect(findProposalForOwner(other.ownerUserId, proposal.id)).resolves.toBeNull();
    await expect(findProposalForOwner(randomUUID(), proposal.id)).resolves.toBeNull();
    await expect(findProposalForOwner(ownerUserId, randomUUID())).resolves.toBeNull();
  });

  // -------------------------------------------------------------------------
  // editDraftProposal
  // -------------------------------------------------------------------------

  it("editDraftProposal records the edit as an additive layer and never mutates the frozen payload", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    const payload = cuttingPayload();
    const proposal = await createProposalForOwner(
      ownerUserId,
      clientId,
      analysis.id,
      "cutting",
      payload,
      evidenceSnapshot(),
      "1.0.0-m8",
    );

    const firstEdit: ProposalEditEntry = {
      field: "guideline",
      previousValue: "stationary",
      newValue: "traveling",
      source: "stylist_confirmed",
      reason: "Client wants a softer, travelled perimeter.",
    };
    const afterFirst = await editDraftProposal(ownerUserId, proposal.id, [firstEdit]);

    expect(afterFirst?.status).toBe("DRAFT");
    expect(afterFirst?.edits).toHaveLength(1);
    expect(afterFirst?.edits[0]).toMatchObject({
      field: "guideline",
      previousValue: "stationary",
      newValue: "traveling",
      source: "stylist_confirmed",
      reason: "Client wants a softer, travelled perimeter.",
    });
    // The frozen engine baseline is untouched.
    expect(afterFirst?.payload).toEqual(payload);

    // A second edit APPENDS -- it does not replace.
    const afterSecond = await editDraftProposal(ownerUserId, proposal.id, [
      { field: "elevation", previousValue: "45_deg_graduation", newValue: "0_deg_blunt", source: "client_reported" },
    ]);
    expect(afterSecond?.edits).toHaveLength(2);
    expect(afterSecond?.edits.map((e) => e.field)).toEqual(["guideline", "elevation"]);
    expect(afterSecond?.payload).toEqual(payload);

    // Straight from Postgres: payload bytes unchanged, edits is a 2-entry array.
    const row = await prisma.analysisProposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(row.payload).toEqual(payload);
    expect(Array.isArray(row.edits)).toBe(true);
    expect(row.edits).toHaveLength(2);
  });

  it("editDraftProposal is rejected with a typed error and no write on a CONFIRMED, REJECTED, or SUPERSEDED proposal", async () => {
    const { ownerUserId } = await createOwnerAndClient();

    const confirmed = await makeProposalInState(ownerUserId, "CONFIRMED");
    const rejected = await makeProposalInState(ownerUserId, "REJECTED");
    const superseded = await makeProposalInState(ownerUserId, "SUPERSEDED");

    for (const target of [confirmed, rejected, superseded]) {
      const before = await prisma.analysisProposal.findUniqueOrThrow({ where: { id: target.id } });
      await expect(
        editDraftProposal(ownerUserId, target.id, [
          { field: "guideline", previousValue: "stationary", newValue: "traveling", source: "stylist_confirmed" },
        ]),
      ).rejects.toBeInstanceOf(ProposalStateError);
      const after = await prisma.analysisProposal.findUniqueOrThrow({ where: { id: target.id } });
      expect(after.status).toBe(before.status);
      expect(after.edits).toEqual(before.edits);
      expect(after.payload).toEqual(before.payload);
    }
  });

  it("editDraftProposal rejects an empty or malformed edits array before any database round-trip", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    const proposal = await draftProposal(ownerUserId, clientId, analysis.id);

    await expect(editDraftProposal(ownerUserId, proposal.id, [])).rejects.toBeInstanceOf(ProposalValidationError);
    await expect(
      editDraftProposal(ownerUserId, proposal.id, [
        { field: "guideline", previousValue: "stationary", newValue: "traveling", source: "not-a-real-source" },
      ] as unknown as ProposalEditEntry[]),
    ).rejects.toMatchObject({ code: "PROPOSAL_INVALID_EDIT" });

    const row = await prisma.analysisProposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(row.edits).toBeNull();
  });

  // -------------------------------------------------------------------------
  // rejectProposal
  // -------------------------------------------------------------------------

  it("rejectProposal moves a DRAFT to REJECTED and refuses every other starting status", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    const proposal = await draftProposal(ownerUserId, clientId, analysis.id);

    const rejectedRecord = await rejectProposal(ownerUserId, proposal.id);
    expect(rejectedRecord?.status).toBe("REJECTED");
    expect(rejectedRecord?.rejectedAt).not.toBeNull();

    // REJECTED -> anything is illegal, including REJECTED -> REJECTED.
    await expect(rejectProposal(ownerUserId, proposal.id)).rejects.toBeInstanceOf(ProposalStateError);

    const confirmed = await makeProposalInState(ownerUserId, "CONFIRMED");
    await expect(rejectProposal(ownerUserId, confirmed.id)).rejects.toBeInstanceOf(ProposalStateError);
    await expect(
      prisma.analysisProposal.findUniqueOrThrow({ where: { id: confirmed.id } }),
    ).resolves.toMatchObject({ status: "CONFIRMED" });

    const superseded = await makeProposalInState(ownerUserId, "SUPERSEDED");
    await expect(rejectProposal(ownerUserId, superseded.id)).rejects.toBeInstanceOf(ProposalStateError);

    await expect(rejectProposal(ownerUserId, randomUUID())).resolves.toBeNull();
  });

  // -------------------------------------------------------------------------
  // confirmProposal
  // -------------------------------------------------------------------------

  it("confirmProposal moves a DRAFT to CONFIRMED when the client has no confirmed proposal yet", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    const proposal = await draftProposal(ownerUserId, clientId, analysis.id);

    const confirmed = await confirmProposal(ownerUserId, proposal.id, ownerUserId);
    expect(confirmed?.status).toBe("CONFIRMED");
    expect(confirmed?.confirmedByUserId).toBe(ownerUserId);
    expect(confirmed?.confirmedAt).not.toBeNull();

    const current = await findCurrentConfirmedProposal(ownerUserId, clientId, "cutting");
    expect(current?.id).toBe(proposal.id);

    await expect(
      prisma.analysisProposal.count({
        where: { ownerUserId, clientId, vertical: "cutting", status: "CONFIRMED" },
      }),
    ).resolves.toBe(1);

    // CONFIRMED -> confirm again is illegal.
    await expect(confirmProposal(ownerUserId, proposal.id, ownerUserId)).rejects.toBeInstanceOf(ProposalStateError);
  });

  it("confirmProposal atomically supersedes the previously confirmed proposal for the same client and vertical", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);

    const first = await draftProposal(ownerUserId, clientId, analysis.id);
    await confirmProposal(ownerUserId, first.id, ownerUserId);

    const second = await draftProposal(ownerUserId, clientId, analysis.id);
    const secondConfirmed = await confirmProposal(ownerUserId, second.id, ownerUserId);
    expect(secondConfirmed?.status).toBe("CONFIRMED");

    // Both transitions are visible in the very next read.
    const firstAfter = await prisma.analysisProposal.findUniqueOrThrow({ where: { id: first.id } });
    const secondAfter = await prisma.analysisProposal.findUniqueOrThrow({ where: { id: second.id } });
    expect(firstAfter.status).toBe("SUPERSEDED");
    expect(firstAfter.supersededByProposalId).toBe(second.id);
    expect(secondAfter.status).toBe("CONFIRMED");
    expect(secondAfter.supersededByProposalId).toBeNull();

    const history = await listProposalsForOwner(ownerUserId, clientId, "cutting");
    expect(history.map((p) => p.id)).toEqual([second.id, first.id]); // newest first
    expect(history.map((p) => p.status)).toEqual(["CONFIRMED", "SUPERSEDED"]);

    const current = await findCurrentConfirmedProposal(ownerUserId, clientId, "cutting");
    expect(current?.id).toBe(second.id);
    await expect(
      prisma.analysisProposal.count({
        where: { ownerUserId, clientId, vertical: "cutting", status: "CONFIRMED" },
      }),
    ).resolves.toBe(1);
  });

  it("findCurrentConfirmedProposal never returns more than one row across a full lifecycle sequence", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);

    const p1 = await draftProposal(ownerUserId, clientId, analysis.id);
    const p2 = await draftProposal(ownerUserId, clientId, analysis.id);
    const p3 = await draftProposal(ownerUserId, clientId, analysis.id);

    const assertAtMostOneConfirmed = async (expectedId: string | null) => {
      const confirmedRows = await prisma.analysisProposal.findMany({
        where: { ownerUserId, clientId, vertical: "cutting", status: "CONFIRMED" },
      });
      expect(confirmedRows.length).toBeLessThanOrEqual(1);
      const current = await findCurrentConfirmedProposal(ownerUserId, clientId, "cutting");
      expect(current?.id ?? null).toBe(expectedId);
    };

    await assertAtMostOneConfirmed(null);
    await confirmProposal(ownerUserId, p1.id, ownerUserId);
    await assertAtMostOneConfirmed(p1.id);
    await rejectProposal(ownerUserId, p2.id);
    await assertAtMostOneConfirmed(p1.id);
    await confirmProposal(ownerUserId, p3.id, ownerUserId); // supersedes p1
    await assertAtMostOneConfirmed(p3.id);

    const finalRows = await prisma.analysisProposal.findMany({ where: { ownerUserId, clientId, vertical: "cutting" } });
    expect(finalRows.map((r) => r.status).sort()).toEqual(["CONFIRMED", "REJECTED", "SUPERSEDED"]);
  });

  it("the partial unique index is the real backstop -- a second CONFIRMED row for one triple cannot be written even outside the repository", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    const p1 = await draftProposal(ownerUserId, clientId, analysis.id);
    const p2 = await draftProposal(ownerUserId, clientId, analysis.id);
    await confirmProposal(ownerUserId, p1.id, ownerUserId);

    // Attempt the impossible state directly, bypassing the repository entirely.
    // The Stage 1 partial unique index must reject it at the database level.
    const rawWrite = prisma.analysisProposal.update({
      where: { id: p2.id },
      data: { status: "CONFIRMED", confirmedByUserId: ownerUserId, confirmedAt: new Date() },
    });
    await expect(rawWrite).rejects.toMatchObject({ code: "P2002" });

    // State stayed sane, so the ordinary read returns exactly the one row and
    // never has to fall back to its ProposalInvariantError guard.
    const current = await findCurrentConfirmedProposal(ownerUserId, clientId, "cutting");
    expect(current?.id).toBe(p1.id);
    await expect(
      prisma.analysisProposal.count({
        where: { ownerUserId, clientId, vertical: "cutting", status: "CONFIRMED" },
      }),
    ).resolves.toBe(1);
  });

  it("a real concurrent confirmation race leaves exactly one CONFIRMED row and the loser gets a typed conflict error", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);
    const a = await draftProposal(ownerUserId, clientId, analysis.id);
    const b = await draftProposal(ownerUserId, clientId, analysis.id);

    const settled = await Promise.allSettled([
      confirmProposal(ownerUserId, a.id, ownerUserId),
      confirmProposal(ownerUserId, b.id, ownerUserId),
    ]);

    const fulfilled = settled.filter(
      (r): r is PromiseFulfilledResult<ProposalRecord | null> => r.status === "fulfilled",
    );
    const rejectedResults = settled.filter((r): r is PromiseRejectedResult => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejectedResults).toHaveLength(1);
    expect(fulfilled[0].value?.status).toBe("CONFIRMED");
    expect(rejectedResults[0].reason).toBeInstanceOf(ProposalConcurrencyError);

    const confirmedRows = await prisma.analysisProposal.findMany({
      where: { ownerUserId, clientId, vertical: "cutting", status: "CONFIRMED" },
    });
    expect(confirmedRows).toHaveLength(1);

    // The loser wrote nothing at all -- it is still a clean DRAFT.
    const allRows = await prisma.analysisProposal.findMany({ where: { ownerUserId, clientId, vertical: "cutting" } });
    expect(allRows.map((r) => r.status).sort()).toEqual(["CONFIRMED", "DRAFT"]);
    expect(await findCurrentConfirmedProposal(ownerUserId, clientId, "cutting")).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Frozen provenance
  // -------------------------------------------------------------------------

  it("consideredMemory stores a frozen content snapshot, not a live reference to the ProfessionalMemory row", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);

    const originalContent = "Prefers a blunt, weighty perimeter -- no visible layering at the ends.";
    const memory = await prisma.professionalMemory.create({
      data: {
        id: randomUUID(),
        ownerUserId,
        clientId,
        scope: "client_specific",
        kind: "preference",
        status: "active",
        source: "consultation",
        content: originalContent,
        provenance: { channel: "chat" },
        confidence: 0.9,
        createdByUserId: ownerUserId,
        confirmedAt: new Date(),
      },
    });

    const proposal = await createProposalForOwner(
      ownerUserId,
      clientId,
      analysis.id,
      "cutting",
      cuttingPayload(),
      evidenceSnapshot(),
      "1.0.0-m8",
      {
        consideredMemory: [
          {
            memoryId: memory.id,
            content: memory.content,
            kind: memory.kind,
            scope: memory.scope,
            confidence: memory.confidence,
            snapshotAt: new Date().toISOString(),
          },
        ],
      },
    );
    expect(proposal.consideredMemory).toHaveLength(1);
    expect(proposal.consideredMemory[0].content).toBe(originalContent);

    // Mutate AND revoke the source memory.
    await prisma.professionalMemory.update({
      where: { id: memory.id },
      data: {
        content: "REWRITTEN: now prefers heavy internal layering.",
        status: "revoked",
        revokedAt: new Date(),
      },
    });

    const refetched = await findProposalForOwner(ownerUserId, proposal.id);
    expect(refetched?.consideredMemory[0].content).toBe(originalContent);
    expect(refetched?.consideredMemory[0].content).not.toBe("REWRITTEN: now prefers heavy internal layering.");

    // Prove it is genuinely a frozen copy, diverging from the live row.
    const liveMemory = await prisma.professionalMemory.findUniqueOrThrow({ where: { id: memory.id } });
    expect(liveMemory.content).not.toBe(refetched?.consideredMemory[0].content);
    expect(liveMemory.status).toBe("revoked");
  });

  it("promotedConsultationSources preserves more than one promoted insight in a single proposal", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analysis = await createAnalysis(ownerUserId, clientId);

    const messageOne = await prisma.consultationMessage.create({
      data: {
        id: randomUUID(),
        ownerUserId,
        clientId,
        role: "stylist",
        content: "Client explicitly asked to keep the length below the collarbone.",
      },
    });
    const messageTwo = await prisma.consultationMessage.create({
      data: {
        id: randomUUID(),
        ownerUserId,
        clientId,
        role: "assistant",
        content: "Noted: balayage six weeks ago; the mid-lengths read as porous.",
      },
    });

    const promotedAt = new Date().toISOString();
    const proposal = await createProposalForOwner(
      ownerUserId,
      clientId,
      analysis.id,
      "cutting",
      cuttingPayload(),
      evidenceSnapshot(),
      "1.0.0-m8",
      {
        primaryConsultationMessageId: messageOne.id,
        promotedConsultationSources: [
          { consultationMessageId: messageOne.id, snapshotContent: "Keep length below the collarbone.", promotedAt },
          { consultationMessageId: messageTwo.id, snapshotContent: "Mid-lengths porous from recent balayage.", promotedAt },
        ],
      },
    );

    expect(proposal.primaryConsultationMessageId).toBe(messageOne.id);
    expect(proposal.promotedConsultationSources).toHaveLength(2);
    expect(proposal.promotedConsultationSources.map((s) => s.consultationMessageId)).toEqual([
      messageOne.id,
      messageTwo.id,
    ]);

    const refetched = await findProposalForOwner(ownerUserId, proposal.id);
    expect(refetched?.promotedConsultationSources).toHaveLength(2);
    expect(refetched?.promotedConsultationSources.map((s) => s.snapshotContent)).toEqual([
      "Keep length below the collarbone.",
      "Mid-lengths porous from recent balayage.",
    ]);
  });

  // -------------------------------------------------------------------------
  // Fail-closed
  // -------------------------------------------------------------------------

  it("fails closed with a ProposalPersistenceError when the database is not configured", async () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      await expect(findProposalForOwner(randomUUID(), randomUUID())).rejects.toBeInstanceOf(ProposalPersistenceError);
    } finally {
      if (saved !== undefined) process.env.DATABASE_URL = saved;
    }
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
    data: {
      id: ownerUserId,
      email: `${ownerUserId}@proposal-repository.test`,
      passwordHash: "test",
      role: "professional",
      locale: "en",
    },
  });
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "Proposal Repository Client" } });
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

async function draftProposal(ownerUserId: string, clientId: string, analysisId: string): Promise<ProposalRecord> {
  return createProposalForOwner(
    ownerUserId,
    clientId,
    analysisId,
    "cutting",
    cuttingPayload(),
    evidenceSnapshot(),
    "1.0.0-m8",
  );
}

// Builds a proposal in a requested terminal state, each on its own client so
// the one-CONFIRMED-per-(owner, client, vertical) invariant never collides.
async function makeProposalInState(
  ownerUserId: string,
  state: "CONFIRMED" | "REJECTED" | "SUPERSEDED",
): Promise<ProposalRecord> {
  const clientId = randomUUID();
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: `Client ${state}` } });
  const analysis = await createAnalysis(ownerUserId, clientId);

  if (state === "REJECTED") {
    const draft = await draftProposal(ownerUserId, clientId, analysis.id);
    const rejected = await rejectProposal(ownerUserId, draft.id);
    return expectRecord(rejected);
  }

  const draft = await draftProposal(ownerUserId, clientId, analysis.id);
  const confirmed = await confirmProposal(ownerUserId, draft.id, ownerUserId);
  if (state === "CONFIRMED") return expectRecord(confirmed);

  // SUPERSEDED: confirm a newer proposal on the same triple.
  const newer = await draftProposal(ownerUserId, clientId, analysis.id);
  await confirmProposal(ownerUserId, newer.id, ownerUserId);
  const superseded = await findProposalForOwner(ownerUserId, draft.id);
  return expectRecord(superseded);
}

function expectRecord(record: ProposalRecord | null): ProposalRecord {
  if (!record) throw new Error("expected a ProposalRecord, received null");
  return record;
}

function cuttingPayload(overrides: Partial<TechnicalCutPlan> = {}): TechnicalCutPlan {
  return {
    structuralTechnique: "graduation",
    cuttingTechnique: "slice_cutting",
    texturizingTechnique: "point_cutting",
    sectioning: "diagonal_back",
    elevation: "45_deg_graduation",
    distribution: "overdirected_back",
    guideline: "stationary",
    cuttingSteps: [
      {
        stepNumber: 1,
        zone: "nape",
        action: "Establish the guideline",
        elevationAngle: "45_deg_graduation",
        toolRequired: "shears",
      },
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
    ...overrides,
  };
}

function evidenceSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    goal: "refresh",
    density: "medium",
    porosity: "low",
    hairCondition: "virgin_healthy",
    contraindications: [],
    ...overrides,
  };
}
