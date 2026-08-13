import { describe, expect, it } from "vitest";

import { buildOriginalPhotoSrc } from "./analysis-original-photo-logic";

describe("buildOriginalPhotoSrc", () => {
  it("builds the existing authenticated content endpoint path for a real imageAssetId", () => {
    expect(buildOriginalPhotoSrc("asset-123")).toBe("/api/v1/image-assets/asset-123/content");
  });

  it("returns null for a null imageAssetId (manual analysis with no photo)", () => {
    expect(buildOriginalPhotoSrc(null)).toBeNull();
  });

  it("returns null for an undefined imageAssetId", () => {
    expect(buildOriginalPhotoSrc(undefined)).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(buildOriginalPhotoSrc("")).toBeNull();
  });

  it("never includes a storage key, bucket, or any query string -- only the asset id in the path", () => {
    const src = buildOriginalPhotoSrc("asset-123");
    expect(src).not.toContain("?");
    expect(src).not.toContain("bucket");
    expect(src).not.toContain("storageKey");
  });
});
