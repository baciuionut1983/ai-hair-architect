import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";

import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createLearningEvidence } from "@/lib/professional-learning-evidence-repository";
import { processEvidenceIntoDraft } from "@/lib/professional-learning-draft-service";
import { GeminiProfessionalLearningExtractor } from "@/lib/professional-learning-extractor-gemini";
import { resolveRealProfessionalLearningExtractionConfig } from "@/lib/professional-learning-real-extraction-config";
import { buildCanonicalCandidateSkillRegistry } from "@/lib/professional-brain-skill-templates";
import { findDraftForOwner } from "@/lib/professional-learning-draft-repository";
import { isValidExtraction } from "@/lib/professional-learning-draft-validators";

// AI Hair Architect, Professional Skill Engine Stage 8.5L4.R1 -- THE ONE
// AUTHORIZED REAL AI EXTRACTION ACCEPTANCE TEST. This is a REAL,
// PAID Gemini network call -- it is gated by
// PROFESSIONAL_LEARNING_REAL_EXTRACTION_ENABLED, which is OFF BY DEFAULT
// (Part 39) and is never set to "true" in any committed file. It never
// runs as part of `npm test`/CI; it runs only when a human explicitly
// exports that variable and invokes this exact file. LOCAL/TEST database
// only -- no production writes, no production migration (Part 44).
//
// The controlled evidence text below is the exact professionally-approved
// "Construct One-Length Perimeter" description this stage's own task
// specifies (Part 11) -- verbatim, so the real model's extraction can be
// honestly compared against it (Part 24). The real extractor
// (professional-learning-extractor-gemini.ts) NEVER receives the registry
// itself -- only this evidence text -- so there is no way for the model
// to "copy" the expected answer (Part 12/17).
const config = resolveRealProfessionalLearningExtractionConfig(process.env);
const suite = config.status === "enabled" && process.env.DATABASE_URL ? describe : describe.skip;

const ONE_LENGTH_EVIDENCE_TEXT = `Construct One-Length Perimeter.

The haircut starts at the posterior/back area by establishing the desired final length/contour. The posterior hair is divided into two equal sections. Work upward using horizontal partings of approximately 1 cm. Each prepared strand is brought into natural fall and cut to the established length/guide. There is no elevation in this technique. The established contour/final length remains the authority for the haircut.

The previously cut strand is visible through the next prepared strand and acts as the visible continuation guide, but it does not replace the authority of the established contour/length line.

Progress strand by strand through the posterior area until the upper/crown area is completed. Then work the left and right sides separately. For the lateral area, use horizontal partings progressing from the ear toward the temple. Connect the lateral section to the previously established posterior guide behind the ear. Continue upward using the same structural principle.

Before cutting, the hair/strand must be evenly combed and controlled.

Final verification includes: checking for longer hairs protruding from the established line, adjusting those hairs if necessary, checking left/right symmetry, checking continuity of the perimeter line across posterior and lateral areas, drying the hair, rechecking the result according to natural fall.

No Slice-and-Slide is part of this pure One-Length technique. No elevation is used.`;

const owners = new Set<string>();

suite("Stage 8.5L4.R1 -- ONE real Gemini extraction acceptance test (real network call, real cost)", () => {
  afterAll(async () => {
    // Deliberately does NOT delete the created evidence/draft -- Part 21/22
    // expect the real draft to remain inspectable via the L4 review UI
    // after this test runs. Only the throwaway owner/user row's other
    // dependents are cleaned by this project's usual afterEach convention
    // in sibling suites; this one-off acceptance run intentionally leaves
    // its real artifacts in the local/test DB for manual review.
    void owners;
  });

  it("extracts the controlled One-Length evidence with one real Gemini call and produces a valid, non-conflicting, non-duplicating draft", async () => {
    if (config.status !== "enabled") throw new Error("unreachable -- suite is skipped when disabled");

    const ownerUserId = randomUUID();
    owners.add(ownerUserId);
    await prisma.user.create({ data: { id: ownerUserId, email: `${ownerUserId}@l4r1-acceptance.test`, passwordHash: "test", role: "professional", locale: "en" } });

    const evidence = await createLearningEvidence(ownerUserId, {
      evidenceType: "TEXT",
      vertical: "hair_cutting",
      originalText: ONE_LENGTH_EVIDENCE_TEXT,
      provenance: { channel: "typed" },
      rightsClassification: "USER_OWNED_OR_AUTHORIZED",
    });

    const registry = buildCanonicalCandidateSkillRegistry();
    const beforeSnapshot = JSON.stringify(registry.map((r) => ({ skillId: r.skillId, version: r.version, payload: r.payload })));
    const skillRowsBefore = await prisma.professionalSkillDefinition.count();

    const extractor = new GeminiProfessionalLearningExtractor({ apiKey: config.apiKey, model: config.model, timeoutMs: config.timeoutMs });

    const startedAt = Date.now();
    const outcome = await processEvidenceIntoDraft({ ownerUserId, evidenceId: evidence.id, draftId: randomUUID(), extractor, registry });
    const latencyMs = Date.now() - startedAt;

    const afterSnapshot = JSON.stringify(registry.map((r) => ({ skillId: r.skillId, version: r.version, payload: r.payload })));
    const skillRowsAfter = await prisma.professionalSkillDefinition.count();

    // Part 20: the approved registry is provably unchanged by this call.
    expect(afterSnapshot).toBe(beforeSnapshot);
    expect(skillRowsAfter).toBe(skillRowsBefore);
    expect(skillRowsAfter).toBe(0);

    expect(outcome.kind).toBe("created");
    if (outcome.kind !== "created") throw new Error(`unexpected outcome: ${JSON.stringify(outcome)}`);

    const persisted = await findDraftForOwner(ownerUserId, outcome.draft.id);
    expect(persisted).not.toBeNull();
    expect(isValidExtraction(outcome.draft.extraction)).toBe(true);

    // Write the full, real result to disk (never printed as a test
    // assertion failure message with secrets -- there are none here,
    // this is provider output + our own derived fields) so the final
    // report can quote it verbatim.
    fs.writeFileSync(
      path.join(process.cwd(), "scratch-l4r1-real-extraction-result.json"),
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

    // Basic sanity the harness itself should assert (detailed semantic
    // grading happens by hand afterward, against the real output file).
    expect(outcome.draft.comparisonOutcome).not.toBe("POSSIBLE_CONFLICT");
  }, 60_000);
});
