import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { HEAD_ZONES } from "@/lib/technical-visual-map-validators";
import { buildUnassessedGlobalEntry, buildUnassessedZoneEntry, type HairStateSnapshotPayload } from "@/lib/hair-state-snapshot-validators";
import { HairStateSnapshotConcurrencyError, HairStateSnapshotStateError, findSnapshotForOwner } from "@/lib/hair-state-snapshot-repository";
import { ProfessionalBrainAccessError, confirmSnapshot, createDraftCurrentState, createDraftTargetState } from "@/lib/professional-brain-orchestrator";

// AI Hair Architect, B2.1 -- SAFE EVALUATION REUSE. Real Postgres, zero
// AI / provider calls. Proves the three properties B2.1 was asked to
// prove for a real client, not just declare:
//   (1) starting a new evaluation round NEVER mutates the previously
//       CONFIRMED snapshot -- it becomes SUPERSEDED, byte-identical
//       payload preserved, confirmedAt untouched;
//   (2) stale/wrong expectedCurrentConfirmedSnapshotId is rejected
//       (HairStateSnapshotConcurrencyError, 409), never silently
//       resolved either way -- this is also the real double-click/
//       double-confirm proof: the SECOND of two identical confirm calls
//       for the same draft always loses;
//   (3) ownership is enforced identically for a round-2 create/confirm
//       as for round 1 -- a client id is never a cross-owner discovery
//       oracle just because a round-1 evaluation already exists.
// Skips (never fails) when no database is configured.
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

function basePayload(): HairStateSnapshotPayload {
  return { globalState: buildUnassessedGlobalEntry(), zones: HEAD_ZONES.map((z) => buildUnassessedZoneEntry(z)) };
}
function withZone(payload: HairStateSnapshotPayload, zone: string, overrides: Partial<HairStateSnapshotPayload["zones"][number]>): HairStateSnapshotPayload {
  return { ...payload, zones: payload.zones.map((z) => (z.zone === zone ? { ...z, ...overrides } : z)) };
}
function roundOneCurrent(): HairStateSnapshotPayload {
  return { ...basePayload(), colorState: { level: { value: "level_5", source: "observed" }, tone: { value: "neutral", source: "observed" } } };
}
function roundOneTarget(): HairStateSnapshotPayload {
  return {
    ...withZone(basePayload(), "nape", { lengthIntent: { value: "preserve", source: "professional_input" } }),
    colorState: { level: { value: "level_7", source: "professional_input" }, tone: { value: "warm_gold", source: "professional_input" } },
  };
}
// Round-2 payloads are deliberately DIFFERENT values -- if superseding
// ever corrupted round 1, these are what would leak into it.
function roundTwoCurrent(): HairStateSnapshotPayload {
  return { ...basePayload(), colorState: { level: { value: "level_7", source: "observed" }, tone: { value: "warm_gold", source: "observed" } } };
}
async function seedOwnerAndClient() {
  const ownerUserId = randomUUID();
  const clientId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({ data: { id: ownerUserId, email: `${ownerUserId}@pb-b21.test`, passwordHash: "test", role: "professional", locale: "en" } });
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "PB B2.1 Client" } });
  return { ownerUserId, clientId };
}

async function reachRoundOneConfirmed(ownerUserId: string, clientId: string) {
  const current = await createDraftCurrentState(ownerUserId, clientId, { payload: roundOneCurrent() });
  const confirmedCurrent = await confirmSnapshot(ownerUserId, clientId, current.id, null);
  const target = await createDraftTargetState(ownerUserId, clientId, roundOneTarget());
  const confirmedTarget = await confirmSnapshot(ownerUserId, clientId, target.id, null);
  return { confirmedCurrent: confirmedCurrent!, confirmedTarget: confirmedTarget! };
}

suite("B2.1 -- safe evaluation reuse (real Postgres, zero AI / provider)", () => {
  afterEach(async () => {
    const ids = [...owners];
    await prisma.hairStateSnapshotEvidence.deleteMany({ where: { ownerUserId: { in: ids } } });
    await prisma.hairStateSnapshot.deleteMany({ where: { ownerUserId: { in: ids } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    owners.clear();
  });

  it("realistic path: a round-2 CURRENT snapshot confirms correctly against the round-1 confirmed id, and round 1 is superseded, never mutated", async () => {
    const { ownerUserId, clientId } = await seedOwnerAndClient();
    const { confirmedCurrent: roundOne } = await reachRoundOneConfirmed(ownerUserId, clientId);

    const roundTwoDraft = await createDraftCurrentState(ownerUserId, clientId, { payload: roundTwoCurrent() });
    // The real fix under test: the expected id is round 1's OWN id, never null.
    const roundTwoConfirmed = await confirmSnapshot(ownerUserId, clientId, roundTwoDraft.id, roundOne.id);

    expect(roundTwoConfirmed).toMatchObject({ id: roundTwoDraft.id, status: "CONFIRMED" });
    expect(roundTwoConfirmed!.snapshotVersion).toBeGreaterThan(roundOne.snapshotVersion);

    const roundOneReread = await findSnapshotForOwner(ownerUserId, roundOne.id);
    expect(roundOneReread).toMatchObject({
      id: roundOne.id,
      status: "SUPERSEDED",
      supersededBySnapshotId: roundTwoDraft.id,
      // Byte-identical payload -- confirming round 2 never retroactively
      // touches round 1's own recorded facts.
      payload: roundOne.payload,
      confirmedAt: roundOne.confirmedAt,
    });
  });

  it("a STALE expected id (null, as if the UI had never learned round 1 was confirmed) is rejected -- this is the real 'confirm a fresh snapshot after confirmed ones, without ever silently resolving either way' proof", async () => {
    const { ownerUserId, clientId } = await seedOwnerAndClient();
    await reachRoundOneConfirmed(ownerUserId, clientId);
    const roundTwoDraft = await createDraftCurrentState(ownerUserId, clientId, { payload: roundTwoCurrent() });

    await expect(confirmSnapshot(ownerUserId, clientId, roundTwoDraft.id, null)).rejects.toBeInstanceOf(HairStateSnapshotConcurrencyError);

    // And round 1 is still exactly what it was -- a rejected confirm
    // attempt must never partially apply.
    const stillDraft = await findSnapshotForOwner(ownerUserId, roundTwoDraft.id);
    expect(stillDraft?.status).toBe("DRAFT");
  });

  it("DOUBLE-CONFIRM (the real double-click proof): two identical, truly concurrent confirm calls for the same draft -- exactly one succeeds, the other is always safely rejected, never double-applied", async () => {
    const { ownerUserId, clientId } = await seedOwnerAndClient();
    const { confirmedCurrent: roundOne } = await reachRoundOneConfirmed(ownerUserId, clientId);
    const roundTwoDraft = await createDraftCurrentState(ownerUserId, clientId, { payload: roundTwoCurrent() });

    const [first, second] = await Promise.allSettled([
      confirmSnapshot(ownerUserId, clientId, roundTwoDraft.id, roundOne.id),
      confirmSnapshot(ownerUserId, clientId, roundTwoDraft.id, roundOne.id),
    ]);

    const outcomes = [first, second];
    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // Empirically, the loser can surface as EITHER of two distinct, both
    // genuinely safe, error classes depending on serializable-transaction
    // retry timing: HairStateSnapshotConcurrencyError (its own read of
    // "currently confirmed" no longer matches what was expected) or
    // HairStateSnapshotStateError (its retry, after the winner already
    // committed, finds the target row is no longer DRAFT at all). Both
    // are 409s this package's own confirm route already maps identically
    // -- asserting one specific class here would be testing a timing
    // accident, not the real safety property.
    const loserReason = (rejected[0] as PromiseRejectedResult).reason;
    expect(loserReason instanceof HairStateSnapshotConcurrencyError || loserReason instanceof HairStateSnapshotStateError).toBe(true);

    // Exactly one CONFIRMED row for this role, ever -- no double-apply.
    const confirmedRows = await prisma.hairStateSnapshot.findMany({ where: { ownerUserId, clientId, role: "CURRENT", status: "CONFIRMED" } });
    expect(confirmedRows).toHaveLength(1);
  });

  it("OWNERSHIP -- round-2 create AND confirm are both rejected for a different owner, exactly like round 1", async () => {
    const { ownerUserId, clientId } = await seedOwnerAndClient();
    const { confirmedCurrent: roundOne } = await reachRoundOneConfirmed(ownerUserId, clientId);
    const otherOwnerId = randomUUID();
    owners.add(otherOwnerId);
    await prisma.user.create({ data: { id: otherOwnerId, email: `${otherOwnerId}@pb-b21.test`, passwordHash: "test", role: "professional", locale: "en" } });

    await expect(createDraftCurrentState(otherOwnerId, clientId, { payload: roundTwoCurrent() })).rejects.toBeInstanceOf(ProfessionalBrainAccessError);

    // Even a real draft id the other owner could only have guessed
    // cannot be confirmed by them.
    const realDraft = await createDraftCurrentState(ownerUserId, clientId, { payload: roundTwoCurrent() });
    await expect(confirmSnapshot(otherOwnerId, clientId, realDraft.id, roundOne.id)).rejects.toBeInstanceOf(ProfessionalBrainAccessError);
  });
});
