import { randomUUID } from "crypto";

import {
  CreateBucketCommand,
  DeleteBucketCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand
} from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it } from "vitest";

import { buildImageAssetObjectKey, type ObjectIdentity } from "@/lib/object-storage";
import { validateObjectStorageConfig, type S3ObjectStorageConfig } from "@/lib/object-storage-config";
import { S3ObjectStorage } from "@/lib/object-storage-s3";

const endpoint = process.env.OBJECT_STORAGE_ENDPOINT;
const integrationEnabled =
  process.env.M15_OBJECT_STORAGE_INTEGRATION === "isolated" &&
  process.env.OBJECT_STORAGE_BACKEND === "s3" &&
  process.env.OBJECT_STORAGE_SERVER_SIDE_ENCRYPTION === "none" &&
  Boolean(endpoint) &&
  !String(endpoint).toLowerCase().includes("amazonaws.com");
const suite = integrationEnabled ? describe : describe.skip;

let adminClient: S3Client | null = null;
let storage: S3ObjectStorage | null = null;
let bucket: string | null = null;
let createdObject: ObjectIdentity | null = null;
let pendingUpload: { key: string; uploadId: string } | null = null;

suite("M15 isolated S3-compatible adapter", () => {
  afterEach(async () => {
    try {
      // Attempt every cleanup even after an assertion or another cleanup fails.
      const results = await Promise.allSettled([
        ...(storage && pendingUpload ? [storage.abortMultipartUpload(pendingUpload)] : []),
        ...(storage && createdObject ? [storage.delete(createdObject)] : [])
      ]);
      if (adminClient && bucket) {
        await adminClient.send(new DeleteBucketCommand({ Bucket: bucket }));
      }
      for (const result of results) {
        if (result.status === "rejected") throw result.reason;
      }
    } finally {
      adminClient?.destroy();
      adminClient = null;
      storage = null;
      bucket = null;
      createdObject = null;
      pendingUpload = null;
    }
  }, 30_000);

  it("round-trips synthetic bytes and verifies cleanup", async () => {
    const { adapter: storage } = await createIsolatedStorage();

    const body = new Uint8Array([77, 49, 53]);
    const reference = await storage.put({
      key: buildImageAssetObjectKey(randomUUID(), randomUUID()),
      body,
      contentType: "application/octet-stream",
      contentSha256: "b".repeat(64)
    });
    createdObject = reference;

    await expect(storage.head(reference)).resolves.toMatchObject({
      sizeBytes: body.byteLength,
      contentSha256: "b".repeat(64)
    });
    const downloaded = await storage.get(reference);
    await expect(readAll(downloaded.body)).resolves.toEqual(body);

    await storage.delete(reference);
    createdObject = null;
    await expect(storage.head(reference)).rejects.toMatchObject({ code: "not_found" });
  });

  it("IfNoneMatch creates an absent key, rejects overwrite with 412 PreconditionFailed, and preserves bytes", async () => {
    const { adapter, client, config } = await createIsolatedStorage();
    const key = "conditional-original";
    createdObject = { bucketAlias: config.bucketAlias, key: `${config.prefix}/${key}` };
    const original = new Uint8Array([11, 22, 33, 44]);
    // The production adapter sends IfNoneMatch: "*" on this fresh key.
    await adapter.put({ key, body: original, contentType: "application/octet-stream", contentSha256: "c".repeat(64) });
    // Use the real SDK to inspect provider status/name before the unchanged
    // application classifier maps this error to provider_unavailable.
    await expect(client.send(new PutObjectCommand({
      Bucket: config.bucket, Key: createdObject.key,
      Body: new Uint8Array([99]), IfNoneMatch: "*"
    }))).rejects.toMatchObject({ name: "PreconditionFailed", $metadata: { httpStatusCode: 412 } });
    await expect(adapter.put({ key, body: new Uint8Array([88]), contentType: "application/octet-stream", contentSha256: "d".repeat(64) }))
      .rejects.toMatchObject({ code: "provider_unavailable" });
    const downloaded = await adapter.get(createdObject);
    await expect(readAll(downloaded.body)).resolves.toEqual(original);
  }, 30_000);

  it("completes real multipart direct and presigned HTTP uploads with exact final bytes", async () => {
    const { adapter, client, config } = await createIsolatedStorage();
    const key = "multipart-complete";
    createdObject = { bucketAlias: config.bucketAlias, key: `${config.prefix}/${key}` };
    const upload = await adapter.createMultipartUpload({ key, contentType: "application/octet-stream" });
    pendingUpload = upload;
    // S3 requires every nonfinal part to contain at least 5 MiB.
    const first = new Uint8Array(5 * 1024 * 1024).fill(41);
    const last = new Uint8Array([42, 43, 44, 45]);
    const direct = await client.send(new UploadPartCommand({
      Bucket: config.bucket, Key: upload.key, UploadId: upload.uploadId, PartNumber: 1, Body: first
    }));
    expect(direct.ETag).toBeTruthy();
    const url = await adapter.presignUploadPart({ ...upload, partNumber: 2 }, 60);
    expect(new URL(url).origin).toBe(new URL(config.endpoint!).origin);
    const response = await fetch(url, { method: "PUT", body: last, signal: AbortSignal.timeout(10_000), redirect: "error" });
    await response.arrayBuffer();
    expect(response.status).toBe(200);
    const etag = response.headers.get("etag");
    expect(etag).toBeTruthy();
    const parts = [{ partNumber: 1, etag: direct.ETag! }, { partNumber: 2, etag: etag! }];
    await expect(adapter.listParts(upload)).resolves.toEqual(parts);
    const completed = await adapter.completeMultipartUpload({ ...upload, parts });
    pendingUpload = null;
    expect(completed.etag).toBeTruthy();
    await expect(adapter.head(completed)).resolves.toMatchObject({ sizeBytes: first.length + last.length });
    const downloaded = await adapter.get(completed);
    const actual = await readAll(downloaded.body);
    const expected = new Uint8Array(first.length + last.length);
    expected.set(first);
    expected.set(last, first.length);
    // Byte equality without a multi-megabyte assertion diff on failure.
    expect(actual.byteLength).toBe(expected.byteLength);
    expect(Buffer.from(actual).equals(Buffer.from(expected))).toBe(true);
  }, 30_000);

  it("aborts a real multipart upload and rejects subsequent ListParts with 404 NoSuchUpload", async () => {
    const { adapter, client, config } = await createIsolatedStorage();
    const key = "multipart-abort";
    createdObject = { bucketAlias: config.bucketAlias, key: `${config.prefix}/${key}` };
    const upload = await adapter.createMultipartUpload({ key, contentType: "application/octet-stream" });
    pendingUpload = upload;
    const part = await client.send(new UploadPartCommand({
      Bucket: config.bucket, Key: upload.key, UploadId: upload.uploadId, PartNumber: 1, Body: new Uint8Array([7, 8, 9])
    }));
    expect(part.ETag).toBeTruthy();
    await expect(adapter.listParts(upload)).resolves.toEqual([{ partNumber: 1, etag: part.ETag }]);
    await adapter.abortMultipartUpload(upload);
    pendingUpload = null;
    await expect(client.send(new ListPartsCommand({
      Bucket: config.bucket, Key: upload.key, UploadId: upload.uploadId
    }))).rejects.toMatchObject({ name: "NoSuchUpload", $metadata: { httpStatusCode: 404 } });
    await expect(adapter.head(createdObject)).rejects.toMatchObject({ code: "not_found" });
  }, 30_000);
});

async function createIsolatedStorage() {
  const runId = randomUUID();
  const config = isolatedConfig(`m15-phase1-${runId}`, `m15-phase1/${runId}`);
  const client = new S3Client({
    region: config.region, endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle, maxAttempts: 1,
    requestHandler: { connectionTimeout: 3000, requestTimeout: 10_000 }
  });
  adminClient = client;
  await client.send(new CreateBucketCommand({ Bucket: config.bucket }));
  bucket = config.bucket;
  // A real SDK client shared with the adapter so teardown closes its sockets.
  const adapter = new S3ObjectStorage(config, () => client);
  storage = adapter;
  return { adapter, client, config };
}

function isolatedConfig(syntheticBucket: string, syntheticPrefix: string): S3ObjectStorageConfig {
  const validation = validateObjectStorageConfig(process.env, "test");
  if (!validation.ok || validation.config?.backend !== "s3" || !validation.config.endpoint) {
    throw new Error("Explicit isolated object storage configuration is incomplete.");
  }
  return {
    ...validation.config,
    bucketAlias: `m15-phase1-${randomUUID()}`,
    bucket: syntheticBucket,
    prefix: syntheticPrefix
  };
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
