import type { ClientPhotoRecord } from "@/lib/contracts";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import { PHOTO_PREVIEW_OUTPUT_ORIGIN } from "@/lib/photo-preview-output-storage";

// Technical Visual Map, Stage 5C -- a source image is "eligible" for spatial
// binding creation only when its normalized dimensions are known (Stage 5B's
// own createDraftSpatialBinding already enforces this server-side; this is
// purely a UI-facing "which images can I even offer" list, computed the same
// way). Deliberately a NEW, separate read -- not an extension of
// listImageAssetPhotosForClient/ClientPhotoRecord above, which back the
// protected client History tab and carry no width/height field; adding one
// there would risk that unrelated, already-shipped feature for no benefit.
//
// Spatial Mapping revisit fix #2 (real production defect): this list must
// never include a real AI Photo Preview's own generated OUTPUT image --
// ImageAsset.origin is the EXISTING, purpose-built structural discriminator
// for exactly this (see photo-preview-output-storage.ts's own header
// comment: "this is what makes it structurally impossible to confuse a
// generated preview with a real client upload later"). Excluding the one
// known-generated value (rather than restricting to the one known-upload
// value) is the deliberate, future-proof direction: ImageAsset.origin's own
// schema comment says a future THIRD origin must never require a
// migration, and any such value would still legitimately belong here
// unless it specifically means "not a real client photo." No filename
// heuristic is used -- a real client photo that happens to be named
// something like "photo-preview-of-new-style.jpg" must never be excluded
// just because of its name; only this real, persisted provenance field
// decides.
export interface EligibleSpatialSourceImage {
  id: string;
  fileName: string;
  width: number;
  height: number;
  uploadedAt: string;
  imageUrl: string;
}

export async function listEligibleSpatialSourceImagesForClient(
  ownerUserId: string,
  clientId: string,
): Promise<EligibleSpatialSourceImage[]> {
  if (!isDatabaseConfigured()) {
    throw new ImageAssetPersistenceError();
  }

  try {
    const rows = await prisma.imageAsset.findMany({
      where: {
        ownerUserId,
        clientId,
        deletedAt: null,
        width: { not: null },
        height: { not: null },
        // Fix #2: never offer a real AI Photo Preview's own generated
        // output image as a Spatial Mapping source -- see this file's own
        // header comment above.
        origin: { not: PHOTO_PREVIEW_OUTPUT_ORIGIN },
      },
      orderBy: [{ uploadedAt: "desc" }, { id: "desc" }],
    });

    return rows.map((row) => ({
      id: row.id,
      fileName: row.fileName,
      // The `where` clause above already guarantees these are non-null;
      // Prisma's own generated type still reports `number | null` for a
      // nullable column regardless of the filter, hence the assertion here
      // rather than a redundant runtime re-check.
      width: row.width as number,
      height: row.height as number,
      uploadedAt: row.uploadedAt.toISOString(),
      imageUrl: `/api/v1/image-assets/${row.id}/content`,
    }));
  } catch (error) {
    if (error instanceof ImageAssetPersistenceError) throw error;
    throw new ImageAssetPersistenceError();
  }
}

export const IMAGE_ASSET_PERSISTENCE_ERROR_CODE = "IMAGE_ASSET_PERSISTENCE_UNAVAILABLE";

export class ImageAssetPersistenceError extends Error {
  readonly code = IMAGE_ASSET_PERSISTENCE_ERROR_CODE;
  readonly httpStatus = 503;

  constructor() {
    super("Image asset data is temporarily unavailable.");
    this.name = "ImageAssetPersistenceError";
  }
}

export function isImageAssetPersistenceError(error: unknown): error is ImageAssetPersistenceError {
  return error instanceof ImageAssetPersistenceError;
}

export function imageAssetPersistenceUnavailableResponse(): Response {
  return Response.json(
    { error: IMAGE_ASSET_PERSISTENCE_ERROR_CODE, message: "Image asset data is temporarily unavailable." },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

// Regression: a client's History tab showed "No photos yet." even for a
// client with a real, correctly-saved photo -- because the photo was
// uploaded through the actual, current upload flow (image-analysis-
// service.ts's uploadAndAnalyzeImages, used by the analysis wizard), which
// writes ImageAsset directly, never ClientPhoto. ClientPhoto (see
// client-photo-repository.ts) is a completely separate model with no
// foreign key to ImageAsset, and the only UI code that ever writes to it
// (POST /api/v1/clients/{id}/photos) is called exclusively from the
// deprecated Milestone3HistoryPanel on /legacy -- unreachable from the
// real client detail page. This surfaces the client's own ImageAsset rows
// as ClientPhotoRecord-shaped entries so the History tab (which already
// renders that exact shape) picks them up with no UI changes at all.
// imageUrl reuses the same authenticated content endpoint
// (/api/v1/image-assets/{id}/content) already used on the Analysis Result
// page (analysis-original-photo-logic.ts's buildOriginalPhotoSrc) -- never
// a storage key/path/bucket. Scoped by (ownerUserId, clientId) directly in
// the query (ImageAsset.clientId has no Prisma relation to Client to
// traverse, unlike ClientPhoto), so an image can never surface under a
// client it doesn't belong to; deletedAt: null excludes anything already
// removed by the retention purge (image-asset-retention.ts).
export async function listImageAssetPhotosForClient(ownerUserId: string, clientId: string): Promise<ClientPhotoRecord[]> {
  if (!isDatabaseConfigured()) {
    throw new ImageAssetPersistenceError();
  }

  try {
    const rows = await prisma.imageAsset.findMany({
      where: { ownerUserId, clientId, deletedAt: null },
      orderBy: [{ uploadedAt: "desc" }, { id: "desc" }],
    });

    return rows.map((row) => ({
      id: row.id,
      clientId: row.clientId,
      imageUrl: `/api/v1/image-assets/${row.id}/content`,
      caption: "",
      createdAt: row.uploadedAt.toISOString(),
    }));
  } catch (error) {
    if (error instanceof ImageAssetPersistenceError) throw error;
    throw new ImageAssetPersistenceError();
  }
}
