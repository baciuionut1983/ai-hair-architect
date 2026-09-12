import { describe, expect, it } from "vitest";

import {
  buildLearningEvidenceImageFormData,
  buildLearningEvidenceImageSetFormData,
  buildLearningEvidenceVideoFormData,
  CLIENT_MAX_LEARNING_VIDEO_BYTES,
  generateLearningEvidenceSubmissionId,
  isForbiddenLearningClaim,
  isVideoFileWithinClientSizeLimit,
  LEARNING_EVIDENCE_STATUS_TEXT,
} from "@/components/consultation/teach-ai-learning-evidence-logic";

function fakeFile(name: string, type: string, sizeBytes: number): File {
  return new File([new Uint8Array(Math.min(sizeBytes, 16))], name, { type });
}

describe("generateLearningEvidenceSubmissionId", () => {
  it("produces a non-empty, distinct id each call", () => {
    const a = generateLearningEvidenceSubmissionId();
    const b = generateLearningEvidenceSubmissionId();
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });
});

describe("buildLearningEvidenceImageFormData", () => {
  it("carries the file, submissionId, and optional evidenceType/title/vertical", () => {
    const file = fakeFile("diagram.png", "image/png", 100);
    const form = buildLearningEvidenceImageFormData(file, { submissionId: "sub-1", title: "Layer diagram", vertical: "hair_cutting" }, "DIAGRAM");

    expect(form.get("file")).toBe(file);
    expect(form.get("submissionId")).toBe("sub-1");
    expect(form.get("evidenceType")).toBe("DIAGRAM");
    expect(form.get("title")).toBe("Layer diagram");
    expect(form.get("vertical")).toBe("hair_cutting");
  });

  it("omits evidenceType when not provided (defaults to IMAGE server-side)", () => {
    const form = buildLearningEvidenceImageFormData(fakeFile("photo.jpg", "image/jpeg", 100), { submissionId: "sub-2" });
    expect(form.get("evidenceType")).toBeNull();
  });
});

describe("buildLearningEvidenceImageSetFormData", () => {
  it("appends every file under the same 'files' key, preserving order", () => {
    const files = [fakeFile("a.jpg", "image/jpeg", 10), fakeFile("b.jpg", "image/jpeg", 10), fakeFile("c.jpg", "image/jpeg", 10)];
    const form = buildLearningEvidenceImageSetFormData(files, { submissionId: "sub-3" });

    const appended = form.getAll("files");
    expect(appended).toHaveLength(3);
    expect(appended).toEqual(files);
  });
});

describe("buildLearningEvidenceVideoFormData", () => {
  it("carries the file and submissionId", () => {
    const file = fakeFile("demo.mp4", "video/mp4", 100);
    const form = buildLearningEvidenceVideoFormData(file, { submissionId: "sub-4" });
    expect(form.get("file")).toBe(file);
    expect(form.get("submissionId")).toBe("sub-4");
  });
});

describe("isVideoFileWithinClientSizeLimit", () => {
  it("accepts a file at or under the limit", () => {
    expect(isVideoFileWithinClientSizeLimit({ size: CLIENT_MAX_LEARNING_VIDEO_BYTES })).toBe(true);
    expect(isVideoFileWithinClientSizeLimit({ size: 1024 })).toBe(true);
  });

  it("rejects a file over the limit -- task Part 27: never buffer an obviously oversized file", () => {
    expect(isVideoFileWithinClientSizeLimit({ size: CLIENT_MAX_LEARNING_VIDEO_BYTES + 1 })).toBe(false);
  });
});

describe("isForbiddenLearningClaim (task Part 22/45 audit)", () => {
  it("flags language claiming the system learned/understood/mastered something", () => {
    expect(isForbiddenLearningClaim("I learned this technique")).toBe(true);
    expect(isForbiddenLearningClaim("Added to my professional knowledge")).toBe(true);
    expect(isForbiddenLearningClaim("Skill learned")).toBe(true);
  });

  it("does not flag honest ingestion-only language", () => {
    expect(isForbiddenLearningClaim(LEARNING_EVIDENCE_STATUS_TEXT.savedText)).toBe(false);
    expect(isForbiddenLearningClaim(LEARNING_EVIDENCE_STATUS_TEXT.uploadedImage)).toBe(false);
    expect(isForbiddenLearningClaim(LEARNING_EVIDENCE_STATUS_TEXT.uploadedImageSet)).toBe(false);
    expect(isForbiddenLearningClaim(LEARNING_EVIDENCE_STATUS_TEXT.uploadedVideo)).toBe(false);
    expect(isForbiddenLearningClaim(LEARNING_EVIDENCE_STATUS_TEXT.revoked)).toBe(false);
  });

  it("every defined status string passes the forbidden-claim audit", () => {
    for (const text of Object.values(LEARNING_EVIDENCE_STATUS_TEXT)) {
      expect(isForbiddenLearningClaim(text)).toBe(false);
    }
  });
});
