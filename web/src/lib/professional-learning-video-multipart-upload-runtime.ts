import { ObjectStorageWriteModeRequiredError, resolveObjectStorageWriteTarget } from "@/lib/image-analysis-service";
import type { MultipartObjectStorage, ObjectMetadata } from "@/lib/object-storage";
import { createMultipartObjectStorageAliasResolver } from "@/lib/object-storage-alias-resolver";
import type { VideoMultipartStorageDependencies } from "@/lib/professional-learning-video-multipart-upload-service";

// AI Hair Architect, Professional Skill Engine Stage 8.5L3.1 -- real
// wiring for the multipart upload orchestration service. Reuses the
// EXACT same durable-storage decision every other upload path in this
// app already goes through (resolveObjectStorageWriteTarget from
// image-analysis-service.ts) -- never a second, competing storage
// resolution path.
//
// STOP CONDITION (Part 2/3): if object storage is not configured for the
// s3 backend (OBJECT_STORAGE_WRITE_MODE != enabled, or a non-s3 backend),
// there is NO safe large-upload strategy available -- the local-disk
// backend has no multipart concept at all. This throws
// ObjectStorageWriteModeRequiredError in that case (the same error every
// other upload path already throws for the identical reason), never a
// silent fallback to buffering large bytes through application memory.
export async function resolveVideoMultipartStorageDependencies(): Promise<VideoMultipartStorageDependencies> {
  const target = resolveObjectStorageWriteTarget();
  if (!target) {
    throw new ObjectStorageWriteModeRequiredError();
  }

  const resolveMultipart = createMultipartObjectStorageAliasResolver();
  const multipart = await resolveMultipart(target.bucketAlias);
  if (!multipart) {
    throw new ObjectStorageWriteModeRequiredError();
  }

  const storage: MultipartObjectStorage & { head(input: { bucketAlias: string; key: string }): Promise<ObjectMetadata> } = {
    createMultipartUpload: (input) => multipart.createMultipartUpload(input),
    presignUploadPart: (input, expiresIn) => multipart.presignUploadPart(input, expiresIn),
    completeMultipartUpload: (input) => multipart.completeMultipartUpload(input),
    abortMultipartUpload: (input) => multipart.abortMultipartUpload(input),
    listParts: (input) => multipart.listParts(input),
    head: (input) => multipart.head({ bucketAlias: input.bucketAlias, key: input.key }),
  };

  return { storage };
}

// Exported so a route can resolve the bucket alias without duplicating
// resolveObjectStorageWriteTarget's own decision -- initiateVideoUploadSession
// needs it before it has a session row to read one from.
export function resolveVideoUploadBucketAlias(): string {
  const target = resolveObjectStorageWriteTarget();
  if (!target) {
    throw new ObjectStorageWriteModeRequiredError();
  }
  return target.bucketAlias;
}
