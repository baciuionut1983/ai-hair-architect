import { createActionCandidate, type ActionCandidate } from "@/lib/professional-learning-video-temporal-reasoning";
import { createVideoLearningSegment, type VideoLearningSegment } from "@/lib/professional-learning-video-segmentation";
import type { ReconciledEditGap } from "@/lib/professional-learning-video-cross-window-reconciliation";
import { buildProceduralCandidate, type ProceduralCandidate } from "@/lib/professional-learning-video-procedural-candidate";
import type { ProfessionalLearningTemporalEvidence } from "@/lib/professional-learning-video-temporal-evidence";

// AI Hair Architect, Professional Skill Engine Stage 8.5T1.4.a -- WORLD A
// -> WORLD B BRIDGE. Pure, no I/O, no database, ZERO real AI calls.
//
// WHY THIS FILE EXISTS: the T1.4 audit found two disconnected temporal
// systems. WORLD A (this stage's own T1.2/T1.3 work) is the ACTIVE path
// that persists ProfessionalLearningTemporalEvidence on a real draft.
// WORLD B (professional-learning-video-temporal-reasoning.ts /
// -procedural-candidate.ts) is a fully-built, fully-tested procedural
// REASONING engine -- repetition/progression/zone-completion/core-chain
// summary -- that has NEVER been called with real data, because it
// expects a different input shape (VideoLearningSegment/ActionCandidate,
// window/reconciliation types) than what World A persists.
//
// THIS FILE IS THE ONLY NEW LOGIC. It is a pure, minimal, TYPED ADAPTER:
// it converts World A's flat evidence arrays into the exact shapes
// WORLD B's OWN, UNMODIFIED constructors/functions already require, then
// calls buildProceduralCandidate/createVideoLearningSegment/
// createActionCandidate VERBATIM. It adds NO new professional-reasoning
// logic of its own -- every repetition/zone-completion/core-chain
// judgment below is produced entirely by code that already existed
// before this stage and was already exhaustively tested (just never
// wired to real data).
//
// AUTHORITY (the task's own "critical authority rule"): the entire
// result is an INFERRED derivation over already-tagged evidence. Never
// upgraded to OBSERVED, never to PROFESSIONAL_INPUT. Nothing in this
// file assigns or reads a provenance tag at all -- ProceduralCandidate
// itself carries no `source` field (see its own header: "NOT an
// approved skill... an interpretation of the observed/inferred
// procedure"), so there is nothing here that could accidentally
// upgrade authority; the review UI is responsible for framing this
// section as derived/non-authoritative in its own copy.
//
// NO FABRICATION: this adapter never invents a zone identifier, a
// declared repetition scope, a result observation, or a validation
// candidate -- none of those exist in World A's persisted shape, so
// they are honestly passed through as absent (progression is fed with
// zero zone visits inside buildProceduralCandidate itself, and
// resultObservationPresent/validationCandidatePresent are always
// `false` here) rather than guessed. This is exactly what makes
// "video end == procedure complete" structurally impossible to derive
// from this call: assessZoneCompletion can never reach "COMPLETED"
// without a declared scope AND a result observation AND a validation
// candidate, none of which this adapter ever supplies.
//
// ACTION KIND IS NEVER RECLASSIFIED: World A's raw `kind` string
// (e.g. "COMBING", "CUTTING_ACTION") is carried through verbatim as
// ActionCandidate.kind -- exactly the "open, caller-supplied label,
// never classified here" contract that file already documents. This
// stage deliberately does NOT attempt to map it onto the Skill
// Engine's AtomicActionKind (PREPARE/POSITION/CONTROL/EXECUTE/OBSERVE/
// VERIFY): that vocabulary only has meaning in the context of an
// already-approved SkillDefinition/SkillInstance (sourceSkillId/
// sourceSkillVersion), which a freshly-observed, unapproved video has
// no basis to claim. Preserving the raw label rather than inventing a
// stronger semantic type is the explicitly correct choice here.
//
// observationIds ARE LEFT EMPTY, DELIBERATELY: World A's persisted
// `actions` entries carry no reliable, non-fabricated link to specific
// `observations` entries (the two arrays are independently time-ranged,
// never explicitly cross-referenced by the extractor). Guessing a link
// from approximate time overlap would be exactly the kind of invented
// value this stage must not produce, so every ActionCandidate built
// here has an empty observationIds array.

// Stable, deterministic segmentation-version tag for this bridge only
// -- never shared with any other segmentation caller, so a future,
// genuinely different bridge version can never collide with this one's
// own segment ids.
export const TEMPORAL_TO_PROCEDURAL_BRIDGE_VERSION = "t1.4a-bridge-v1";

// `identitySeed` is any stable string already available to the caller
// (the draft's own id is the natural choice) -- it only feeds the
// deterministic id hash inside createVideoLearningSegment/
// createActionCandidate; it is never displayed and never a claim about
// the underlying evidence itself.
export function buildProceduralInterpretation(
  identitySeed: string,
  temporalEvidence: ProfessionalLearningTemporalEvidence | null | undefined,
): ProceduralCandidate | null {
  if (!temporalEvidence || temporalEvidence.actions.length === 0) return null;

  const segments: VideoLearningSegment[] = [];
  const actionCandidates: ActionCandidate[] = [];

  for (const action of temporalEvidence.actions) {
    const segment = createVideoLearningSegment(
      identitySeed,
      { timeStartSeconds: action.timeStartSeconds, timeEndSeconds: action.timeEndSeconds },
      TEMPORAL_TO_PROCEDURAL_BRIDGE_VERSION,
    );
    segments.push(segment);
    // Boundary state is KNOWN, not APPROXIMATE/UNKNOWN: the persisted
    // entry already states an exact numeric interval (T1.3's own
    // source-duration gate is what governs whether that number is
    // trustworthy at all -- a separate, upstream concern this adapter
    // does not re-litigate).
    actionCandidates.push(createActionCandidate([segment.id], [], action.kind, "KNOWN", "KNOWN"));
  }

  const editGaps: readonly ReconciledEditGap[] = temporalEvidence.editGaps.map((gap) => ({
    beforeTimeSeconds: gap.beforeTimeSeconds,
    afterTimeSeconds: gap.afterTimeSeconds,
  }));

  return buildProceduralCandidate({
    actionCandidates,
    segments,
    editGaps,
    // Neither concept exists in World A's persisted shape today -- see
    // file header. Always honestly false, never guessed true.
    resultObservationPresent: false,
    validationCandidatePresent: false,
  });
}
