import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";

import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { persistUploadedLearningVideoAsset } from "@/lib/video-asset-storage";
import { createLearningEvidence } from "@/lib/professional-learning-evidence-repository";
import { processEvidenceIntoDraft } from "@/lib/professional-learning-draft-service";
import { GeminiProfessionalLearningExtractor } from "@/lib/professional-learning-extractor-gemini";
import { resolveRealProfessionalLearningExtractionConfig } from "@/lib/professional-learning-real-extraction-config";
import { buildCanonicalCandidateSkillRegistry } from "@/lib/professional-brain-skill-templates";
import { findDraftForOwner } from "@/lib/professional-learning-draft-repository";
import { isValidExtraction } from "@/lib/professional-learning-draft-validators";
import type { ProfessionalLearningExtractor, ProfessionalLearningExtractorInput, ProfessionalLearningExtractorOutput } from "@/lib/professional-learning-extractor";
import { createVideoLearningSegment, createTemporalObservation, type VideoLearningSegment, type TemporalObservation } from "@/lib/professional-learning-video-segmentation";
import { assessRepetition, assessZoneCompletion, assessEffect, createActionCandidate, type ActionCandidate } from "@/lib/professional-learning-video-temporal-reasoning";
import { computeVideoTimeIntervalOrder } from "@/lib/professional-learning-video-temporal";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R1 -- THE ONE
// AUTHORIZED REAL VIDEO EXTRACTION ACCEPTANCE TEST. This is a REAL, PAID
// Gemini network call (File API upload + exactly ONE generateContent
// call) -- gated by PROFESSIONAL_LEARNING_REAL_EXTRACTION_ENABLED, OFF BY
// DEFAULT, never set to "true" in any committed file. Never runs as part
// of `npm test`/CI. LOCAL/TEST database only, LOCAL-backend video storage
// only (no S3 write -- see professional-learning-video-media-resolver.ts's
// own header for why this test structurally cannot reach S3).
//
// BLIND TEST RULE (Section 1): the acceptance video is real professional
// footage Ionuț supplied specifically for this test. No technique name,
// no expected answer, no prior description of the footage is given to
// the model anywhere -- the only context is the same minimal, generic
// "HAIR / CUTTING" domain hint Stage 8.5L4.R2 already established as
// non-revealing.
//
// EXACTLY ONE REAL generateContent CALL (Section 8): the File API
// upload/poll is provider TRANSPORT, not a second analysis call -- see
// professional-learning-extractor-gemini.ts's own header comment on
// extractFromVideo. A thin CapturingExtractor wraps the real extractor so
// this single real call's FULL raw output (including temporalObservations/
// actionCandidates/notableEditsOrCuts, which processEvidenceIntoDraft's
// own return shape does not carry) can be captured for the L5 temporal-
// reasoning demonstration and the deterministic-replay fixture below --
// without ever calling .extract() a second time.
const ACCEPTANCE_VIDEO_PATH = "C:\\Users\\hp\\Downloads\\IMG_9798.mp4";

const config = resolveRealProfessionalLearningExtractionConfig(process.env);
const videoAvailable = fs.existsSync(ACCEPTANCE_VIDEO_PATH);
const suite = config.status === "enabled" && process.env.DATABASE_URL && videoAvailable ? describe : describe.skip;

const owners = new Set<string>();

class CapturingExtractor implements ProfessionalLearningExtractor {
  readonly extractorVersion: string;
  lastRawOutput: ProfessionalLearningExtractorOutput | undefined;
  callCount = 0;

  constructor(private readonly real: ProfessionalLearningExtractor) {
    this.extractorVersion = real.extractorVersion;
  }

  async extract(input: ProfessionalLearningExtractorInput): Promise<ProfessionalLearningExtractorOutput> {
    this.callCount += 1;
    const output = await this.real.extract(input);
    this.lastRawOutput = output;
    return output;
  }
}

suite("Stage 8.5L5.R1 -- ONE real BLIND video extraction acceptance test (real network call, real cost)", () => {
  afterAll(async () => {
    void owners; // intentionally not cleaned up -- the real draft/evidence must remain inspectable for professional review, matching L4.R2's own precedent.
  });

  it(
    "extracts the real supplied video (IMG_9798.mp4) with one real Gemini call, produces a valid review-required draft, and runs it through L5 temporal reasoning",
    async () => {
      if (config.status !== "enabled") throw new Error("unreachable -- suite is skipped when disabled");

      const ownerUserId = randomUUID();
      owners.add(ownerUserId);
      await prisma.user.create({ data: { id: ownerUserId, email: `${ownerUserId}@l5r1-acceptance.test`, passwordHash: "test", role: "professional", locale: "en" } });
      const clientId = randomUUID();
      await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "L5.R1 Acceptance Client" } });

      const videoBytes = fs.readFileSync(ACCEPTANCE_VIDEO_PATH);
      const videoAsset = await persistUploadedLearningVideoAsset(ownerUserId, clientId, videoBytes, "video/mp4");
      // Fails loudly (never silently) if this test environment somehow
      // resolved a real object-storage write target -- this test must
      // never touch production S3 (Section 5/38).
      expect(videoAsset.storageBackend).toBeNull();

      const evidence = await createLearningEvidence(ownerUserId, {
        evidenceType: "VIDEO",
        vertical: "hair_cutting",
        videoAssetId: videoAsset.id,
        provenance: { channel: "upload", purpose: "PROFESSIONAL_LEARNING" },
        rightsClassification: "USER_OWNED_OR_AUTHORIZED",
      });

      const registry = buildCanonicalCandidateSkillRegistry();
      const beforeSnapshot = JSON.stringify(registry.map((r) => ({ skillId: r.skillId, version: r.version, payload: r.payload })));
      const skillRowsBefore = await prisma.professionalSkillDefinition.count();

      const realExtractor = new GeminiProfessionalLearningExtractor({ apiKey: config.apiKey, model: config.model, timeoutMs: config.timeoutMs });
      const capturing = new CapturingExtractor(realExtractor);

      const startedAt = Date.now();
      const outcome = await processEvidenceIntoDraft({ ownerUserId, evidenceId: evidence.id, draftId: randomUUID(), extractor: capturing, registry, domainHint: "HAIR / CUTTING" });
      const latencyMs = Date.now() - startedAt;

      // Section 8: exactly one real extract() call.
      expect(capturing.callCount).toBe(1);

      const afterSnapshot = JSON.stringify(registry.map((r) => ({ skillId: r.skillId, version: r.version, payload: r.payload })));
      const skillRowsAfter = await prisma.professionalSkillDefinition.count();

      // Section 39: the approved registry is provably unchanged.
      expect(afterSnapshot).toBe(beforeSnapshot);
      expect(skillRowsAfter).toBe(skillRowsBefore);
      expect(skillRowsAfter).toBe(0);

      expect(outcome.kind).toBe("created");
      if (outcome.kind !== "created") throw new Error(`unexpected outcome: ${JSON.stringify(outcome)}`);

      const persisted = await findDraftForOwner(ownerUserId, outcome.draft.id);
      expect(persisted).not.toBeNull();
      expect(isValidExtraction(outcome.draft.extraction)).toBe(true);

      const rawOutput = capturing.lastRawOutput;
      if (!rawOutput) throw new Error("expected a captured raw output");

      // ---------------------------------------------------------------
      // L5 TEMPORAL REASONING DEMONSTRATION (Section 30) -- deterministic
      // post-processing of the real provider's raw temporal claims. No
      // additional AI call anywhere below this line.
      // ---------------------------------------------------------------
      const temporalObservationsRaw = rawOutput.temporalObservations ?? [];
      const actionCandidatesRaw = rawOutput.actionCandidates ?? [];
      const notableEditsOrCutsRaw = rawOutput.notableEditsOrCuts ?? [];

      const segmentByIntervalKey = new Map<string, VideoLearningSegment>();
      const segmentFor = (start: number, end: number): VideoLearningSegment => {
        const key = `${start}|${end}`;
        const existing = segmentByIntervalKey.get(key);
        if (existing) return existing;
        const created = createVideoLearningSegment(evidence.id, { timeStartSeconds: start, timeEndSeconds: end }, "gemini-video-real-v1");
        segmentByIntervalKey.set(key, created);
        return created;
      };

      const observations: TemporalObservation[] = temporalObservationsRaw.map((raw) => {
        const segment = segmentFor(raw.timeStartSeconds, raw.timeEndSeconds);
        return createTemporalObservation(segment.id, evidence.id, raw.observation, "OBSERVED", capturing.extractorVersion);
      });

      const actionCandidates: ActionCandidate[] = actionCandidatesRaw.map((raw) => {
        const actionSegment = segmentFor(raw.timeStartSeconds, raw.timeEndSeconds);
        const relatedObservationIds = observations
          .filter((obs) => {
            const obsSegment = [...segmentByIntervalKey.values()].find((s) => s.id === obs.segmentId);
            return obsSegment && computeVideoTimeIntervalOrder(actionSegment.interval, obsSegment.interval) === "OVERLAPS";
          })
          .map((obs) => obs.id);
        return createActionCandidate([actionSegment.id], relatedObservationIds, raw.kind, "APPROXIMATE", "APPROXIMATE");
      });

      // Repetition, per distinct provider-proposed kind -- no declared
      // scope size (the model was not asked for an intended-zone size in
      // this first acceptance test), so scopeEstablished is honestly
      // false unless a future stage adds that data.
      const kinds = [...new Set(actionCandidates.map((c) => c.kind))];
      const repetitionByKind = Object.fromEntries(kinds.map((kind) => [kind, assessRepetition(actionCandidates, kind)]));

      // Zone completion -- honestly NOT_ESTABLISHED/IN_PROGRESS/UNKNOWN
      // without spatial zone-adjacency data (not solicited from the model
      // in this first acceptance test) or an explicit result/validation
      // signal; never fabricated as COMPLETED.
      const zoneCompletionByKind = Object.fromEntries(
        kinds.map((kind) => [
          kind,
          assessZoneCompletion({
            repetition: repetitionByKind[kind],
            progression: { status: "UNKNOWN", zoneSequence: [] },
            resultObservationPresent: false,
            validationPresent: false,
          }),
        ]),
      );

      // Effect -- for each action candidate, the nearest observation
      // strictly BEFORE and strictly AFTER its own interval, with
      // continuity broken only when the provider reported an edit/cut
      // whose boundaries fall between them.
      const effectAssessments = actionCandidates.map((action) => {
        const actionSegment = [...segmentByIntervalKey.values()].find((s) => s.id === action.segmentIds[0])!;
        const before = observations
          .filter((obs) => {
            const s = [...segmentByIntervalKey.values()].find((seg) => seg.id === obs.segmentId)!;
            return computeVideoTimeIntervalOrder(s.interval, actionSegment.interval) === "BEFORE";
          })
          .at(-1);
        const after = observations.find((obs) => {
          const s = [...segmentByIntervalKey.values()].find((seg) => seg.id === obs.segmentId)!;
          return computeVideoTimeIntervalOrder(actionSegment.interval, s.interval) === "BEFORE";
        });
        const continuityBroken = notableEditsOrCutsRaw.some((gap) => gap.beforeTimeSeconds <= actionSegment.interval.timeEndSeconds && gap.afterTimeSeconds >= actionSegment.interval.timeStartSeconds);
        return { actionKind: action.kind, actionInterval: actionSegment.interval, assessment: assessEffect(before ?? null, action, after ?? null, continuityBroken) };
      });

      expect(observations.every((o) => o.segmentId.length > 0 && o.sourceEvidenceId === evidence.id)).toBe(true);

      fs.writeFileSync(
        path.join(process.cwd(), "scratch-l5r1-real-video-extraction-result.json"),
        JSON.stringify(
          {
            ownerUserId,
            evidenceId: evidence.id,
            videoAssetId: videoAsset.id,
            draftId: outcome.draft.id,
            latencyMs,
            realCallCount: capturing.callCount,
            usage: realExtractor.lastUsage ?? null,
            providerRequestId: realExtractor.lastProviderRequestId ?? null,
            model: config.model,
            draft: persisted,
            rawOutput,
            l5: {
              segments: [...segmentByIntervalKey.values()],
              observations,
              actionCandidates,
              repetitionByKind,
              zoneCompletionByKind,
              effectAssessments,
            },
          },
          null,
          2,
        ),
      );
    },
    300_000,
  );
});
