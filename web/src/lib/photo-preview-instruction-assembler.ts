import { humanizeEnumValue } from "@/lib/humanize-enum-value";
import type { SealedPhotoPreviewRequest } from "@/lib/photo-preview-contracts";
import { HEAD_ZONES, type HeadZone } from "@/lib/technical-visual-map-validators";

// Real AI Photo Preview, Stage 2 -- the deterministic, pure, provider-
// SPECIFIC (Gemini) instruction assembler. Converts a provider-independent
// SealedPhotoPreviewRequest into the actual text sent to the model.
//
// Never touches the network, the database, or any provider SDK -- purely a
// string transform, fully unit-testable. This is the ONE place a Gemini
// image-editing prompt is ever constructed; no other module builds prompt
// text. The instruction hierarchy locked by the task (§6) is followed
// exactly, as seven distinct, ordered sections -- never interleaved, so a
// reviewer can audit each concern independently.
//
// Every sentence here is derived from already-CONFIRMED structured data
// (SealedPhotoPreviewRequest's own frozen fields) or from the fixed,
// hardcoded product invariants -- never from arbitrary free text, and never
// inventing a professional decision that was never actually made (task §9:
// an unspecified/"preserve" zone value is described as exactly that, never
// upgraded into a creative assumption).

const PRESERVE_INVARIANT_SENTENCES: Record<string, string> = {
  modify_hair_only: "Modify the hair only. Every other part of this photo must remain exactly as it appears in the source image.",
  preserve_face_identity: "This must remain visibly the same person. Do not change who this person looks like.",
  preserve_facial_geometry: "Preserve the exact facial geometry and proportions -- do not reshape the face, jaw, or head outline.",
  preserve_skin_tone: "Preserve the exact skin tone.",
  preserve_eyes: "Preserve the eyes exactly as they appear -- shape, color, position, and gaze.",
  preserve_nose: "Preserve the nose exactly as it appears.",
  preserve_lips: "Preserve the lips exactly as they appear.",
  preserve_ears_except_unavoidable_hair_occlusion:
    "Preserve the ears exactly as they appear, except where the new hair naturally and unavoidably covers them.",
  preserve_expression: "Preserve the person's facial expression.",
  preserve_body: "Preserve the body exactly as it appears -- pose, build, and visible skin.",
  preserve_clothing: "Preserve the clothing exactly as it appears.",
  preserve_jewelry_and_accessories_unless_hair_interaction_requires_otherwise:
    "Preserve jewelry and accessories exactly as they appear, unless the new hair naturally covers or interacts with them.",
  preserve_background: "Preserve the background exactly as it appears.",
  preserve_overall_photographic_realism:
    "Keep the result photorealistic, matching the original photo's lighting, camera perspective, and image quality -- this is a realistic preview, not stylized or illustrated art.",
};

const PRESERVE_CONSTRAINT_TYPE_SENTENCES: Record<string, (zone?: HeadZone, reference?: string) => string> = {
  preserve_identity: () => "Preserve this client's identity.",
  preserve_face_proportions: () => "Preserve this client's face proportions.",
  preserve_hairline: () => "Preserve the natural hairline exactly as it appears in the source photo.",
  preserve_density_sensitive_area: (zone) =>
    zone
      ? `The ${humanizeEnumValue(zone)} area is density-sensitive for this client -- avoid adding visual density there.`
      : "A specific area is density-sensitive for this client -- avoid adding visual density there.",
  preserve_perimeter_weight: () => "Preserve the perimeter's visual weight/thickness as closely as possible.",
  respect_contraindication: (_zone, reference) =>
    reference ? `Safety context (do not attempt to visually depict or resolve this): ${reference}` : "A safety contraindication applies to this client.",
  do_not_modify_unrelated_appearance: () => "Do not modify any appearance unrelated to the hair.",
};

export function assembleGeminiPhotoPreviewInstruction(sealedRequest: SealedPhotoPreviewRequest): string {
  const sections = [
    buildTaskSection(sealedRequest),
    buildPreservationInvariantsSection(sealedRequest),
    buildConfirmedTargetSection(sealedRequest),
    buildTechnicalIntentSection(sealedRequest),
    buildSpatialSection(sealedRequest),
    buildPerimeterAndConstraintsSection(sealedRequest),
    buildProhibitionSection(),
  ];
  return sections.filter((section) => section.trim().length > 0).join("\n\n");
}

// 1. Task
function buildTaskSection(sealedRequest: SealedPhotoPreviewRequest): string {
  return (
    "TASK:\n" +
    "You are editing a real photo of a hair salon client to visually preview a haircut that a licensed " +
    "professional stylist has already planned and confirmed for this exact client. This is a professional " +
    `hairstyling consultation preview, not decorative art. The photo shows the client's ${humanizeEnumValue(
      sealedRequest.viewLabel,
    ).toLowerCase()} view.`
  );
}

// 2. Immutable preservation requirements
function buildPreservationInvariantsSection(sealedRequest: SealedPhotoPreviewRequest): string {
  const lines = sealedRequest.preserveContract.invariants.map((invariant) => PRESERVE_INVARIANT_SENTENCES[invariant] ?? "");
  return ["PRESERVATION REQUIREMENTS (apply to all of the below):", ...lines.filter(Boolean)].join("\n- ");
}

// 3. Confirmed haircut/look target
function buildConfirmedTargetSection(sealedRequest: SealedPhotoPreviewRequest): string {
  const intent = sealedRequest.target.globalIntent;
  const lines: string[] = [
    `Structural technique: ${humanizeEnumValue(intent.structuralTechnique)}.`,
    `Cutting technique: ${humanizeEnumValue(intent.cuttingTechnique)}.`,
    `Sectioning: ${humanizeEnumValue(intent.sectioning)}.`,
    `Elevation: ${humanizeEnumValue(intent.elevation)}.`,
    `Distribution: ${humanizeEnumValue(intent.distribution)}.`,
    `Guideline: ${humanizeEnumValue(intent.guideline)}.`,
  ];
  if (intent.texturizingTechnique) {
    lines.push(`Texturizing technique: ${humanizeEnumValue(intent.texturizingTechnique)}.`);
  }
  for (const relationship of sealedRequest.target.relationships) {
    lines.push(
      `${humanizeEnumValue(relationship.sourceZone)} should be ${relationship.relationship.replace(/_/g, " ")} ${humanizeEnumValue(
        relationship.targetZone,
      )}.`,
    );
  }
  return ["CONFIRMED HAIRCUT TARGET (already approved by the client and stylist -- follow this, do not invent a different style):", ...lines].join(
    "\n- ",
  );
}

// 4. Semantic technical intent, per zone -- ONLY zones with an actual
// confirmed claim are mentioned (task §9: never invent a professional
// decision that was never made). A zone that is fully "unspecified" and not
// marked preserve carries no line here at all.
function buildTechnicalIntentSection(sealedRequest: SealedPhotoPreviewRequest): string {
  const lines: string[] = [];
  for (const zone of HEAD_ZONES) {
    const entry = sealedRequest.target.zones.find((z) => z.zone === zone);
    if (!entry) continue;

    const claims: string[] = [];
    if (entry.preserve) claims.push("leave exactly as-is, do not shorten or reduce");
    if (entry.lengthIntent !== "unspecified" && entry.lengthIntent !== "preserve") claims.push(`${entry.lengthIntent} the length`);
    else if (entry.lengthIntent === "preserve" && !entry.preserve) claims.push("preserve the current length");
    if (entry.weightIntent !== "unspecified" && entry.weightIntent !== "preserve") claims.push(`${entry.weightIntent} the weight`);
    else if (entry.weightIntent === "preserve" && !entry.preserve) claims.push("preserve the current weight");

    if (claims.length > 0) {
      lines.push(`${humanizeEnumValue(zone)}: ${claims.join(", ")}.`);
    }
  }
  if (lines.length === 0) return "";
  return ["ZONE-LEVEL INTENT (anatomical reference zones -- crown, occipital, nape, top, sides, fringe):", ...lines].join("\n- ");
}

// 5. Spatial information from the confirmed spatial binding. `not_placed`
// zones are OMITTED entirely (no explicit spatial claim exists -- task
// §11/§9); `not_visible` zones get an explicit "do not infer" line (task
// §11 -- required test: not_visible never becomes invented geometry).
function buildSpatialSection(sealedRequest: SealedPhotoPreviewRequest): string {
  const lines: string[] = [];
  for (const zone of HEAD_ZONES) {
    const entry = sealedRequest.spatial.zones.find((z) => z.zone === zone);
    if (!entry) continue;
    if (entry.state === "placed") {
      lines.push(
        `${humanizeEnumValue(zone)} anchor is approximately at normalized image position (x=${entry.x.toFixed(2)}, y=${entry.y.toFixed(2)}) ` +
          `(0,0 is the top-left corner of the photo, 1,1 is the bottom-right corner) -- ${describeQuadrant(entry.x, entry.y)}.`,
      );
    } else if (entry.state === "not_visible") {
      lines.push(`${humanizeEnumValue(zone)} is not visible in this photo -- do not infer or invent its geometry.`);
    }
    // "not_placed" -- deliberately no line at all.
  }
  if (lines.length === 0) return "";
  return ["SPATIAL REFERENCE POINTS (approximate professional guidance, not a precise mask):", ...lines].join("\n- ");
}

// 6. Perimeter + preserve constraints + contraindications
function buildPerimeterAndConstraintsSection(sealedRequest: SealedPhotoPreviewRequest): string {
  const lines: string[] = [];
  const perimeter = sealedRequest.spatial.perimeter;

  if (perimeter.state === "placed") {
    const points = perimeter.points.map((p) => `(${p.x.toFixed(2)}, ${p.y.toFixed(2)})`).join(", ");
    lines.push(
      `The professional has marked an approximate perimeter/length boundary using these normalized reference points: ${points}. ` +
        "Use this only as an approximate guide for where the cut length falls -- do not draw a visible line, outline, or hard edge in the output.",
    );
  } else if (perimeter.state === "not_visible") {
    lines.push("The intended perimeter/length boundary is not visible in this photo -- do not infer or invent it.");
  }

  for (const constraint of sealedRequest.preserveContract.mapPreserveConstraints) {
    const sentence = PRESERVE_CONSTRAINT_TYPE_SENTENCES[constraint.type]?.(constraint.zone, constraint.reference);
    if (sentence) lines.push(sentence);
  }

  for (const contraindication of sealedRequest.preserveContract.contraindications) {
    lines.push(`Safety context (background information only, not an instruction to depict): ${contraindication}`);
  }

  if (lines.length === 0) return "";
  return ["BOUNDARY AND ADDITIONAL CONSTRAINTS:", ...lines].join("\n- ");
}

// 7. Explicit prohibition against unrelated changes
function buildProhibitionSection(): string {
  return (
    "EXPLICIT PROHIBITION:\n" +
    "Do not change anything about this person or photo other than what is explicitly described above. " +
    "Do not beautify, retouch, slim, rejuvenate, age, or otherwise alter the face or body. " +
    "Do not add, remove, or alter any other people, objects, or background elements. " +
    "Do not apply an artistic filter or illustration style."
  );
}

function describeQuadrant(x: number, y: number): string {
  const vertical = y < 0.34 ? "upper" : y < 0.67 ? "middle" : "lower";
  const horizontal = x < 0.34 ? "left" : x < 0.67 ? "center" : "right";
  return `${vertical}-${horizontal} area of the photo`;
}
