import { createVideoLearningSegment, createTemporalObservation, type VideoLearningSegment, type TemporalObservation } from "@/lib/professional-learning-video-segmentation";
import { createActionCandidate, type ActionCandidate, type ResultObservation, type ValidationCandidate } from "@/lib/professional-learning-video-temporal-reasoning";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5 -- DETERMINISTIC
// MOCK ACCEPTANCE FIXTURES (Section 36). Zero real AI/Gemini/Vision calls
// -- every value below is hand-authored, exactly like every prior
// hand-built-fake-extractor fixture in this codebase (Stage 8.5L4's
// `fakeImageExtractor`, `professional-learning-mock-extractor.ts`). This
// fixture exists to test the ARCHITECTURE (segmentation, temporal
// reasoning, semantic binding), not to encode a real haircut recipe --
// none of these observation strings should be read as a professionally
// endorsed technique.
//
// Segments A-G represent a hypothetical posterior-zone graduated cutting
// sequence, wet-to-dry, matching this stage's own task example:
//   A: wet hair, posterior zone visible, comb passes root->tip.
//   B: subsection controlled, scissors cut ends.
//   C: operator moves to an adjacent subsection.
//   D: similar control + cut repeats.
//   E: operator progresses upward (adjacent zone).
//   F: later, dry result visible.
//   G: operator checks perimeter/symmetry (validation).

export const FIXTURE_SEGMENTATION_VERSION = "l5-fixture-v1";
export const FIXTURE_EXTRACTOR_VERSION = "l5-fixture-extractor-v1";

export interface AcceptanceFixtureBundle {
  readonly sourceEvidenceId: string;
  readonly segments: Readonly<Record<"A" | "B" | "C" | "D" | "E" | "F" | "G", VideoLearningSegment>>;
  readonly observations: readonly TemporalObservation[];
  readonly actionCandidates: readonly ActionCandidate[];
  readonly resultObservation: ResultObservation;
  readonly validationCandidate: ValidationCandidate;
}

// Builds the full A-G sequence for a given sourceEvidenceId. Pure and
// deterministic: calling this twice with the same sourceEvidenceId
// produces byte-identical (deep-equal) output -- the idempotency proof
// this stage's task requires (Section 50).
export function buildFullAcceptanceFixture(sourceEvidenceId: string): AcceptanceFixtureBundle {
  const seg = (start: number, end: number) => createVideoLearningSegment(sourceEvidenceId, { timeStartSeconds: start, timeEndSeconds: end }, FIXTURE_SEGMENTATION_VERSION);

  const segments = {
    A: seg(0, 10),
    B: seg(10, 20),
    C: seg(20, 22),
    D: seg(22, 32),
    E: seg(32, 34),
    F: seg(180, 190),
    G: seg(190, 200),
  } as const;

  const obs = (segmentId: string, description: string, provenance: TemporalObservation["provenance"] = "OBSERVED") =>
    createTemporalObservation(segmentId, sourceEvidenceId, description, provenance, FIXTURE_EXTRACTOR_VERSION);

  const observations: TemporalObservation[] = [
    obs(segments.A.id, "Hair visibly wet."),
    obs(segments.A.id, "Comb passes through the posterior subsection from root to tip."),
    obs(segments.B.id, "A controlled strand is held for cutting."),
    obs(segments.B.id, "Scissors visibly close across the ends of the strand."),
    obs(segments.C.id, "Operator visibly moves to an adjacent subsection."),
    obs(segments.D.id, "A controlled strand is held for cutting."),
    obs(segments.D.id, "Scissors visibly close across the ends of the strand."),
    obs(segments.E.id, "Operator visibly moves to the next zone above the previous subsections."),
    obs(segments.F.id, "Hair visibly dry and styled."),
    obs(segments.G.id, "Operator visibly checks both sides of the perimeter."),
  ];

  const byDescription = (segmentId: string, description: string) => observations.find((o) => o.segmentId === segmentId && o.description === description)!.id;

  const cuttingB = createActionCandidate(
    [segments.B.id],
    [byDescription(segments.B.id, "A controlled strand is held for cutting."), byDescription(segments.B.id, "Scissors visibly close across the ends of the strand.")],
    "CUTTING",
    "APPROXIMATE",
    "APPROXIMATE",
  );
  const cuttingD = createActionCandidate(
    [segments.D.id],
    [byDescription(segments.D.id, "A controlled strand is held for cutting."), byDescription(segments.D.id, "Scissors visibly close across the ends of the strand.")],
    "CUTTING",
    "APPROXIMATE",
    "APPROXIMATE",
  );

  const resultObservation: ResultObservation = {
    id: "result-" + segments.F.id,
    segmentId: segments.F.id,
    description: "Hair visibly dry and styled, finished perimeter visible.",
    provenance: "OBSERVED",
  };

  const validationCandidate: ValidationCandidate = {
    id: "validation-" + segments.G.id,
    segmentId: segments.G.id,
    description: "Operator visibly checks both sides of the perimeter for symmetry.",
    provenance: "OBSERVED",
    // Declared explicitly by this fixture (standing in for a future
    // extractor's own bound proposal or a professional annotation) --
    // never derived by keyword-matching inside the reasoning module
    // itself (Section 44/60).
    semanticallySupported: true,
  };

  return { sourceEvidenceId, segments, observations, actionCandidates: [cuttingB, cuttingD], resultObservation, validationCandidate };
}

// Section 37 -- single-cut negative control: one subsection, one scissor
// cut, video ends. No repetition, no progression, no result.
export function buildSingleCutFixture(sourceEvidenceId: string) {
  const segment = createVideoLearningSegment(sourceEvidenceId, { timeStartSeconds: 0, timeEndSeconds: 10 }, FIXTURE_SEGMENTATION_VERSION);
  const observation = createTemporalObservation(segment.id, sourceEvidenceId, "Scissors visibly close across the ends of a controlled strand.", "OBSERVED", FIXTURE_EXTRACTOR_VERSION);
  const action = createActionCandidate([segment.id], [observation.id], "CUTTING", "APPROXIMATE", "APPROXIMATE");
  return { segment, observation, action };
}

// Section 38 -- edited-jump negative control: first subsection visible,
// video cuts, finished zone visible. Missing footage must remain UNKNOWN,
// never fabricated as OBSERVED.
export function buildEditedJumpFixture(sourceEvidenceId: string) {
  const firstSubsection = createVideoLearningSegment(sourceEvidenceId, { timeStartSeconds: 0, timeEndSeconds: 10 }, FIXTURE_SEGMENTATION_VERSION);
  const finishedZone = createVideoLearningSegment(sourceEvidenceId, { timeStartSeconds: 200, timeEndSeconds: 210 }, FIXTURE_SEGMENTATION_VERSION);
  const beforeObservation = createTemporalObservation(firstSubsection.id, sourceEvidenceId, "A single subsection is being controlled for cutting.", "OBSERVED", FIXTURE_EXTRACTOR_VERSION);
  const afterObservation = createTemporalObservation(finishedZone.id, sourceEvidenceId, "The zone appears finished.", "OBSERVED", FIXTURE_EXTRACTOR_VERSION);
  const action = createActionCandidate([firstSubsection.id], [beforeObservation.id], "CUTTING", "APPROXIMATE", "UNKNOWN");
  const declaredBreak = { beforeSegmentId: firstSubsection.id, afterSegmentId: finishedZone.id };
  return { firstSubsection, finishedZone, beforeObservation, afterObservation, action, declaredBreak };
}
