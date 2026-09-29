import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { HEAD_ZONES } from "@/lib/technical-visual-map-validators";
import { buildUnassessedGlobalEntry, buildUnassessedZoneEntry, type HairStateSnapshotPayload } from "@/lib/hair-state-snapshot-validators";
import {
  ProfessionalBrainStylingNotImplementedError,
  createDraftCurrentState,
  createDraftTargetState,
  confirmSnapshot,
  resolveEvaluationDomainIntent,
  selectCandidateSkillsForDomains,
  selectMultiDomainCandidateSkills,
} from "@/lib/professional-brain-orchestrator";
import { PROFESSIONAL_BRAIN_STYLING_GAP } from "@/lib/professional-brain-styling-gap";

// AI Hair Architect, "CORECȚIE B2.2 ÎNAINTE DE RELEASE", requirement 1 --
// REAL, backend-level domain scoping proof (not just UI hiding). Real
// Postgres, zero AI / provider calls. Skips (never fails) when no
// database is configured.
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

function basePayload(): HairStateSnapshotPayload {
  return { globalState: buildUnassessedGlobalEntry(), zones: HEAD_ZONES.map((z) => buildUnassessedZoneEntry(z)) };
}
function withZone(payload: HairStateSnapshotPayload, zone: string, overrides: Partial<HairStateSnapshotPayload["zones"][number]>): HairStateSnapshotPayload {
  return { ...payload, zones: payload.zones.map((z) => (z.zone === zone ? { ...z, ...overrides } : z)) };
}

async function seedOwnerAndClient() {
  const ownerUserId = randomUUID();
  const clientId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({ data: { id: ownerUserId, email: `${ownerUserId}@pb-domainscope.test`, passwordHash: "test", role: "professional", locale: "en" } });
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "PB Domain-Scoping Client" } });
  return { ownerUserId, clientId };
}

// A combined CUT+COLOR change: nape lengthIntent=preserve (real CUT
// match), color level 5->7 (real COLOR match) -- exercises both domains
// at once so CUT-only/COLOR-only scoping is a real, visible difference.
function combinedCurrentTarget() {
  const current: HairStateSnapshotPayload = { ...basePayload(), colorState: { level: { value: "level_5", source: "observed" }, tone: { value: "warm_gold", source: "observed" } } };
  const target: HairStateSnapshotPayload = {
    ...withZone(basePayload(), "nape", { lengthIntent: { value: "preserve", source: "professional_input" } }),
    colorState: { level: { value: "level_7", source: "professional_input" }, tone: { value: "warm_gold", source: "professional_input" } },
  };
  return { current, target };
}

async function reachConfirmedStates(ownerUserId: string, clientId: string, current: HairStateSnapshotPayload, target: HairStateSnapshotPayload) {
  const currentDraft = await createDraftCurrentState(ownerUserId, clientId, { payload: current });
  const confirmedCurrent = await confirmSnapshot(ownerUserId, clientId, currentDraft.id, null);
  const targetDraft = await createDraftTargetState(ownerUserId, clientId, target);
  await confirmSnapshot(ownerUserId, clientId, targetDraft.id, null);
  if (!confirmedCurrent) throw new Error("expected a confirmed CURRENT snapshot");
  return confirmedCurrent;
}

suite("professional-brain domain scoping -- real backend-level CUT/COLOR/STYLING scoping (real Postgres, zero AI / provider)", () => {
  afterEach(async () => {
    const ids = [...owners];
    await prisma.hairStateSnapshot.deleteMany({ where: { ownerUserId: { in: ids } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    owners.clear();
  });

  it("CUT-only domain intent: real backend scoping excludes color entirely, even though a real color change exists in the payload", async () => {
    const { ownerUserId, clientId } = await seedOwnerAndClient();
    const { current, target } = combinedCurrentTarget();
    await reachConfirmedStates(ownerUserId, clientId, { ...current, evaluationDomainIntent: { domains: ["cut"] } }, target);

    const selection = await selectCandidateSkillsForDomains(ownerUserId, clientId);
    expect(selection.candidateMatches.every((m) => m.matchedCapability !== "EVALUATE_COLOR_SERVICE")).toBe(true);
    expect(selection.candidateMatches.some((m) => m.skillKey === "skill-cutting-establish-central-nape-guide")).toBe(true);
    expect(selection.delta.entries.some((e) => e.field === "colorLevel" || e.field === "colorTone")).toBe(false);
    expect(selection.unresolvedDeltas.some((e) => e.field === "colorLevel" || e.field === "colorTone")).toBe(false);
  });

  it("COLOR-only domain intent: real backend scoping excludes cut entirely, even though a real cut change exists in the payload", async () => {
    const { ownerUserId, clientId } = await seedOwnerAndClient();
    const { current, target } = combinedCurrentTarget();
    await reachConfirmedStates(ownerUserId, clientId, { ...current, evaluationDomainIntent: { domains: ["color"] } }, target);

    const selection = await selectCandidateSkillsForDomains(ownerUserId, clientId);
    expect(selection.candidateMatches.every((m) => m.matchedCapability === "EVALUATE_COLOR_SERVICE")).toBe(true);
    expect(selection.candidateMatches.length).toBeGreaterThan(0);
    expect(selection.delta.entries.some((e) => e.scope === "nape")).toBe(false);
    expect(selection.unresolvedDeltas.some((e) => e.scope === "nape")).toBe(false);
  });

  it("CUT+COLOR domain intent is byte-identical to the existing selectMultiDomainCandidateSkills composition", async () => {
    const { ownerUserId, clientId } = await seedOwnerAndClient();
    const { current, target } = combinedCurrentTarget();
    await reachConfirmedStates(ownerUserId, clientId, { ...current, evaluationDomainIntent: { domains: ["cut", "color"] } }, target);

    const domainScoped = await selectCandidateSkillsForDomains(ownerUserId, clientId);
    const legacyComposed = await selectMultiDomainCandidateSkills(ownerUserId, clientId);
    // computedAt is a real wall-clock timestamp from two separate calls a
    // few milliseconds apart -- never expected to match; every other field
    // must be byte-identical.
    expect({ ...domainScoped, delta: { ...domainScoped.delta, computedAt: "" } }).toEqual({ ...legacyComposed, delta: { ...legacyComposed.delta, computedAt: "" } });
  });

  it("a legacy snapshot with no evaluationDomainIntent defaults to CUT+COLOR -- an already-confirmed pre-existing evaluation is never narrowed retroactively", async () => {
    const { ownerUserId, clientId } = await seedOwnerAndClient();
    const { current, target } = combinedCurrentTarget();
    const currentRow = await reachConfirmedStates(ownerUserId, clientId, current, target);

    expect(resolveEvaluationDomainIntent(currentRow)).toEqual({ domains: ["cut", "color"] });
    const domainScoped = await selectCandidateSkillsForDomains(ownerUserId, clientId);
    const legacyComposed = await selectMultiDomainCandidateSkills(ownerUserId, clientId);
    expect({ ...domainScoped, delta: { ...domainScoped.delta, computedAt: "" } }).toEqual({ ...legacyComposed, delta: { ...legacyComposed.delta, computedAt: "" } });
  });

  it("a domain intent that includes STYLING throws ProfessionalBrainStylingNotImplementedError, carrying the real, itemized gap report -- never a fabricated or silently-partial result", async () => {
    const { ownerUserId, clientId } = await seedOwnerAndClient();
    const { current, target } = combinedCurrentTarget();
    await reachConfirmedStates(ownerUserId, clientId, { ...current, evaluationDomainIntent: { domains: ["cut", "styling"] } }, target);

    await expect(selectCandidateSkillsForDomains(ownerUserId, clientId)).rejects.toBeInstanceOf(ProfessionalBrainStylingNotImplementedError);
    try {
      await selectCandidateSkillsForDomains(ownerUserId, clientId);
      throw new Error("expected to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ProfessionalBrainStylingNotImplementedError);
      expect((error as InstanceType<typeof ProfessionalBrainStylingNotImplementedError>).gap).toEqual(PROFESSIONAL_BRAIN_STYLING_GAP);
      expect((error as InstanceType<typeof ProfessionalBrainStylingNotImplementedError>).gap.missingContracts.length).toBeGreaterThan(0);
    }
  });

  it("domain intent recorded on CURRENT is frozen once confirmed -- reading it back after confirmation returns exactly what was chosen at creation", async () => {
    const { ownerUserId, clientId } = await seedOwnerAndClient();
    const { current, target } = combinedCurrentTarget();
    const currentRow = await reachConfirmedStates(ownerUserId, clientId, { ...current, evaluationDomainIntent: { domains: ["color"] } }, target);
    expect(currentRow.status).toBe("CONFIRMED");
    expect(resolveEvaluationDomainIntent(currentRow)).toEqual({ domains: ["color"] });
  });
});
