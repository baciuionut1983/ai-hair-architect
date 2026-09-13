import type { ProfessionalLearningExtractorOutput } from "@/lib/professional-learning-extractor";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R1 -- the
// EXACT raw output captured from the one authorized real Gemini video
// call (professional-learning-extractor-gemini-video-real-acceptance.test.ts,
// run 2026-09-13, providerRequestId "W7emav62H_PxnsEPm5WesAc", source
// video IMG_9798.mp4, sha256
// a25e4b8c2ca02350298698e0056b17999693d476c371c93bad9aa6273ce2030a),
// hand-copied verbatim as a literal fixture and NEVER edited since.
//
// ABSOLUTE PROVENANCE RULE (Stage 8.5L5.R1.1, Section 2): this constant
// is the historically-true record of what Gemini originally, blindly
// observed -- it must never be modified to make the video appear to have
// shown information it did not (e.g. 0-degree elevation or any guide/
// reference relationship, both entirely absent below, exactly as
// captured). Ionuț's post-hoc professional review is layered ON TOP of
// this via professional-learning-draft-service.ts's submitProfessionalCorrection
// (a NEW, separate draft row), never by editing this fixture.
//
// Shared by professional-learning-video-real-acceptance-replay.test.ts
// (Section 36's deterministic-replay proof) and
// professional-learning-video-l5r1-professional-correction-acceptance.test.ts
// (Stage 8.5L5.R1.1's professional-review integration) -- both must
// observe the exact same original AI interpretation.
export const L5R1_REAL_CAPTURED_OUTPUT: ProfessionalLearningExtractorOutput = {
  discernment: {
    category: "PROFESSIONAL_TECHNIQUE",
    reason: "Demonstrates technique for cutting a blunt perimeter baseline by adjusting client head position to remove under-hair growth.",
  },
  extraction: {
    domain: { value: "HAIR", source: "OBSERVED", confidence: 0.7, segments: [{ timeStartSeconds: 0, timeEndSeconds: 37, relevance: 1 }] },
    discipline: { value: "HAIRCUTTING", source: "OBSERVED", confidence: 0.7, segments: [{ timeStartSeconds: 0, timeEndSeconds: 37, relevance: 1 }] },
    techniqueCandidate: { value: "Blunt Bob Perimeter Cutting with Head Tilt", source: "INFERRED", confidence: 0.7, segments: [{ timeStartSeconds: 0, timeEndSeconds: 34, relevance: 1 }] },
    targetEffect: { value: "Clean blunt baseline", source: "OBSERVED", confidence: 0.7, segments: [{ timeStartSeconds: 30, timeEndSeconds: 37, relevance: 1 }] },
    applicableZones: { value: "Nape / Perimeter", source: "OBSERVED", confidence: 0.7, segments: [{ timeStartSeconds: 0, timeEndSeconds: 34, relevance: 1 }] },
    tool: { value: "Shears and Comb", source: "OBSERVED", confidence: 0.7, segments: [{ timeStartSeconds: 0, timeEndSeconds: 23, relevance: 1 }] },
  },
  comparisonSkillIdHint: null,
  relatedSkillIdHints: [],
  temporalObservations: [
    { timeStartSeconds: 0, timeEndSeconds: 5, observation: "Scissors cut hair horizontally across nape while client head is upright." },
    { timeStartSeconds: 5, timeEndSeconds: 9, observation: "Framing shifts to wider view showing upper sections clipped up; client tilts head forward." },
    { timeStartSeconds: 9, timeEndSeconds: 23, observation: "Comb pulls hair downward over tilted nape and scissors trim shorter hairs exposed below line." },
    { timeStartSeconds: 24, timeEndSeconds: 34, observation: "Client returns head upright and hand smooths hair to display perimeter line." },
    { timeStartSeconds: 35, timeEndSeconds: 37, observation: "Cut to finished dry styled blunt bob haircut." },
  ],
  actionCandidates: [
    { timeStartSeconds: 0, timeEndSeconds: 5, kind: "CUTTING_ACTION" },
    { timeStartSeconds: 5, timeEndSeconds: 9, kind: "REPOSITIONING" },
    { timeStartSeconds: 9, timeEndSeconds: 23, kind: "COMBING_AND_CUTTING" },
    { timeStartSeconds: 24, timeEndSeconds: 34, kind: "INSPECTION" },
  ],
  notableEditsOrCuts: [
    { beforeTimeSeconds: 5, afterTimeSeconds: 6 },
    { beforeTimeSeconds: 34, afterTimeSeconds: 35 },
  ],
};
