// Sub-milestone 1 (AI Visual Analysis): pure src-construction logic, kept
// separate from the rendering component so it is unit-testable without a
// rendering environment (no .test.tsx convention exists in this repo).
// Deliberately only ever builds a path to the existing authenticated
// GET /api/v1/image-assets/{id}/content endpoint -- never a storage
// key/path/bucket or a signed/public URL.
export function buildOriginalPhotoSrc(imageAssetId: string | null | undefined): string | null {
  if (!imageAssetId) {
    return null;
  }

  return `/api/v1/image-assets/${imageAssetId}/content`;
}
