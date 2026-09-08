// AI Hair Architect, Stage 2.5.i.21b -- CAPTURE SET, pure domain
// validators. No I/O, no database, no provider call -- mirrors this
// repo's own established "validators file, separate from repository
// file" convention (technical-visual-map-validators.ts /
// technical-visual-map-repository.ts).
//
// ARCHITECTURAL LOCK (Stage 2.5.i.21a audit): a Capture Set groups up to
// one ImageAsset per semantic view (FRONT/LEFT/BACK/RIGHT) captured
// together for one client -- it creates NO new image storage, NO
// duplication of ImageAsset bytes/metadata, and NO provider/consent
// authority of its own. It is internal client visual-history
// infrastructure only, structurally separate from Stage 2.5.i.20's
// external-provider consent gate (Stage 2.5.i.21a's own "internal reuse
// != external provider consent" boundary, Section 7/11).
//
// INDEPENDENTLY DECLARED VOCABULARY, not a reuse of Technical Visual
// Map's own ViewLabel (technical-visual-map-spatial-validators.ts) --
// deliberately, for two independent reasons: (1) the actual value sets
// differ (ViewLabel: front/left_profile/right_profile/back/other, 5
// lowercase snake_case values; Capture Set: FRONT/LEFT/BACK/RIGHT, 4
// uppercase values, no "profile" suffix, no "other") -- reusing the type
// would be actively wrong, not just architecturally coupled; (2) even
// where values coincide it would create a structural dependency from
// this general-purpose, cross-vertical client infrastructure onto the
// Technical Visual Map/Spatial Map domain, mirroring the exact reasoning
// professional-skill-viewpoint-constraint-contracts.ts already used to
// justify never importing ViewLabel (Stage 2.5.i.12).
//
// ONLY FOUR VIEWS TODAY -- deliberately, per this stage's own explicit
// instruction: no DETAIL/CLOSE_UP/OTHER/vertical-specific view is
// introduced here. Growing this vocabulary is deferred until real
// product content justifies it.
//
// WHAT THIS FILE IS NOT (Stage 2.5.i.21b's own explicit boundary):
//   - it contains ZERO consent/authorization concept -- Stage 2.5.i.20's
//     external-provider consent gate is never created, persisted, or
//     inferred here;
//   - it contains ZERO image-quality/blur/visibility judgment -- only a
//     structural "is every view present" completeness check, never a
//     visual-content judgment;
//   - it does NOT read or write a database -- see
//     capture-set-repository.ts for that;
//   - it does NOT select or propose an image on the caller's behalf.

export const CAPTURE_SET_VIEW_LABELS = ["FRONT", "LEFT", "BACK", "RIGHT"] as const;
export type CaptureSetViewLabel = (typeof CAPTURE_SET_VIEW_LABELS)[number];

export function isCaptureSetViewLabel(value: unknown): value is CaptureSetViewLabel {
  return typeof value === "string" && (CAPTURE_SET_VIEW_LABELS as readonly string[]).includes(value);
}

export interface CaptureSetImageInput {
  viewLabel: CaptureSetViewLabel;
  imageAssetId: string;
}

export function isValidCaptureSetImageInput(value: unknown): value is CaptureSetImageInput {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (!isCaptureSetViewLabel(record.viewLabel)) return false;
  if (typeof record.imageAssetId !== "string" || record.imageAssetId.length === 0) return false;
  return true;
}

// Fail-closed: identifies any view label appearing more than once within
// ONE candidate list -- the DB-level unique constraint
// (captureSetId, viewLabel) is the final backstop; this is the earlier,
// friendlier domain-level check a repository function can reject on
// before ever attempting a write.
export function findDuplicateCaptureSetViewLabels(images: readonly CaptureSetImageInput[]): readonly CaptureSetViewLabel[] {
  const seen = new Set<CaptureSetViewLabel>();
  const duplicates = new Set<CaptureSetViewLabel>();
  for (const image of images) {
    if (seen.has(image.viewLabel)) {
      duplicates.add(image.viewLabel);
    } else {
      seen.add(image.viewLabel);
    }
  }
  return [...duplicates];
}

// A "complete" set has exactly one image for every real view -- a pure
// structural completeness check, never a visibility/blur/obstruction
// judgment (Stage 2.5.i.20's own quality-gate boundary stays entirely
// outside this file, per Stage 2.5.i.21b's own explicit non-goal list).
export function isCompleteCaptureSetViewSet(viewLabels: readonly CaptureSetViewLabel[]): boolean {
  const present = new Set(viewLabels);
  return CAPTURE_SET_VIEW_LABELS.every((label) => present.has(label));
}

export function missingCaptureSetViews(viewLabels: readonly CaptureSetViewLabel[]): readonly CaptureSetViewLabel[] {
  const present = new Set(viewLabels);
  return CAPTURE_SET_VIEW_LABELS.filter((label) => !present.has(label));
}
