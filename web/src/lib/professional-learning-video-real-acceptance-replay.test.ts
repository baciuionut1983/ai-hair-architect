import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { deleteImageFile, saveImageFile } from "@/lib/image-storage";
import { createLearningEvidence } from "@/lib/professional-learning-evidence-repository";
import { processEvidenceIntoDraft } from "@/lib/professional-learning-draft-service";
import { buildCanonicalCandidateSkillRegistry } from "@/lib/professional-brain-skill-templates";
import type { ProfessionalLearningExtractor, ProfessionalLearningExtractorInput, ProfessionalLearningExtractorOutput } from "@/lib/professional-learning-extractor";
import { createVideoLearningSegment, createTemporalObservation, type VideoLearningSegment, type TemporalObservation } from "@/lib/professional-learning-video-segmentation";
import { assessRepetition, assessZoneCompletion, assessEffect, createActionCandidate, type ActionCandidate } from "@/lib/professional-learning-video-temporal-reasoning";
import { computeVideoTimeIntervalOrder } from "@/lib/professional-learning-video-temporal";
import { L5R1_REAL_CAPTURED_OUTPUT } from "@/lib/professional-learning-video-l5r1-real-fixture";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R1 -- Section
// 36 DETERMINISTIC REPLAY. Uses the EXACT raw output captured from the
// one authorized real Gemini video call (see professional-learning-
// video-l5r1-real-fixture.ts's own header for full provenance), replayed
// through validation -> UNKNOWN normalization -> semantic binding ->
// registry comparison -> draft creation, AND through the identical L5
// temporal-reasoning post-processing used at real-call time -- with ZERO
// additional AI calls anywhere in this file. Proves the pipeline is
// genuinely deterministic: the exact same input always produces the
// exact same segment/observation ids (content-hash-derived) and the
// exact same effect/repetition/completion assessments, not just "a
// similar-looking" result.
//
// Always runs as part of npm test/CI -- this file makes no network call
// of any kind.

const REAL_CAPTURED_OUTPUT: ProfessionalLearningExtractorOutput = L5R1_REAL_CAPTURED_OUTPUT;

class ReplayExtractor implements ProfessionalLearningExtractor {
  readonly extractorVersion = "gemini-real-v1:gemini-3.6-flash";
  callCount = 0;
  async extract(_input: ProfessionalLearningExtractorInput): Promise<ProfessionalLearningExtractorOutput> {
    this.callCount += 1;
    return REAL_CAPTURED_OUTPUT;
  }
}

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();
const localPaths = new Set<string>();
const DUMMY_MP4 = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 1, 2, 3, 4]);

suite("Stage 8.5L5.R1 -- deterministic replay of the real captured video extraction (Section 36, ZERO AI calls)", () => {
  afterEach(async () => {
    for (const p of localPaths) await deleteImageFile(p).catch(() => undefined);
    localPaths.clear();
    const ownerUserIds = [...owners];
    await prisma.professionalLearningDraft.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.professionalLearningEvidence.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.videoAsset.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownerUserIds } } });
    owners.clear();
  });

  it("replaying the captured raw output through the full pipeline produces a canonically-equivalent draft with zero AI calls", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const assetId = randomUUID();
    const storagePath = await saveImageFile(ownerUserId, assetId, "video.mp4", DUMMY_MP4);
    localPaths.add(storagePath);
    await prisma.videoAsset.create({ data: { id: assetId, ownerUserId, clientId, mimeType: "video/mp4", sizeBytes: DUMMY_MP4.length, storagePath, storageBackend: null, origin: "uploaded_source" } });

    const evidence = await createLearningEvidence(ownerUserId, {
      evidenceType: "VIDEO",
      vertical: "hair_cutting",
      videoAssetId: assetId,
      provenance: { channel: "upload", purpose: "PROFESSIONAL_LEARNING" },
      rightsClassification: "USER_OWNED_OR_AUTHORIZED",
    });

    const registry = buildCanonicalCandidateSkillRegistry();
    const beforeSnapshot = JSON.stringify(registry.map((r) => ({ skillId: r.skillId, version: r.version, payload: r.payload })));

    const replayExtractor = new ReplayExtractor();
    const outcome = await processEvidenceIntoDraft({ ownerUserId, evidenceId: evidence.id, draftId: randomUUID(), extractor: replayExtractor, registry, domainHint: "HAIR / CUTTING" });

    expect(replayExtractor.callCount).toBe(1);
    const afterSnapshot = JSON.stringify(registry.map((r) => ({ skillId: r.skillId, version: r.version, payload: r.payload })));
    expect(afterSnapshot).toBe(beforeSnapshot);
    expect(await prisma.professionalSkillDefinition.count()).toBe(0);

    expect(outcome.kind).toBe("created");
    if (outcome.kind !== "created") throw new Error("expected created");

    // Canonically equivalent to the real run's own persisted draft
    // (professional-learning-extractor-gemini-video-real-acceptance.test.ts's
    // captured scratch output): same discernment, same comparison
    // outcome (no false registry match), same key field values/sources.
    expect(outcome.draft.discernmentCategory).toBe("PROFESSIONAL_TECHNIQUE");
    expect(outcome.draft.comparisonOutcome).toBe("POSSIBLE_NEW_SKILL");
    expect(outcome.draft.comparedSkillId).toBeNull();
    expect(outcome.draft.extraction.tool).toEqual({ value: "Shears and Comb", source: "OBSERVED", confidence: 0.7, segments: [{ timeStartSeconds: 0, timeEndSeconds: 23, relevance: 1 }] });
    expect(outcome.draft.extraction.techniqueCandidate?.value).toBe("Blunt Bob Perimeter Cutting with Head Tilt");
    expect(outcome.draft.extraction.techniqueCandidate?.source).toBe("INFERRED");
    // No overreach survived replay either: every geometry/angle field the
    // real call itself left UNKNOWN remains UNKNOWN.
    for (const field of ["elevation", "distribution", "overdirection", "cuttingAngle", "fingerAngle", "guideType", "guideSource", "sectioning", "toolOrientation"] as const) {
      expect(outcome.draft.extraction[field]).toEqual({ value: null, source: "UNKNOWN" });
    }
  });

  it("the L5 temporal-reasoning post-processing over the captured raw output is deterministic -- identical segment/observation/action ids and effect assessments on every replay", () => {
    const runOnce = () => {
      const sourceEvidenceId = "replay-evidence-fixed-id";
      const segmentByIntervalKey = new Map<string, VideoLearningSegment>();
      const segmentFor = (start: number, end: number) => {
        const key = `${start}|${end}`;
        const existing = segmentByIntervalKey.get(key);
        if (existing) return existing;
        const created = createVideoLearningSegment(sourceEvidenceId, { timeStartSeconds: start, timeEndSeconds: end }, "gemini-video-real-v1");
        segmentByIntervalKey.set(key, created);
        return created;
      };

      const observations: TemporalObservation[] = (REAL_CAPTURED_OUTPUT.temporalObservations ?? []).map((raw) => {
        const segment = segmentFor(raw.timeStartSeconds, raw.timeEndSeconds);
        return createTemporalObservation(segment.id, sourceEvidenceId, raw.observation, "OBSERVED", "gemini-real-v1:gemini-3.6-flash");
      });

      const actionCandidates: ActionCandidate[] = (REAL_CAPTURED_OUTPUT.actionCandidates ?? []).map((raw) => {
        const actionSegment = segmentFor(raw.timeStartSeconds, raw.timeEndSeconds);
        const relatedObservationIds = observations
          .filter((obs) => {
            const obsSegment = [...segmentByIntervalKey.values()].find((s) => s.id === obs.segmentId)!;
            return computeVideoTimeIntervalOrder(actionSegment.interval, obsSegment.interval) === "OVERLAPS";
          })
          .map((obs) => obs.id);
        return createActionCandidate([actionSegment.id], relatedObservationIds, raw.kind, "APPROXIMATE", "APPROXIMATE");
      });

      const notableEditsOrCutsRaw = REAL_CAPTURED_OUTPUT.notableEditsOrCuts ?? [];
      const effectAssessments = actionCandidates.map((action) => {
        const actionSegment = [...segmentByIntervalKey.values()].find((s) => s.id === action.segmentIds[0])!;
        const before = observations
          .filter((obs) => computeVideoTimeIntervalOrder([...segmentByIntervalKey.values()].find((s) => s.id === obs.segmentId)!.interval, actionSegment.interval) === "BEFORE")
          .at(-1);
        const after = observations.find((obs) => computeVideoTimeIntervalOrder(actionSegment.interval, [...segmentByIntervalKey.values()].find((s) => s.id === obs.segmentId)!.interval) === "BEFORE");
        const continuityBroken = notableEditsOrCutsRaw.some((gap) => gap.beforeTimeSeconds <= actionSegment.interval.timeEndSeconds && gap.afterTimeSeconds >= actionSegment.interval.timeStartSeconds);
        return assessEffect(before ?? null, action, after ?? null, continuityBroken).status;
      });

      const repetition = assessRepetition(actionCandidates, "COMBING_AND_CUTTING");
      const zoneCompletion = assessZoneCompletion({ repetition, progression: { status: "UNKNOWN", zoneSequence: [] }, resultObservationPresent: false, validationPresent: false });

      return { segmentIds: [...segmentByIntervalKey.values()].map((s) => s.id), observationIds: observations.map((o) => o.id), effectAssessments, zoneCompletion };
    };

    const first = runOnce();
    const second = runOnce();

    expect(second).toEqual(first);
    // Matches the exact effect pattern observed at real-call time: the
    // first action has no "before" state (UNKNOWN), the reframing action
    // crosses a declared cut (UNKNOWN), the combing/cutting action has an
    // uninterrupted before/after pair (SUPPORTED), and the inspection
    // action's "after" crosses the second declared cut (UNKNOWN).
    expect(first.effectAssessments).toEqual(["UNKNOWN", "UNKNOWN", "SUPPORTED", "UNKNOWN"]);
    expect(first.zoneCompletion).toBe("UNKNOWN");
  });
});

async function createOwnerAndClient(): Promise<{ ownerUserId: string; clientId: string }> {
  const ownerUserId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({ data: { id: ownerUserId, email: `${ownerUserId}@l5r1-replay.test`, passwordHash: "test", role: "professional", locale: "en" } });
  const clientId = randomUUID();
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "L5.R1 Replay Client" } });
  return { ownerUserId, clientId };
}
