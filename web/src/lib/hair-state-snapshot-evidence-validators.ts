import { isRecord } from "@/lib/technical-visual-map-validators";
import { isCaptureSetViewLabel, type CaptureSetViewLabel } from "@/lib/capture-set-validators";

// AI Hair Architect, Stage 3 -- VISUAL EVIDENCE BINDING, pure domain
// validators. No I/O, no database -- mirrors capture-set-validators.ts's
// own "validators file, separate from repository file" convention.
//
// ARCHITECTURAL LOCK (Stage 3 audit): a HairStateSnapshotEvidence row
// records EXACTLY which real visual evidence supported one snapshot --
// either one ImageAsset, or one whole multi-view CaptureSet. It is never
// a second image-history system: imageAssetId/captureSetId are validated
// soft pointers to already-existing rows (see the repository for the
// existence checks); this file only enforces the STRUCTURAL shape.
//
// evidenceKind and its cardinality: exactly one of imageAssetId/
// captureSetId is populated, matching evidenceKind. viewLabel (reused
// verbatim from capture-set-validators.ts's own CaptureSetViewLabel --
// never re-declared) is only ever meaningful for a standalone IMAGE_ASSET
// evidence row; a CAPTURE_SET row never carries one, because the
// referenced CaptureSet's own CaptureSetImage rows already carry
// per-image view labels -- duplicating that here would be a second,
// competing truth for the exact same fact.
//
// evidenceRole is the honest, role-specific distinction the Stage 3 task
// requires (never one opaque "source"): PRIMARY_CAPTURE (CURRENT's real
// analyzed photo/set), TARGET_REFERENCE (a reference/inspiration image --
// never professional truth on its own), RESULT_OBSERVED (a real after
// photo), RESULT_GENERATED_PREVIEW (AI-generated preview/technical-result
// frame -- never pretended to equal an observed outcome). Whether a given
// evidenceRole is legal for a given snapshot ROLE (CURRENT/TARGET/RESULT)
// is a repository-layer check (it needs the parent snapshot's own role,
// which this pure file has no access to), not enforced here.
//
// WHAT THIS FILE IS NOT:
//   - it does NOT verify imageAssetId/captureSetId actually exist or are
//     owned by the right client -- see hair-state-snapshot-evidence-
//     repository.ts;
//   - it does NOT decide which evidenceRole a given snapshot role permits;
//   - it does NOT introduce a second zone vocabulary or a second
//     view-label vocabulary -- viewLabel here IS CaptureSetViewLabel,
//     imported, never re-declared.

export const HAIR_STATE_SNAPSHOT_EVIDENCE_KINDS = ["IMAGE_ASSET", "CAPTURE_SET"] as const;
export type HairStateSnapshotEvidenceKind = (typeof HAIR_STATE_SNAPSHOT_EVIDENCE_KINDS)[number];

export function isHairStateSnapshotEvidenceKind(value: unknown): value is HairStateSnapshotEvidenceKind {
  return typeof value === "string" && (HAIR_STATE_SNAPSHOT_EVIDENCE_KINDS as readonly string[]).includes(value);
}

export const HAIR_STATE_SNAPSHOT_EVIDENCE_ROLES = ["PRIMARY_CAPTURE", "TARGET_REFERENCE", "RESULT_OBSERVED", "RESULT_GENERATED_PREVIEW"] as const;
export type HairStateSnapshotEvidenceRole = (typeof HAIR_STATE_SNAPSHOT_EVIDENCE_ROLES)[number];

export function isHairStateSnapshotEvidenceRole(value: unknown): value is HairStateSnapshotEvidenceRole {
  return typeof value === "string" && (HAIR_STATE_SNAPSHOT_EVIDENCE_ROLES as readonly string[]).includes(value);
}

// Which snapshot ROLE (CURRENT/TARGET/RESULT) each evidenceRole is legal
// for -- the repository-layer check described above; exported here so it
// is declared exactly once, not re-derived ad hoc at each call site.
const EVIDENCE_ROLE_BY_SNAPSHOT_ROLE: Record<string, readonly HairStateSnapshotEvidenceRole[]> = {
  CURRENT: ["PRIMARY_CAPTURE"],
  TARGET: ["TARGET_REFERENCE"],
  RESULT: ["RESULT_OBSERVED", "RESULT_GENERATED_PREVIEW"],
};

export function isEvidenceRoleValidForSnapshotRole(snapshotRole: string, evidenceRole: HairStateSnapshotEvidenceRole): boolean {
  return (EVIDENCE_ROLE_BY_SNAPSHOT_ROLE[snapshotRole] ?? []).includes(evidenceRole);
}

export function defaultEvidenceRoleForSnapshotRole(snapshotRole: string): HairStateSnapshotEvidenceRole | null {
  switch (snapshotRole) {
    case "CURRENT":
      return "PRIMARY_CAPTURE";
    case "TARGET":
      return "TARGET_REFERENCE";
    case "RESULT":
      return "RESULT_OBSERVED";
    default:
      return null;
  }
}

export interface HairStateSnapshotEvidenceInput {
  evidenceKind: HairStateSnapshotEvidenceKind;
  evidenceRole: HairStateSnapshotEvidenceRole;
  imageAssetId?: string;
  captureSetId?: string;
  viewLabel?: CaptureSetViewLabel;
}

export function isValidHairStateSnapshotEvidenceInput(value: unknown): value is HairStateSnapshotEvidenceInput {
  if (!isRecord(value)) return false;
  if (!isHairStateSnapshotEvidenceKind(value.evidenceKind)) return false;
  if (!isHairStateSnapshotEvidenceRole(value.evidenceRole)) return false;

  const hasImageAssetId = typeof value.imageAssetId === "string" && value.imageAssetId.length > 0;
  const hasCaptureSetId = typeof value.captureSetId === "string" && value.captureSetId.length > 0;

  if (value.evidenceKind === "IMAGE_ASSET") {
    if (!hasImageAssetId || hasCaptureSetId) return false;
  } else {
    // CAPTURE_SET
    if (!hasCaptureSetId || hasImageAssetId) return false;
    // A CaptureSet's own images already carry per-view labels -- a
    // per-row viewLabel here would be a second, competing truth.
    if (value.viewLabel !== undefined) return false;
  }

  if (value.viewLabel !== undefined && !isCaptureSetViewLabel(value.viewLabel)) return false;

  return true;
}

// Fail-closed: two evidence rows for the SAME snapshot both claiming the
// same (evidenceKind, imageAssetId/captureSetId) is a redundant, never
// legitimate, duplicate -- caught before any write, mirroring
// findDuplicateCaptureSetViewLabels's own exact precedent.
export function findDuplicateHairStateSnapshotEvidence(evidence: readonly HairStateSnapshotEvidenceInput[]): readonly HairStateSnapshotEvidenceInput[] {
  const seen = new Set<string>();
  const duplicates: HairStateSnapshotEvidenceInput[] = [];
  for (const entry of evidence) {
    const key = entry.evidenceKind === "IMAGE_ASSET" ? `IMAGE_ASSET:${entry.imageAssetId}` : `CAPTURE_SET:${entry.captureSetId}`;
    if (seen.has(key)) {
      duplicates.push(entry);
    } else {
      seen.add(key);
    }
  }
  return duplicates;
}
