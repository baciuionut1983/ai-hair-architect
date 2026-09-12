import { describe, expect, it } from "vitest";

import {
  CAPTURE_SET_PURPOSES,
  CAPTURE_SET_VIEW_LABELS,
  findDuplicateCaptureSetViewLabels,
  isAnatomicalViewLabelMeaningful,
  isCaptureSetPurpose,
  isCaptureSetViewLabel,
  isCompleteCaptureSetViewSet,
  isValidCaptureSetImageInput,
  MAX_PROFESSIONAL_LEARNING_SET_IMAGES,
  missingCaptureSetViews,
} from "@/lib/capture-set-validators";

describe("capture-set-validators (pure domain layer)", () => {
  it("recognizes exactly FRONT/LEFT/BACK/RIGHT, nothing else", () => {
    expect(CAPTURE_SET_VIEW_LABELS).toEqual(["FRONT", "LEFT", "BACK", "RIGHT"]);
    for (const label of CAPTURE_SET_VIEW_LABELS) {
      expect(isCaptureSetViewLabel(label)).toBe(true);
    }
    for (const forbidden of ["DETAIL", "CLOSE_UP", "OTHER", "front", "left_profile", "TOP", ""]) {
      expect(isCaptureSetViewLabel(forbidden)).toBe(false);
    }
  });

  it("validates a well-formed image input, rejects a malformed one", () => {
    expect(isValidCaptureSetImageInput({ viewLabel: "FRONT", imageAssetId: "asset-1" })).toBe(true);
    expect(isValidCaptureSetImageInput({ viewLabel: "FRONT", imageAssetId: "" })).toBe(false);
    expect(isValidCaptureSetImageInput({ viewLabel: "TOP", imageAssetId: "asset-1" })).toBe(false);
    expect(isValidCaptureSetImageInput(null)).toBe(false);
    expect(isValidCaptureSetImageInput("FRONT")).toBe(false);
  });

  // Stage 8.5L3.1 -- SEMANTIC CLEANUP
  it("38. accepts an optional, positive-integer ordinalPosition; rejects a zero/negative/non-integer one", () => {
    expect(isValidCaptureSetImageInput({ viewLabel: "FRONT", imageAssetId: "a", ordinalPosition: 1 })).toBe(true);
    expect(isValidCaptureSetImageInput({ viewLabel: "FRONT", imageAssetId: "a" })).toBe(true);
    expect(isValidCaptureSetImageInput({ viewLabel: "FRONT", imageAssetId: "a", ordinalPosition: 0 })).toBe(false);
    expect(isValidCaptureSetImageInput({ viewLabel: "FRONT", imageAssetId: "a", ordinalPosition: -1 })).toBe(false);
    expect(isValidCaptureSetImageInput({ viewLabel: "FRONT", imageAssetId: "a", ordinalPosition: 1.5 })).toBe(false);
  });

  it("recognizes exactly CLIENT_MULTIVIEW and PROFESSIONAL_LEARNING_SET as CaptureSet purposes", () => {
    expect([...CAPTURE_SET_PURPOSES].sort()).toEqual(["CLIENT_MULTIVIEW", "PROFESSIONAL_LEARNING_SET"]);
    expect(isCaptureSetPurpose("CLIENT_MULTIVIEW")).toBe(true);
    expect(isCaptureSetPurpose("PROFESSIONAL_LEARNING_SET")).toBe(true);
    expect(isCaptureSetPurpose("ACADEMY_CONTENT")).toBe(false);
  });

  it("39/41. only CLIENT_MULTIVIEW carries real anatomical viewLabel meaning", () => {
    expect(isAnatomicalViewLabelMeaningful("CLIENT_MULTIVIEW")).toBe(true);
    expect(isAnatomicalViewLabelMeaningful("PROFESSIONAL_LEARNING_SET")).toBe(false);
  });

  it("42. the learning-set image cap equals the existing 4-label bound, not an invented number", () => {
    expect(MAX_PROFESSIONAL_LEARNING_SET_IMAGES).toBe(CAPTURE_SET_VIEW_LABELS.length);
    expect(MAX_PROFESSIONAL_LEARNING_SET_IMAGES).toBe(4);
  });

  it("finds duplicate view labels within one candidate list", () => {
    const images = [
      { viewLabel: "FRONT" as const, imageAssetId: "a" },
      { viewLabel: "BACK" as const, imageAssetId: "b" },
      { viewLabel: "FRONT" as const, imageAssetId: "c" },
    ];
    expect(findDuplicateCaptureSetViewLabels(images)).toEqual(["FRONT"]);
    expect(findDuplicateCaptureSetViewLabels([{ viewLabel: "FRONT", imageAssetId: "a" }])).toEqual([]);
  });

  it("detects completeness structurally, never a visual quality judgment", () => {
    expect(isCompleteCaptureSetViewSet(["FRONT", "LEFT", "BACK", "RIGHT"])).toBe(true);
    expect(isCompleteCaptureSetViewSet(["FRONT", "LEFT", "BACK"])).toBe(false);
    expect([...missingCaptureSetViews(["FRONT", "BACK"])].sort()).toEqual(["LEFT", "RIGHT"]);
    expect(missingCaptureSetViews(["FRONT", "LEFT", "BACK", "RIGHT"])).toEqual([]);
  });

  it("the module exports no consent, quality, or provider concept", async () => {
    const validatorsModule = await import("@/lib/capture-set-validators");
    const exported = Object.keys(validatorsModule).join(" ").toLowerCase();
    for (const forbidden of ["consent", "quality", "qualif", "provider", "veo", "gemini"]) {
      expect(exported.includes(forbidden)).toBe(false);
    }
  });
});
