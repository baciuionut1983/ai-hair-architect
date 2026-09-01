import { Readable } from "stream";

import { NextResponse } from "next/server";

import { ConfinedImageStorageError, createConfinedImageReadStream } from "@/lib/image-storage";
import { toExactObjectReference } from "@/lib/object-storage";
import { ObjectStorageError } from "@/lib/object-storage-errors";
import { createObjectStorageAliasResolver } from "@/lib/object-storage-alias-resolver";
import { prisma } from "@/lib/prisma";
import { authenticateSessionRequest } from "@/lib/session-request-auth";
import { extensionForMimeType } from "@/lib/video-asset-storage";
import { VideoAssetStorageRepository } from "@/lib/video-asset-storage-repository";

// Video UI, Result Visualization -- the durable content-serving route a
// completed Video's player actually points at (task §10: "Folosește
// VideoAsset-ul durabil al aplicației. Nu expune provider URL temporar").
// A near-verbatim mirror of image-assets/[id]/content's own proven
// dual-backend (S3 / legacy-local) serving logic -- reused, not
// reinvented, down to the exact integrity/error-classification shape.
// Genuinely simpler than the image route in one respect: VideoAsset has no
// deletedAt or storageState column yet (Stage 3's own delete/cleanup audit
// found no Video-specific deletion mechanism exists at all) -- every
// VideoAsset row that exists (past its brief `storagePath: "pending"`
// creation window) is servable by construction.
//
// Session-authenticated (authenticateSessionRequest, the same mechanism
// every other Video route already uses) -- deliberately NOT
// resolvePipelineAuth, which is a narrowly-scoped dual-credential
// mechanism for the image-upload/analysis pipeline's own 7 routes, not a
// general precedent.
//
// No HTTP Range support (matches the image route's own precedent exactly)
// -- acceptable for V1 given Veo generations are ~6 real seconds long
// (VEO_VIDEO_DEMONSTRATION_REQUESTED_DURATION_SECONDS), so the whole file
// is small; the browser buffers it fully and scrubs freely within it. A
// genuine gap if longer videos are ever generated -- see this stage's own
// completion report.

const INCONSISTENT_STATE_CODES = new Set(["configuration", "missing_version", "invalid_state"]);

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const sessionUser = await authenticateSessionRequest();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Owner-scoped in the query itself -- another owner's asset is never
  // fetched, so it is indistinguishable from a genuinely absent one.
  const asset = await prisma.videoAsset.findFirst({ where: { id, ownerUserId: sessionUser.id } });
  if (!asset) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (asset.storageBackend === null || asset.storageBackend === undefined) {
    return serveLegacyLocal(asset);
  }

  if (asset.storageBackend === "s3") {
    return serveObjectBacked(sessionUser.id, id, asset);
  }

  return NextResponse.json({ error: "Asset storage is not available." }, { status: 409 });
}

async function serveLegacyLocal(asset: { storagePath: string; mimeType: string; sizeBytes: number; id: string }): Promise<NextResponse> {
  if (asset.storagePath === "pending") {
    return NextResponse.json({ error: "Asset storage is not available." }, { status: 409 });
  }

  try {
    const { stream, sizeBytes } = await createConfinedImageReadStream(asset.storagePath);
    const webStream = Readable.toWeb(stream) as unknown as ReadableStream;
    return new NextResponse(webStream, { status: 200, headers: buildHeaders(asset, sizeBytes) });
  } catch (error) {
    if (error instanceof ConfinedImageStorageError) {
      return NextResponse.json({ error: "Asset storage is not available." }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to read video." }, { status: 500 });
  }
}

async function serveObjectBacked(
  ownerUserId: string,
  assetId: string,
  asset: { mimeType: string; sizeBytes: number; id: string },
): Promise<NextResponse> {
  try {
    const repository = new VideoAssetStorageRepository(prisma);
    const reference = await repository.findObjectReferenceByOwner(ownerUserId, assetId);
    if (!reference) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Never requests "latest": throws unless a complete, exact object
    // version is present on the persisted reference.
    const exact = toExactObjectReference(reference);

    const resolveObjectStorage = createObjectStorageAliasResolver();
    const storage = await resolveObjectStorage(exact.bucketAlias);
    if (!storage) {
      return NextResponse.json({ error: "Object storage is unavailable." }, { status: 500 });
    }

    const stored = await storage.get({ bucketAlias: exact.bucketAlias, key: exact.key, versionId: exact.versionId });

    return new NextResponse(stored.body, { status: 200, headers: buildHeaders(asset, stored.sizeBytes) });
  } catch (error) {
    if (error instanceof ObjectStorageError) {
      const status = INCONSISTENT_STATE_CODES.has(error.code) ? 409 : 500;
      return NextResponse.json({ error: error.message }, { status });
    }
    if (error instanceof TypeError) {
      // toExactObjectReference() throws a plain TypeError for an incomplete reference.
      return NextResponse.json({ error: "Asset storage is not available." }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to read video." }, { status: 500 });
  }
}

function buildHeaders(asset: { mimeType: string; id: string }, verifiedSizeBytes: number): HeadersInit {
  const fileName = `video-demonstration-${asset.id}.${extensionForMimeType(asset.mimeType)}`;
  const headers: Record<string, string> = {
    "Content-Type": asset.mimeType,
    "Content-Disposition": `inline; filename="${fileName}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };

  if (Number.isSafeInteger(verifiedSizeBytes) && verifiedSizeBytes >= 0) {
    headers["Content-Length"] = String(verifiedSizeBytes);
  }

  return headers;
}
