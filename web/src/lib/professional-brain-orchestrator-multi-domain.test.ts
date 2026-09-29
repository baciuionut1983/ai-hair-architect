import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { HEAD_ZONES } from "@/lib/technical-visual-map-validators";
import { buildUnassessedGlobalEntry, buildUnassessedZoneEntry, type HairStateSnapshotPayload } from "@/lib/hair-state-snapshot-validators";
import {
  ProfessionalBrainAccessError,
  computeMultiDomainDelta,
  confirmSnapshot,
  createDraftCurrentState,
  createDraftTargetState,
  prepareMultiDomainReasoningRequestPackage,
  selectMultiDomainCandidateSkills,
} from "@/lib/professional-brain-orchestrator";

// AI Hair Architect, B2 -- PROFESSIONAL BRAIN CUT+COLOR FLOW, realistic-path
// integration tests for B1's own multi-domain orchestrator functions
// (computeMultiDomainDelta/selectMultiDomainCandidateSkills/
// prepareMultiDomainReasoningRequestPackage), which B1 itself never
// exercised against a real client -- B1's own tests covered only the pure
// Stage 4/6 modules directly. Real Postgres, ZERO AI / provider calls.
// Skips (never fails) when no database is configured.
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

function basePayload(): HairStateSnapshotPayload {
  return { globalState: buildUnassessedGlobalEntry(), zones: HEAD_ZONES.map((z) => buildUnassessedZoneEntry(z)) };
}
function withZone(payload: HairStateSnapshotPayload, zone: string, overrides: Partial<HairStateSnapshotPayload["zones"][number]>): HairStateSnapshotPayload {
  return { ...payload, zones: payload.zones.map((z) => (z.zone === zone ? { ...z, ...overrides } : z)) };
}
// Real CURRENT: nape has an observed length; base color is a known level/tone.
function currentPayload(): HairStateSnapshotPayload {
  return {
    ...withZone(basePayload(), "nape", { relativeLength: { value: "long", source: "observed" } }),
    colorState: { level: { value: "level_5", source: "observed" }, tone: { value: "warm_gold", source: "observed" } },
  };
}
// Real TARGET: nape length is to be preserved (real match for the canonical
// Establish Central Nape Guide skill's ESTABLISH_GUIDE/PRESERVE_LENGTH
// capability, since CURRENT never carries a real lengthIntent -> ADDED),
// target color lifts to a lighter level with a cooler tone.
function targetPayload(): HairStateSnapshotPayload {
  return {
    ...withZone(basePayload(), "nape", { lengthIntent: { value: "preserve", source: "professional_input" } }),
    colorState: { level: { value: "level_8", source: "professional_input" }, tone: { value: "cool_ash", source: "professional_input" } },
  };
}

async function seedOwnerAndClient() {
  const ownerUserId = randomUUID();
  const clientId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({ data: { id: ownerUserId, email: `${ownerUserId}@pb-md.test`, passwordHash: "test", role: "professional", locale: "en" } });
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "PB Multi-Domain Client" } });
  return { ownerUserId, clientId };
}

async function reachConfirmedCutColorStates(ownerUserId: string, clientId: string) {
  const current = await createDraftCurrentState(ownerUserId, clientId, { payload: currentPayload() });
  await confirmSnapshot(ownerUserId, clientId, current.id, null);
  const target = await createDraftTargetState(ownerUserId, clientId, targetPayload());
  await confirmSnapshot(ownerUserId, clientId, target.id, null);
  return { currentId: current.id, targetId: target.id };
}

suite("professional-brain-orchestrator multi-domain (real Postgres, zero AI / provider)", () => {
  afterEach(async () => {
    const ids = [...owners];
    await prisma.hairStateSnapshotEvidence.deleteMany({ where: { ownerUserId: { in: ids } } });
    await prisma.hairStateSnapshot.deleteMany({ where: { ownerUserId: { in: ids } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    owners.clear();
  });

  it("realistic path: computeMultiDomainDelta reports both a real CUT entry and a real COLOR entry for one confirmed CURRENT+TARGET pair", async () => {
    const { ownerUserId, clientId } = await seedOwnerAndClient();
    await reachConfirmedCutColorStates(ownerUserId, clientId);

    const delta = await computeMultiDomainDelta(ownerUserId, clientId);
    const napeLengthIntent = delta.entries.find((e) => e.scope === "nape" && e.field === "lengthIntent");
    const colorLevel = delta.entries.find((e) => e.scope === "global" && e.field === "colorLevel");
    const colorTone = delta.entries.find((e) => e.scope === "global" && e.field === "colorTone");

    expect(napeLengthIntent?.transformation).toBe("PRESERVED");
    expect(colorLevel).toMatchObject({ transformation: "INCREASED", current: { value: "level_5" }, target: { value: "level_8" } });
    expect(colorTone?.transformation).toBe("CHANGED");
  });

  it("realistic path: selectMultiDomainCandidateSkills returns BOTH the real cut skill and the real color evaluation-gate skill as candidates, in one merged result", async () => {
    const { ownerUserId, clientId } = await seedOwnerAndClient();
    await reachConfirmedCutColorStates(ownerUserId, clientId);

    const selection = await selectMultiDomainCandidateSkills(ownerUserId, clientId);

    const cutMatch = selection.candidateMatches.find((m) => m.skillKey === "skill-cutting-establish-central-nape-guide");
    const colorMatch = selection.candidateMatches.find((m) => m.skillKey === "skill-color-global-single-process-evaluation-gate");
    expect(cutMatch).toBeDefined();
    expect(cutMatch?.matchedCapability).toBe("ESTABLISH_GUIDE");
    expect(colorMatch).toBeDefined();
    expect(colorMatch?.matchedCapability).toBe("EVALUATE_COLOR_SERVICE");
    // Merged delta on the result carries both domains' entries.
    expect(selection.delta.entries.some((e) => e.field === "colorLevel")).toBe(true);
    expect(selection.delta.entries.some((e) => e.field === "lengthIntent" && e.scope === "nape")).toBe(true);
  });

  it("prepareMultiDomainReasoningRequestPackage builds a sealed package listing both domains' candidates and makes ZERO AI/provider calls", async () => {
    const { ownerUserId, clientId } = await seedOwnerAndClient();
    await reachConfirmedCutColorStates(ownerUserId, clientId);

    const pkg = await prepareMultiDomainReasoningRequestPackage(ownerUserId, clientId);

    expect(pkg.requiresPaidReasoningCall).toBe(true);
    expect(pkg.candidateSkillCount).toBeGreaterThanOrEqual(2);
    const skillKeys = pkg.context.candidateSkills.map((s) => s.skillKey);
    expect(skillKeys).toContain("skill-cutting-establish-central-nape-guide");
    expect(skillKeys).toContain("skill-color-global-single-process-evaluation-gate");
  });

  it("cross-owner access is rejected for all three multi-domain functions -- a client id can never be used as a cross-owner discovery oracle", async () => {
    const { ownerUserId, clientId } = await seedOwnerAndClient();
    await reachConfirmedCutColorStates(ownerUserId, clientId);
    const otherOwnerId = randomUUID();
    owners.add(otherOwnerId);
    await prisma.user.create({ data: { id: otherOwnerId, email: `${otherOwnerId}@pb-md.test`, passwordHash: "test", role: "professional", locale: "en" } });

    await expect(computeMultiDomainDelta(otherOwnerId, clientId)).rejects.toBeInstanceOf(ProfessionalBrainAccessError);
    await expect(selectMultiDomainCandidateSkills(otherOwnerId, clientId)).rejects.toBeInstanceOf(ProfessionalBrainAccessError);
    await expect(prepareMultiDomainReasoningRequestPackage(otherOwnerId, clientId)).rejects.toBeInstanceOf(ProfessionalBrainAccessError);
  });

  it("STATIC PROOF -- the multi-domain functions never import an AI/provider transport", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./professional-brain-orchestrator.ts", import.meta.url), "utf8");
    expect(src.includes("generateContent(")).toBe(false);
    expect(src.includes(".submit(")).toBe(false);
  });
});
