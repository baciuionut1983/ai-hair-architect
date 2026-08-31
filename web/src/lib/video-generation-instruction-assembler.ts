import { humanizeEnumValue } from "@/lib/humanize-enum-value";
import type { SealedVideoDemonstrationRequest } from "@/lib/video-generation-contracts";

// Real AI Video Demonstration, Stage 1 -- deterministic prompt assembly,
// mirroring photo-preview-instruction-assembler.ts's own discipline: the
// server is the ONLY place a provider prompt is ever built, from already-
// confirmed structured data, never a browser-supplied string.
//
// Deliberately short and generic (Video Stage 0 Decision Lock, section 10):
// there is no zone-level technique content to describe, because Video V1
// never asks the provider to change or explain anything -- only to animate
// an image that is already the confirmed, correct result. A longer,
// more "detailed" prompt here would not add real information; it would
// only invite the provider to invent plausible-sounding technique detail
// that this sealed request never actually authorized.

const VIEW_LABEL_MOTION_HINT: Record<string, string> = {
  front: "a subtle, natural head turn to each side",
  left_profile: "a gentle turn from the left profile toward the camera",
  right_profile: "a gentle turn from the right profile toward the camera",
  back: "a slow, natural turn revealing the back of the head",
  other: "a subtle, natural head movement",
};

export function assembleVeoVideoDemonstrationInstruction(sealedRequest: SealedVideoDemonstrationRequest): string {
  const motionHint = VIEW_LABEL_MOTION_HINT[sealedRequest.viewLabel] ?? VIEW_LABEL_MOTION_HINT.other;
  const technique = humanizeEnumValue(sealedRequest.targetSummary.structuralTechnique);

  const lines = [
    "TASK",
    `Animate this exact photo with ${motionHint}, so the hairstyle is clearly visible in natural motion. This is a realistic preview of an already-approved, confirmed professional look (${technique}) -- do not change the hairstyle, only show it moving naturally.`,
    "",
    "PRESERVATION REQUIREMENTS",
    ...buildPreservationLines(sealedRequest),
    "",
    "STYLE",
    "Photorealistic, smooth and continuous motion, natural lighting consistent with the original photo, no scene cuts, no camera shake, no text overlays.",
    "",
    "EXPLICIT PROHIBITION",
    "Do not alter the hairstyle, face, body, clothing, jewelry, or background in any way. Do not add people, objects, or text that are not in the original photo. Do not stylize or illustrate -- this must remain a realistic video.",
  ];

  return lines.join("\n");
}

const PRESERVE_INVARIANT_SENTENCES: Record<string, string> = {
  preserve_identity: "The person's identity must remain unmistakably the same throughout the video.",
  preserve_facial_geometry: "Keep the exact facial structure (face shape, nose, jawline) unchanged.",
  preserve_skin_tone: "Keep skin tone and texture exactly as shown.",
  preserve_expression: "Keep a natural, consistent expression -- no exaggerated or changing emotion.",
  preserve_hairstyle_exactly_as_shown: "Keep the hairstyle -- length, shape, color, texture -- exactly as shown in the source photo.",
  preserve_clothing: "Keep clothing exactly as shown.",
  preserve_jewelry_and_accessories: "Keep jewelry and visible accessories exactly as shown.",
  preserve_background: "Keep the background consistent with the source photo.",
  preserve_overall_photographic_realism: "Maintain photographic realism throughout -- matching the original photo's lighting and camera perspective.",
};

function buildPreservationLines(sealedRequest: SealedVideoDemonstrationRequest): string[] {
  return sealedRequest.preserveContract.invariants
    .map((invariant) => PRESERVE_INVARIANT_SENTENCES[invariant])
    .filter((sentence): sentence is string => Boolean(sentence))
    .map((sentence) => `- ${sentence}`);
}
