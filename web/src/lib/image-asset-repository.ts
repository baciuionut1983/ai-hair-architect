import type { ClientPhotoRecord } from "@/lib/contracts";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";

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
