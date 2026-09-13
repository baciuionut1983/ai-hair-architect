import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";

import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { saveImageFile } from "@/lib/image-storage";
import { createLearningEvidence } from "@/lib/professional-learning-evidence-repository";
import { processEvidenceIntoDraft } from "@/lib/professional-learning-draft-service";
import { GeminiProfessionalLearningExtractor } from "@/lib/professional-learning-extractor-gemini";
import { resolveRealProfessionalLearningExtractionConfig } from "@/lib/professional-learning-real-extraction-config";
import { buildCanonicalCandidateSkillRegistry } from "@/lib/professional-brain-skill-templates";
import { findDraftForOwner } from "@/lib/professional-learning-draft-repository";
import { isValidExtraction } from "@/lib/professional-learning-draft-validators";

// AI Hair Architect, Professional Skill Engine Stage 8.5L4.R2 -- THE ONE
// AUTHORIZED REAL MULTIMODAL (IMAGE/DIAGRAM) EXTRACTION ACCEPTANCE TEST.
// This is a REAL, PAID Gemini network call -- gated by
// PROFESSIONAL_LEARNING_REAL_EXTRACTION_ENABLED, OFF BY DEFAULT (Part 48),
// never set to "true" in any committed file. Never runs as part of
// `npm test`/CI. LOCAL/TEST database only.
//
// The acceptance image is a real, professionally-supplied hairdressing
// "Layers" sectioning diagram (three panel views: circular/square/
// triangular guide shapes over a head silhouette), read from the exact
// local path the professional saved it to -- never an internet image,
// never a generated image, never production/client material (Part 5).
//
// NO PRE-ANSWERING (Part 7): the only context given to the model besides
// the image itself is the minimal domain hint "HAIR / CUTTING" -- no
// description of what the diagram supposedly shows, no professional
// caption. The professional explicitly withheld interpretation before
// this call, by design.
const ACCEPTANCE_IMAGE_PATH = "C:\\Users\\hp\\Desktop\\ai hair architect\\54b7d73f-9172-416d-a40b-492d25fc4967.png";

const config = resolveRealProfessionalLearningExtractionConfig(process.env);
const imageAvailable = fs.existsSync(ACCEPTANCE_IMAGE_PATH);
const suite = config.status === "enabled" && process.env.DATABASE_URL && imageAvailable ? describe : describe.skip;

const owners = new Set<string>();

suite("Stage 8.5L4.R2 -- ONE real multimodal (diagram) extraction acceptance test (real network call, real cost)", () => {
  afterAll(async () => {
    void owners; // intentionally not cleaned up -- see Part 21/22, the real draft must remain inspectable via the review UI.
  });

  it("extracts the real professional Layers diagram with one real Gemini multimodal call and produces a valid, review-required draft", async () => {
    if (config.status !== "enabled") throw new Error("unreachable -- suite is skipped when disabled");

    const ownerUserId = randomUUID();
    owners.add(ownerUserId);
    await prisma.user.create({ data: { id: ownerUserId, email: `${ownerUserId}@l4r2-acceptance.test`, passwordHash: "test", role: "professional", locale: "en" } });
    const clientId = randomUUID();
    await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "L4.R2 Acceptance Client" } });

    const imageBytes = fs.readFileSync(ACCEPTANCE_IMAGE_PATH);
    const assetId = randomUUID();
    const storagePath = await saveImageFile(ownerUserId, assetId, "layers-diagram.png", imageBytes);
    await prisma.imageAsset.create({
      data: { id: assetId, fileName: "layers-diagram.png", mimeType: "image/png", sizeBytes: imageBytes.length, ownerUserId, clientId, storagePath, storageBackend: null },
    });

    const evidence = await createLearningEvidence(ownerUserId, {
      evidenceType: "DIAGRAM",
      vertical: "hair_cutting",
      imageAssetId: assetId,
      provenance: { channel: "upload" },
      rightsClassification: "USER_OWNED_OR_AUTHORIZED",
    });

    const registry = buildCanonicalCandidateSkillRegistry();
    const beforeSnapshot = JSON.stringify(registry.map((r) => ({ skillId: r.skillId, version: r.version, payload: r.payload })));
    const skillRowsBefore = await prisma.professionalSkillDefinition.count();

    const extractor = new GeminiProfessionalLearningExtractor({ apiKey: config.apiKey, model: config.model, timeoutMs: config.timeoutMs });

    const startedAt = Date.now();
    const outcome = await processEvidenceIntoDraft({ ownerUserId, evidenceId: evidence.id, draftId: randomUUID(), extractor, registry, domainHint: "HAIR / CUTTING" });
    const latencyMs = Date.now() - startedAt;

    const afterSnapshot = JSON.stringify(registry.map((r) => ({ skillId: r.skillId, version: r.version, payload: r.payload })));
    const skillRowsAfter = await prisma.professionalSkillDefinition.count();

    // Part 49: the approved registry is provably unchanged by this call.
    expect(afterSnapshot).toBe(beforeSnapshot);
    expect(skillRowsAfter).toBe(skillRowsBefore);
    expect(skillRowsAfter).toBe(0);

    expect(outcome.kind).toBe("created");
    if (outcome.kind !== "created") throw new Error(`unexpected outcome: ${JSON.stringify(outcome)}`);

    const persisted = await findDraftForOwner(ownerUserId, outcome.draft.id);
    expect(persisted).not.toBeNull();
    expect(isValidExtraction(outcome.draft.extraction)).toBe(true);

    fs.writeFileSync(
      path.join(process.cwd(), "scratch-l4r2-real-extraction-result.json"),
      JSON.stringify(
        {
          ownerUserId,
          evidenceId: evidence.id,
          draftId: outcome.draft.id,
          latencyMs,
          usage: extractor.lastUsage ?? null,
          providerRequestId: extractor.lastProviderRequestId ?? null,
          model: config.model,
          draft: persisted,
        },
        null,
        2,
      ),
    );
  }, 60_000);
});
