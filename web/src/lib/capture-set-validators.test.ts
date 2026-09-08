import { describe, expect, it } from "vitest";

import {
  CAPTURE_SET_VIEW_LABELS,
  findDuplicateCaptureSetViewLabels,
  isCaptureSetViewLabel,
  isCompleteCaptureSetViewSet,
  isValidCaptureSetImageInput,
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
