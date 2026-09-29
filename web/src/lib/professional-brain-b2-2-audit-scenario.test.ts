import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { HEAD_ZONES } from "@/lib/technical-visual-map-validators";
import { buildUnassessedGlobalEntry, buildUnassessedZoneEntry, type HairStateSnapshotPayload } from "@/lib/hair-state-snapshot-validators";
import { selectMultiDomainCandidateSkills, createDraftCurrentState, createDraftTargetState, confirmSnapshot } from "@/lib/professional-brain-orchestrator";

// AI Hair Architect, B2.2 -- AUDIT REPRODUCTION of a real production
// report: professional requested a straight-line haircut + color base 7;
// confirmed CURRENT level 5/warm_gold/medium length; TARGET level
// 7/warm_gold, nape lengthIntent=shorten/weightIntent=preserve. Originally
// reported result: two matches for the same color skill, ZERO cut skills,
// 4 Unresolved. Real Postgres, zero AI / provider calls. Skips (never
// fails) when no database is configured.
//
// ROOT CAUSE, verified directly against the real registry (see the B2.2
// audit report): "shorten" requires REDUCE_LENGTH, which only
// skill-cutting-graduated declares -- but that capability originally had
// no `zones` of its own and fell back to the SKILL's own applicableZones
// ("perimeter_contour_reference"/"graduated_execution_zone"/
// "cross_check_area"), a DIFFERENT vocabulary than HeadZone, so it could
// NEVER match a real zone-scoped delta like "nape". "preserve" (weight)
// requires PRESERVE_WEIGHT, which ZERO registered skills declare at all.
// Both were honest, structural registry gaps -- never selector bugs.
//
// CORRECTION APPLIED (Stage 8.5S1B.R2, cutting-skill-graduated.ts): the
// "CORECȚIE B2.2 ÎNAINTE DE RELEASE" requirement-4 investigation found the
// REDUCE_LENGTH / MODIFY_PERIMETER_RELATIONSHIP zone gap to be a genuine
// authoring omission (the file's own header already claimed both are
// "truthfully universal across every elevation choice", matching
// PRESERVE_LENGTH's own already-declared nape/occipital/crown/top zones)
// and fixed it with real `zones`. "shorten" at nape is therefore now a
// REAL cut candidate below -- this file's expectations were updated to
// match the corrected, honest behavior. PRESERVE_WEIGHT remains an
// intentional, still-open gap (zero skills declare it) -- weightIntent=
// preserve stays unresolved, deliberately NOT forced to a match.
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
  await prisma.user.create({ data: { id: ownerUserId, email: `${ownerUserId}@pb-b22.test`, passwordHash: "test", role: "professional", locale: "en" } });
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "PB B2.2 Audit Client" } });
  return { ownerUserId, clientId };
}

suite("B2.2 -- audit reproduction of the real straight-line + color-7 report (real Postgres, zero AI / provider)", () => {
  afterEach(async () => {
    const ids = [...owners];
    await prisma.hairStateSnapshot.deleteMany({ where: { ownerUserId: { in: ids } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    owners.clear();
  });

  it("post-fix: nape lengthIntent=shorten is now a real CUT match (skill-cutting-graduated / REDUCE_LENGTH), 2 COLOR matches for the SAME skill, and 3 Unresolved (weightIntent=preserve + the two global facts) when global relativeLength+density are also set unchanged on both sides", async () => {
    const { ownerUserId, clientId } = await seedOwnerAndClient();

    const current: HairStateSnapshotPayload = {
      ...basePayload(),
      globalState: { ...buildUnassessedGlobalEntry(), relativeLength: { value: "medium", source: "professional_input" }, density: { value: "high", source: "professional_input" } },
      colorState: { level: { value: "level_5", source: "observed" }, tone: { value: "warm_gold", source: "observed" } },
    };
    const target: HairStateSnapshotPayload = {
      ...withZone(basePayload(), "nape", {
        lengthIntent: { value: "shorten", source: "professional_input" },
        weightIntent: { value: "preserve", source: "professional_input" },
      }),
      globalState: { ...buildUnassessedGlobalEntry(), relativeLength: { value: "medium", source: "professional_input" }, density: { value: "high", source: "professional_input" } },
      colorState: { level: { value: "level_7", source: "professional_input" }, tone: { value: "warm_gold", source: "professional_input" } },
    };

    const currentRow = await createDraftCurrentState(ownerUserId, clientId, { payload: current });
    await confirmSnapshot(ownerUserId, clientId, currentRow.id, null);
    const targetRow = await createDraftTargetState(ownerUserId, clientId, target);
    await confirmSnapshot(ownerUserId, clientId, targetRow.id, null);

    const selection = await selectMultiDomainCandidateSkills(ownerUserId, clientId);

    const cutMatches = selection.candidateMatches.filter((m) => m.matchedCapability !== "EVALUATE_COLOR_SERVICE");
    const colorMatches = selection.candidateMatches.filter((m) => m.matchedCapability === "EVALUATE_COLOR_SERVICE");

    // Post-fix: exactly one real CUT match, tracing to the corrected
    // REDUCE_LENGTH zone declaration on skill-cutting-graduated.
    expect(cutMatches).toHaveLength(1);
    expect(cutMatches[0]!.skillKey).toBe("skill-cutting-graduated");
    expect(cutMatches[0]!.matchedCapability).toBe("REDUCE_LENGTH");
    expect(cutMatches[0]!.deltaEntry.field).toBe("lengthIntent");
    expect(cutMatches[0]!.deltaEntry.scope).toBe("nape");
    // Reported: two matches for the same color skill.
    expect(colorMatches).toHaveLength(2);
    expect(new Set(colorMatches.map((m) => m.skillDefinitionId)).size).toBe(1);
    expect(colorMatches.map((m) => m.deltaEntry.field).sort()).toEqual(["colorLevel", "colorTone"]);
    expect(colorMatches.find((m) => m.deltaEntry.field === "colorLevel")?.deltaEntry.transformation).toBe("INCREASED");
    expect(colorMatches.find((m) => m.deltaEntry.field === "colorTone")?.deltaEntry.transformation).toBe("PRESERVED");

    // Post-fix: 3 Unresolved -- nape/lengthIntent is now resolved; the two
    // global facts and nape/weightIntent (PRESERVE_WEIGHT, still an
    // intentionally open registry gap) remain honestly unresolved.
    expect(selection.unresolvedDeltas).toHaveLength(3);
    const unresolvedKeys = selection.unresolvedDeltas.map((e) => `${e.scope}/${e.field}`).sort();
    expect(unresolvedKeys).toEqual(["global/density", "global/relativeLength", "nape/weightIntent"]);
  });

  it("STRUCTURAL PROOF, isolated: nape lengthIntent=shorten now resolves to a real CUT candidate (post-fix); weightIntent=preserve stays unresolved (PRESERVE_WEIGHT, an intentionally open gap) on its own, with no global facts involved at all", async () => {
    const { ownerUserId, clientId } = await seedOwnerAndClient();
    const current: HairStateSnapshotPayload = { ...basePayload(), colorState: { level: { value: "level_5", source: "observed" }, tone: { value: "warm_gold", source: "observed" } } };
    const target: HairStateSnapshotPayload = {
      ...withZone(basePayload(), "nape", { lengthIntent: { value: "shorten", source: "professional_input" }, weightIntent: { value: "preserve", source: "professional_input" } }),
      colorState: { level: { value: "level_5", source: "professional_input" }, tone: { value: "warm_gold", source: "professional_input" } },
    };

    const currentRow = await createDraftCurrentState(ownerUserId, clientId, { payload: current });
    await confirmSnapshot(ownerUserId, clientId, currentRow.id, null);
    const targetRow = await createDraftTargetState(ownerUserId, clientId, target);
    await confirmSnapshot(ownerUserId, clientId, targetRow.id, null);

    const selection = await selectMultiDomainCandidateSkills(ownerUserId, clientId);
    const cutMatches = selection.candidateMatches.filter((m) => m.matchedCapability !== "EVALUATE_COLOR_SERVICE");
    expect(cutMatches).toHaveLength(1);
    expect(cutMatches[0]!.skillKey).toBe("skill-cutting-graduated");
    expect(cutMatches[0]!.matchedCapability).toBe("REDUCE_LENGTH");
    expect(selection.unresolvedDeltas.map((e) => `${e.scope}/${e.field}`).sort()).toEqual(["nape/weightIntent"]);
    // Color is unchanged (both sides level_5/warm_gold) -> both entries PRESERVED, still real candidates (2 matches, 1 skill).
    expect(selection.candidateMatches.filter((m) => m.matchedCapability === "EVALUATE_COLOR_SERVICE")).toHaveLength(2);
  });

  it("perimeterRelationship='at_perimeter' + lengthIntent='preserve' at nape -- the correct vocabulary for a straight, one-length result -- produces a real CUT match via the establish-guide skill (independent of the Stage 8.5S1B.R2 graduated-skill zone fix above, which separately closes the 'shorten' case)", async () => {
    const { ownerUserId, clientId } = await seedOwnerAndClient();
    const current = basePayload();
    const target: HairStateSnapshotPayload = withZone(basePayload(), "nape", {
      lengthIntent: { value: "preserve", source: "professional_input" },
      perimeterRelationship: { value: "at_perimeter", source: "professional_input" },
    });

    const currentRow = await createDraftCurrentState(ownerUserId, clientId, { payload: current });
    await confirmSnapshot(ownerUserId, clientId, currentRow.id, null);
    const targetRow = await createDraftTargetState(ownerUserId, clientId, target);
    await confirmSnapshot(ownerUserId, clientId, targetRow.id, null);

    const selection = await selectMultiDomainCandidateSkills(ownerUserId, clientId);
    const cutMatches = selection.candidateMatches.filter((m) => m.matchedCapability !== "EVALUATE_COLOR_SERVICE");
    expect(cutMatches.length).toBeGreaterThan(0);
    expect(cutMatches.some((m) => m.skillKey === "skill-cutting-establish-central-nape-guide")).toBe(true);
  });

  it("UNKNOWN-DATA case: an entirely unassessed CURRENT+TARGET pair (both sides never touched) produces zero candidates and zero unresolved deltas -- silence is never read as a change or a gap, matching hair-state-delta.ts's own UNKNOWN discipline", async () => {
    const { ownerUserId, clientId } = await seedOwnerAndClient();
    const empty = basePayload();
    const currentRow = await createDraftCurrentState(ownerUserId, clientId, { payload: empty });
    await confirmSnapshot(ownerUserId, clientId, currentRow.id, null);
    const targetRow = await createDraftTargetState(ownerUserId, clientId, empty);
    await confirmSnapshot(ownerUserId, clientId, targetRow.id, null);

    const selection = await selectMultiDomainCandidateSkills(ownerUserId, clientId);
    expect(selection.candidateMatches).toHaveLength(0);
    expect(selection.unresolvedDeltas).toHaveLength(0);
    expect(selection.delta.entries.every((e) => e.transformation === "UNKNOWN")).toBe(true);
  });
});
