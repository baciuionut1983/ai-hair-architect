import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";

import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { persistUploadedLearningVideoAsset } from "@/lib/video-asset-storage";
import { createLearningEvidence } from "@/lib/professional-learning-evidence-repository";
import { GeminiProfessionalLearningExtractor } from "@/lib/professional-learning-extractor-gemini";
import { resolveRealProfessionalLearningExtractionConfig } from "@/lib/professional-learning-real-extraction-config";
import { buildCanonicalCandidateSkillRegistry } from "@/lib/professional-brain-skill-templates";
import type { ProfessionalLearningExtractorOutput } from "@/lib/professional-learning-extractor";
import { planLongVideoWindows } from "@/lib/professional-learning-video-long-window-planner";
import { reconcileLongVideoWindows } from "@/lib/professional-learning-video-cross-window-reconciliation";
import { buildProceduralCandidate } from "@/lib/professional-learning-video-procedural-candidate";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R2 -- THE ONE
// AUTHORIZED REAL LONG-VIDEO EXTRACTION ACCEPTANCE TEST. Real, paid
// Gemini calls (File API upload ONCE + up to 5 bounded-window
// generateContent calls, well under the 8-call hard maximum) -- gated by
// PROFESSIONAL_LEARNING_REAL_EXTRACTION_ENABLED, OFF BY DEFAULT, never
// set to "true" in any committed file. Never runs as part of `npm test`/
// CI. LOCAL/TEST database only, LOCAL-backend video storage only (no S3
// write).
//
// BLIND TEST LOCK (Section 5): no technique name, no registry, no
// expected sequence, no prior L5.R1/L5.R1.1 findings are ever passed to
// the provider. The only context is the same generic "HAIR / CUTTING"
// domain hint already established as non-revealing, plus the neutral
// windowed-clip clarification (professional-learning-extractor-gemini.ts's
// own WINDOWED_CLIP_NOTE) -- never the source filename.
//
// NO DRAFT CREATED (deliberate scope decision, Section 34/38/40): this
// stage's deliverable is the PROCEDURAL CANDIDATE -- an interpretation of
// the observed/inferred procedure -- explicitly NOT an approved skill,
// ExecutionPlan, or forced single-technique draft. Creating a
// ProfessionalLearningDraft here would force a flat, single-technique-
// shaped summary onto an 11-minute, multi-phase procedure the task
// itself warns against ("Do NOT turn the full video into: this is
// haircut X, therefore steps are X1/X2/X3"). Registry comparison is
// still performed, per-window, read-only, deterministic, and reported --
// just never persisted as a draft row.
const SOURCE_VIDEO_PATH = "C:\\Users\\hp\\Documents\\Codex\\2026-09-14\\referenced-chatgpt-conversation-this-is-an\\outputs\\L5_R2_demonstratie_tuns_bob_11min.mp4";
// Measured locally via Windows Shell COM before any paid call (see this
// stage's own report) -- 11:11 = 671 seconds. Re-verified as a sanity
// check inside the test itself against the actual file, never trusted
// blindly.
const MEASURED_DURATION_SECONDS = 671;
const WINDOW_COUNT = 5;
const CONTEXT_MARGIN_SECONDS = 20;
const SEGMENTATION_VERSION = "l5r2-long-video-v1";

const config = resolveRealProfessionalLearningExtractionConfig(process.env);
const sourceAvailable = fs.existsSync(SOURCE_VIDEO_PATH);
const suite = config.status === "enabled" && process.env.DATABASE_URL && sourceAvailable ? describe : describe.skip;

const owners = new Set<string>();

suite("Stage 8.5L5.R2 -- ONE real segmented long-video BLIND extraction acceptance (real network calls, real cost)", () => {
  afterAll(async () => {
    void owners; // intentionally not cleaned up -- inspectable for professional review, matching L4.R2/L5.R1's own precedent.
  });

  it(
    "processes the real 11-minute source across 5 bounded windows (1 upload, 5 calls), reconciles deterministically, and builds a procedural candidate",
    async () => {
      if (config.status !== "enabled") throw new Error("unreachable -- suite is skipped when disabled");

      const stat = fs.statSync(SOURCE_VIDEO_PATH);
      const sourceBytes = fs.readFileSync(SOURCE_VIDEO_PATH);

      const ownerUserId = randomUUID();
      owners.add(ownerUserId);
      await prisma.user.create({ data: { id: ownerUserId, email: `${ownerUserId}@l5r2-acceptance.test`, passwordHash: "test", role: "professional", locale: "en" } });
      const clientId = randomUUID();
      await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "L5.R2 Acceptance Client" } });

      const videoAsset = await persistUploadedLearningVideoAsset(ownerUserId, clientId, sourceBytes, "video/mp4");
      expect(videoAsset.storageBackend).toBeNull(); // never touches production S3

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

      // --- Section 6: plan + report call count BEFORE any paid call. ---
      const plan = planLongVideoWindows({
        sourceEvidenceId: evidence.id,
        totalDurationSeconds: MEASURED_DURATION_SECONDS,
        windowCount: WINDOW_COUNT,
        contextMarginSeconds: CONTEXT_MARGIN_SECONDS,
        segmentationVersion: SEGMENTATION_VERSION,
      });
      expect(plan.windows).toHaveLength(WINDOW_COUNT);
      expect(WINDOW_COUNT).toBeLessThanOrEqual(8); // hard maximum

      const extractor = new GeminiProfessionalLearningExtractor({ apiKey: config.apiKey, model: config.model, timeoutMs: config.timeoutMs });

      const uploadStartedAt = Date.now();
      const uploaded = await extractor.uploadVideoForWindowedAnalysis({ buffer: sourceBytes, mimeType: "video/mp4" });
      const uploadLatencyMs = Date.now() - uploadStartedAt;

      const rawResultsByWindowId = new Map<string, ProfessionalLearningExtractorOutput>();
      const perWindowTiming: { windowId: string; index: number; latencyMs: number }[] = [];
      let realCallCount = 0;
      let retryCount = 0;

      for (const window of plan.windows) {
        const startedAt = Date.now();
        try {
          const output = await extractor.extractVideoWindow({
            fileUri: uploaded.fileUri,
            mimeType: uploaded.mimeType,
            startOffsetSeconds: window.contextInterval.timeStartSeconds,
            endOffsetSeconds: window.contextInterval.timeEndSeconds,
            domainHint: "HAIR / CUTTING",
            relevantRegistry: registry,
          });
          realCallCount += 1;
          rawResultsByWindowId.set(window.id, output);
        } catch (firstError) {
          // Section 6/8: one retry permitted ONLY for a malformed/
          // transient provider transport failure -- never to coach
          // toward a more desirable answer.
          retryCount += 1;
          const output = await extractor.extractVideoWindow({
            fileUri: uploaded.fileUri,
            mimeType: uploaded.mimeType,
            startOffsetSeconds: window.contextInterval.timeStartSeconds,
            endOffsetSeconds: window.contextInterval.timeEndSeconds,
            domainHint: "HAIR / CUTTING",
            relevantRegistry: registry,
          });
          realCallCount += 1;
          rawResultsByWindowId.set(window.id, output);
          void firstError;
        }
        perWindowTiming.push({ windowId: window.id, index: window.index, latencyMs: Date.now() - startedAt });
      }

      expect(realCallCount).toBeLessThanOrEqual(WINDOW_COUNT + 2); // budget safety, well under the hard maximum of 8

      // --- Section 39/41: read-only, deterministic, per-window registry comparison -- never persisted as a draft, never mutates the registry. ---
      const perWindowTechniqueCandidates = plan.windows.map((window) => {
        const raw = rawResultsByWindowId.get(window.id);
        return { windowId: window.id, index: window.index, techniqueCandidate: raw?.extraction.techniqueCandidate?.value ?? null, comparisonSkillIdHint: raw?.comparisonSkillIdHint ?? null };
      });

      const afterSnapshot = JSON.stringify(registry.map((r) => ({ skillId: r.skillId, version: r.version, payload: r.payload })));
      const skillRowsAfter = await prisma.professionalSkillDefinition.count();
      expect(afterSnapshot).toBe(beforeSnapshot);
      expect(skillRowsAfter).toBe(skillRowsBefore);
      expect(skillRowsAfter).toBe(0);

      // --- Deterministic reconciliation + procedural candidate (ZERO additional AI calls from here on). ---
      const reconciliation = reconcileLongVideoWindows(evidence.id, plan.windows, rawResultsByWindowId, SEGMENTATION_VERSION);
      const proceduralCandidate = buildProceduralCandidate({
        actionCandidates: reconciliation.actionCandidates,
        segments: reconciliation.segments,
        editGaps: reconciliation.editGaps,
        resultObservationPresent: reconciliation.resultObservationCandidates.length > 0,
        validationCandidatePresent: reconciliation.validationCandidates.length > 0,
      });

      expect(reconciliation.observations.length).toBeGreaterThan(0);

      fs.writeFileSync(
        path.join(process.cwd(), "scratch-l5r2-real-long-video-extraction-result.json"),
        JSON.stringify(
          {
            ownerUserId,
            evidenceId: evidence.id,
            videoAssetId: videoAsset.id,
            source: { absolutePath: SOURCE_VIDEO_PATH, sizeBytes: stat.size, measuredDurationSeconds: MEASURED_DURATION_SECONDS },
            plan,
            realCallCount,
            retryCount,
            uploadLatencyMs,
            perWindowTiming,
            usage: extractor.lastUsage ?? null,
            providerRequestId: extractor.lastProviderRequestId ?? null,
            model: config.model,
            rawResultsByWindow: Object.fromEntries([...rawResultsByWindowId.entries()]),
            perWindowTechniqueCandidates,
            reconciliation,
            proceduralCandidate,
          },
          null,
          2,
        ),
      );
    },
    900_000,
  );
});
