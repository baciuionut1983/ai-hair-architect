import { describe, expect, it } from "vitest";

import {
  defaultEvidenceRoleForSnapshotRole,
  findDuplicateHairStateSnapshotEvidence,
  HAIR_STATE_SNAPSHOT_EVIDENCE_KINDS,
  HAIR_STATE_SNAPSHOT_EVIDENCE_ROLES,
  isEvidenceRoleValidForSnapshotRole,
  isHairStateSnapshotEvidenceKind,
  isHairStateSnapshotEvidenceRole,
  isValidHairStateSnapshotEvidenceInput,
  type HairStateSnapshotEvidenceInput,
} from "@/lib/hair-state-snapshot-evidence-validators";

// Professional Skill Engine, Stage 3 -- VISUAL EVIDENCE BINDING pure
// contract tests. No I/O, mirrors capture-set-validators.test.ts's own
// conventions.

describe("hair-state-snapshot-evidence-validators (pure contract)", () => {
  it("recognizes exactly 2 evidence kinds and 4 evidence roles", () => {
    expect(HAIR_STATE_SNAPSHOT_EVIDENCE_KINDS).toEqual(["IMAGE_ASSET", "CAPTURE_SET"]);
    expect(HAIR_STATE_SNAPSHOT_EVIDENCE_ROLES).toEqual(["PRIMARY_CAPTURE", "TARGET_REFERENCE", "RESULT_OBSERVED", "RESULT_GENERATED_PREVIEW"]);
    for (const kind of HAIR_STATE_SNAPSHOT_EVIDENCE_KINDS) expect(isHairStateSnapshotEvidenceKind(kind)).toBe(true);
    for (const role of HAIR_STATE_SNAPSHOT_EVIDENCE_ROLES) expect(isHairStateSnapshotEvidenceRole(role)).toBe(true);
    expect(isHairStateSnapshotEvidenceKind("VIDEO_ASSET")).toBe(false);
    expect(isHairStateSnapshotEvidenceRole("SOMETHING_ELSE")).toBe(false);
  });

  it("a valid IMAGE_ASSET evidence input (with an optional viewLabel) validates", () => {
    const input: HairStateSnapshotEvidenceInput = { evidenceKind: "IMAGE_ASSET", evidenceRole: "PRIMARY_CAPTURE", imageAssetId: "img-1", viewLabel: "FRONT" };
    expect(isValidHairStateSnapshotEvidenceInput(input)).toBe(true);
  });

  it("a valid CAPTURE_SET evidence input (no viewLabel) validates", () => {
    const input: HairStateSnapshotEvidenceInput = { evidenceKind: "CAPTURE_SET", evidenceRole: "PRIMARY_CAPTURE", captureSetId: "set-1" };
    expect(isValidHairStateSnapshotEvidenceInput(input)).toBe(true);
  });

  it("fails closed: IMAGE_ASSET kind without imageAssetId, or with a captureSetId present", () => {
    expect(isValidHairStateSnapshotEvidenceInput({ evidenceKind: "IMAGE_ASSET", evidenceRole: "PRIMARY_CAPTURE" })).toBe(false);
    expect(isValidHairStateSnapshotEvidenceInput({ evidenceKind: "IMAGE_ASSET", evidenceRole: "PRIMARY_CAPTURE", imageAssetId: "img-1", captureSetId: "set-1" })).toBe(false);
  });

  it("fails closed: CAPTURE_SET kind without captureSetId, or with an imageAssetId present", () => {
    expect(isValidHairStateSnapshotEvidenceInput({ evidenceKind: "CAPTURE_SET", evidenceRole: "PRIMARY_CAPTURE" })).toBe(false);
    expect(isValidHairStateSnapshotEvidenceInput({ evidenceKind: "CAPTURE_SET", evidenceRole: "PRIMARY_CAPTURE", captureSetId: "set-1", imageAssetId: "img-1" })).toBe(false);
  });

  it("fails closed: a CAPTURE_SET evidence row can never carry a viewLabel -- CaptureSetImage already owns that fact", () => {
    expect(isValidHairStateSnapshotEvidenceInput({ evidenceKind: "CAPTURE_SET", evidenceRole: "PRIMARY_CAPTURE", captureSetId: "set-1", viewLabel: "FRONT" })).toBe(false);
  });

  it("fails closed on an invalid viewLabel value -- never coerced", () => {
    expect(isValidHairStateSnapshotEvidenceInput({ evidenceKind: "IMAGE_ASSET", evidenceRole: "PRIMARY_CAPTURE", imageAssetId: "img-1", viewLabel: "TOP" })).toBe(false);
  });

  it("findDuplicateHairStateSnapshotEvidence catches the same evidence entry referenced twice for one snapshot", () => {
    const evidence: HairStateSnapshotEvidenceInput[] = [
      { evidenceKind: "IMAGE_ASSET", evidenceRole: "PRIMARY_CAPTURE", imageAssetId: "img-1" },
      { evidenceKind: "IMAGE_ASSET", evidenceRole: "PRIMARY_CAPTURE", imageAssetId: "img-1" },
    ];
    expect(findDuplicateHairStateSnapshotEvidence(evidence)).toHaveLength(1);
    expect(findDuplicateHairStateSnapshotEvidence([evidence[0]])).toHaveLength(0);
  });

  it("evidenceRole is scoped to the correct snapshot role -- CURRENT/TARGET/RESULT never cross-accept each other's roles", () => {
    expect(isEvidenceRoleValidForSnapshotRole("CURRENT", "PRIMARY_CAPTURE")).toBe(true);
    expect(isEvidenceRoleValidForSnapshotRole("CURRENT", "TARGET_REFERENCE")).toBe(false);
    expect(isEvidenceRoleValidForSnapshotRole("TARGET", "TARGET_REFERENCE")).toBe(true);
    expect(isEvidenceRoleValidForSnapshotRole("TARGET", "RESULT_OBSERVED")).toBe(false);
    expect(isEvidenceRoleValidForSnapshotRole("RESULT", "RESULT_OBSERVED")).toBe(true);
    expect(isEvidenceRoleValidForSnapshotRole("RESULT", "RESULT_GENERATED_PREVIEW")).toBe(true);
    expect(isEvidenceRoleValidForSnapshotRole("RESULT", "PRIMARY_CAPTURE")).toBe(false);
  });

  it("defaultEvidenceRoleForSnapshotRole returns the honest default per role, or null for an unknown role", () => {
    expect(defaultEvidenceRoleForSnapshotRole("CURRENT")).toBe("PRIMARY_CAPTURE");
    expect(defaultEvidenceRoleForSnapshotRole("TARGET")).toBe("TARGET_REFERENCE");
    expect(defaultEvidenceRoleForSnapshotRole("RESULT")).toBe("RESULT_OBSERVED");
    expect(defaultEvidenceRoleForSnapshotRole("BEFORE")).toBeNull();
  });
});
