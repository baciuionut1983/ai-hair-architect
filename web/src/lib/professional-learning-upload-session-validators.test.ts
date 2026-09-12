import { describe, expect, it } from "vitest";

import {
  computeMultipartUploadPlan,
  isLegalUploadSessionTransition,
  isTerminalUploadSessionStatus,
  isUploadSessionMediaKind,
  isUploadSessionPurpose,
  isUploadSessionStatus,
  isValidUploadSessionContentType,
  isValidUploadSessionFileName,
  MAX_MULTIPART_UPLOAD_BYTES,
  MULTIPART_PART_SIZE_BYTES,
  S3_MAX_PART_COUNT,
  UPLOAD_SESSION_MEDIA_KINDS,
  UPLOAD_SESSION_PURPOSES,
  UPLOAD_SESSION_STATUSES,
} from "@/lib/professional-learning-upload-session-validators";

describe("professional-learning-upload-session-validators", () => {
  it("PURPOSE LOCK: exactly one value, PROFESSIONAL_LEARNING", () => {
    expect(UPLOAD_SESSION_PURPOSES).toEqual(["PROFESSIONAL_LEARNING"]);
    expect(isUploadSessionPurpose("PROFESSIONAL_LEARNING")).toBe(true);
    expect(isUploadSessionPurpose("CLIENT_CONTENT")).toBe(false);
    expect(isUploadSessionPurpose("ACADEMY_CONTENT")).toBe(false);
  });

  it("exactly one media kind, VIDEO, today", () => {
    expect(UPLOAD_SESSION_MEDIA_KINDS).toEqual(["VIDEO"]);
    expect(isUploadSessionMediaKind("VIDEO")).toBe(true);
    expect(isUploadSessionMediaKind("IMAGE")).toBe(false);
  });

  it("declares the 7 real lifecycle statuses", () => {
    expect([...UPLOAD_SESSION_STATUSES].sort()).toEqual(
      ["INITIATED", "UPLOADING", "COMPLETING", "COMPLETED", "ABORTED", "EXPIRED", "FAILED"].sort(),
    );
    for (const status of UPLOAD_SESSION_STATUSES) {
      expect(isUploadSessionStatus(status)).toBe(true);
    }
    expect(isUploadSessionStatus("PENDING")).toBe(false);
  });

  it("COMPLETED/ABORTED/EXPIRED/FAILED are terminal; INITIATED/UPLOADING/COMPLETING are not", () => {
    expect(isTerminalUploadSessionStatus("COMPLETED")).toBe(true);
    expect(isTerminalUploadSessionStatus("ABORTED")).toBe(true);
    expect(isTerminalUploadSessionStatus("EXPIRED")).toBe(true);
    expect(isTerminalUploadSessionStatus("FAILED")).toBe(true);
    expect(isTerminalUploadSessionStatus("INITIATED")).toBe(false);
    expect(isTerminalUploadSessionStatus("UPLOADING")).toBe(false);
    expect(isTerminalUploadSessionStatus("COMPLETING")).toBe(false);
  });

  describe("isLegalUploadSessionTransition (state machine)", () => {
    it("allows the happy path", () => {
      expect(isLegalUploadSessionTransition("INITIATED", "UPLOADING")).toBe(true);
      expect(isLegalUploadSessionTransition("UPLOADING", "COMPLETING")).toBe(true);
      expect(isLegalUploadSessionTransition("COMPLETING", "COMPLETED")).toBe(true);
    });

    it("21. allows a recoverable COMPLETING -> FAILED -> COMPLETING retry path", () => {
      expect(isLegalUploadSessionTransition("COMPLETING", "FAILED")).toBe(true);
      expect(isLegalUploadSessionTransition("FAILED", "COMPLETING")).toBe(true);
    });

    it("22. never allows a transition out of a terminal status", () => {
      for (const terminal of ["COMPLETED", "ABORTED", "EXPIRED"] as const) {
        for (const to of UPLOAD_SESSION_STATUSES) {
          expect(isLegalUploadSessionTransition(terminal, to)).toBe(false);
        }
      }
    });

    it("allows abort from every non-terminal status", () => {
      expect(isLegalUploadSessionTransition("INITIATED", "ABORTED")).toBe(true);
      expect(isLegalUploadSessionTransition("UPLOADING", "ABORTED")).toBe(true);
      expect(isLegalUploadSessionTransition("COMPLETING", "ABORTED")).toBe(true);
      expect(isLegalUploadSessionTransition("FAILED", "ABORTED")).toBe(true);
    });
  });

  it("6. reuses the same video MIME allowlist as the L3 buffered path", () => {
    expect(isValidUploadSessionContentType("video/mp4")).toBe(true);
    expect(isValidUploadSessionContentType("video/webm")).toBe(true);
    expect(isValidUploadSessionContentType("video/quicktime")).toBe(true);
    expect(isValidUploadSessionContentType("video/x-msvideo")).toBe(false);
    expect(isValidUploadSessionContentType("image/jpeg")).toBe(false);
  });

  it("15. filename is metadata only -- rejected only for being absent or absurdly long, never sanitized here", () => {
    expect(isValidUploadSessionFileName("demonstration.mp4")).toBe(true);
    expect(isValidUploadSessionFileName("")).toBe(false);
    expect(isValidUploadSessionFileName("a".repeat(256))).toBe(false);
    expect(isValidUploadSessionFileName("a".repeat(255))).toBe(true);
  });

  describe("computeMultipartUploadPlan (Part 8: part size / bounds)", () => {
    it("7. rejects a zero or negative declared size", () => {
      expect(computeMultipartUploadPlan(0)).toBe("EMPTY_FILE");
      expect(computeMultipartUploadPlan(-1)).toBe("EMPTY_FILE");
    });

    it("16. rejects a declared size over the application's own maximum", () => {
      expect(computeMultipartUploadPlan(MAX_MULTIPART_UPLOAD_BYTES + 1)).toBe("FILE_TOO_LARGE");
    });

    it("12/13. computes exactly 1 part for a file smaller than one part", () => {
      const plan = computeMultipartUploadPlan(1024);
      expect(plan).not.toBe("EMPTY_FILE");
      expect(plan).not.toBe("FILE_TOO_LARGE");
      if (typeof plan === "string") throw new Error("unreachable");
      expect(plan.partCount).toBe(1);
      expect(plan.lastPartSizeBytes).toBe(1024);
      expect(plan.partSizeBytes).toBe(MULTIPART_PART_SIZE_BYTES);
    });

    it("computes multiple parts for a file spanning several part boundaries, with a real (possibly small) final part", () => {
      const size = MULTIPART_PART_SIZE_BYTES * 3 + 100;
      const plan = computeMultipartUploadPlan(size);
      if (typeof plan === "string") throw new Error("unreachable");
      expect(plan.partCount).toBe(4);
      expect(plan.lastPartSizeBytes).toBe(100);
    });

    it("14. computes an exact multiple with no dangling zero-byte final part", () => {
      const size = MULTIPART_PART_SIZE_BYTES * 2;
      const plan = computeMultipartUploadPlan(size);
      if (typeof plan === "string") throw new Error("unreachable");
      expect(plan.partCount).toBe(2);
      expect(plan.lastPartSizeBytes).toBe(MULTIPART_PART_SIZE_BYTES);
    });

    it("13. the maximum supported upload size stays comfortably under S3's own 10,000-part hard limit", () => {
      const plan = computeMultipartUploadPlan(MAX_MULTIPART_UPLOAD_BYTES);
      if (typeof plan === "string") throw new Error("unreachable");
      expect(plan.partCount).toBeLessThan(S3_MAX_PART_COUNT);
      // Also comfortably under the unpaginated ListPartsCommand's own
      // 1000-per-page limit (object-storage-s3.ts's own documented
      // assumption).
      expect(plan.partCount).toBeLessThan(1000);
    });
  });
});
