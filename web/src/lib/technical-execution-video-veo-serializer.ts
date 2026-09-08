import type {
  ProviderAdapterActionSegment,
  ProviderAdapterSemanticFact,
  ProviderAdapterTranslationOutput,
} from "@/lib/professional-skill-provider-adapter-contracts";
import { humanizeEnumValue } from "@/lib/humanize-enum-value";
import type { DemonstrationRequirementCategory } from "@/lib/professional-skill-demonstration-requirement-contracts";
import type { FramingSemantic, ViewpointFamily } from "@/lib/professional-skill-viewpoint-constraint-contracts";

// AI Hair Architect, Stage 2.5.i.23 -- TECHNICAL EXECUTION VIDEO, VEO
// PROVIDER SERIALIZER. Pure, deterministic: ProviderAdapterTranslationOutput
// (Stage 2.5.i.21, already gate-approved -- TRANSLATED status only) -> one
// Veo-ready rendering instruction string. Zero I/O, zero database, zero
// provider SDK import, zero network call. Sits strictly AFTER the Stage
// 2.5.i.21 Provider Adapter, per this stage's own task Section 4.
//
// SOLE INPUT (task Section 5): this function's ONLY parameter is the typed
// ProviderAdapterTranslationOutput -- there is no second parameter through
// which stale prose, AnalysisProposal free text, Technical Demonstration
// description, Photo Preview description, Result Video prompt, or any
// LLM-generated bridge text could ever reach the returned instruction.
// Changing any of that unrelated free text anywhere else in the codebase is
// structurally incapable of changing this function's output, because none
// of it is reachable from this function's only parameter -- provable by the
// signature alone, and re-proven by a static import-boundary test (see
// technical-execution-video-veo-serializer.test.ts).
//
// GENERIC OVER CATEGORY/FAMILY/FRAMING, never cutting-specific: every
// phrase table below is keyed by the ALREADY-universal
// DemonstrationRequirementCategory / ViewpointFamily / FramingSemantic
// vocabularies (Stage 2.5.i.10/i.12) -- no "wet", "comb", "shear", or
// "Central Nape" string appears anywhere in this file's own executable
// logic; those are VALUES flowing through the generic `value`/`category`
// fields, never encoded as a branch. This file would serialize an equally
// real future coloring or texturizing ProviderAdapterTranslationOutput
// without any change.
//
// SHOW, NOT NARRATE (task Section 8): the instruction states each visible
// fact as something the video must visually depict, and explicitly tells
// the provider not to explain the technique via on-screen text/narration
// instead of showing it. Text overlays are explicitly NOT requested (task
// Section 10 -- not mandatory for this first pilot).
//
// NO NEW AUTHORITY: this function never invents a professional fact, never
// recalculates technique, never selects a viewpoint, and never chooses
// wording that goes beyond phrasing the ALREADY-resolved
// category/value/viewpointFamily/framingSemantics already present on the
// translation output. It never reads `output.visualReference` into the
// text either -- the image itself is sent as a separate attachment by the
// caller (technical-execution-video-veo-provider.ts), never re-described
// in prose.
//
// ONE REQUEST, NOT THREE (task Section 2): the whole `segments` array
// (already grouped into exactly one ProviderAdapterTranslationOutput by
// Stage 2.5.i.21) becomes exactly one instruction string, describing an
// ordered sequence within a single continuous video -- never one instruction
// per segment, never multiple provider requests.

const CATEGORY_PHRASES: Record<DemonstrationRequirementCategory, (value: string) => string> = {
  TOOL_TO_SUBJECT_RELATIONSHIP: (value) => `the tool-to-subject relationship: ${value}`,
  SUBJECT_TO_REFERENCE_GEOMETRY: (value) => `the subject's geometry relative to its reference: ${value}`,
  RESULTING_LINE_OR_FORM: (value) => `the resulting line/form: ${value}`,
  ANATOMICAL_CONTEXT: (value) => `the anatomical context: ${value}`,
  SUBJECT_POSITION_STATE: (value) => `the subject's position: ${value}`,
  SUBJECT_CONDITION_STATE: (value) => `the subject's visible condition: ${value}`,
};

const VIEWPOINT_FAMILY_PHRASES: Record<ViewpointFamily, string> = {
  POSTERIOR: "from a posterior (back-of-head) viewpoint only -- never a front, side-profile, overhead, or orbiting camera",
};

const FRAMING_SEMANTIC_PHRASES: Record<FramingSemantic, string> = {
  ANATOMICAL_CONTEXT_VISIBLE: "keeping the anatomical context clearly visible",
  TECHNICAL_RELATIONSHIP_READABLE: "keeping the tool-to-subject technical relationship clearly readable",
  GEOMETRY_READABLE: "keeping the resulting geometry/line clearly readable",
};

function formatFactValue(value: ProviderAdapterSemanticFact["value"]): string {
  return typeof value === "string" ? humanizeEnumValue(value) : String(value);
}

function formatFact(fact: ProviderAdapterSemanticFact): string {
  return CATEGORY_PHRASES[fact.category](formatFactValue(fact.value));
}

function formatSegment(segment: ProviderAdapterActionSegment, index: number): string {
  const facts = segment.requiredVisibleFacts.map(formatFact).join("; ");
  const framingPhrases = [...new Set(segment.framingSemantics.map((semantic) => FRAMING_SEMANTIC_PHRASES[semantic]))];
  return `${index + 1}. Show ${facts} -- ${VIEWPOINT_FAMILY_PHRASES[segment.viewpointFamily]}, ${framingPhrases.join(", ")}.`;
}

// The sole export. Deterministic: the same ProviderAdapterTranslationOutput
// always produces byte-identical output.
export function assembleTechnicalExecutionVeoInstruction(output: ProviderAdapterTranslationOutput): string {
  const steps = [...output.segments]
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((segment, index) => formatSegment(segment, index))
    .join("\n");

  const lines = [
    "TASK",
    "Show, in one continuous, real-world video, the exact person from the attached reference photo performing the following professional action sequence, in this exact order. This is a technical execution demonstration -- depict the action itself; do not narrate or explain it via on-screen text.",
    "",
    "SEQUENCE (must be visually shown, in this exact order, without skipping, reordering, or adding any step)",
    steps,
    "",
    "STYLE",
    "Photorealistic, continuous motion, natural lighting and camera consistent with the reference photo. No scene cuts, no camera shake, no text overlays, no narration.",
    "",
    "EXPLICIT PROHIBITION",
    "Do not add, invent, or substitute any action, tool, technique, or viewpoint beyond what is listed above. Do not change the person's identity, face, or the visible environment. Do not stylize or illustrate -- this must remain a realistic video.",
  ];

  return lines.join("\n");
}
