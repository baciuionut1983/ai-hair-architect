import { randomUUID } from "crypto";

import {
  CreateBucketCommand,
  DeleteBucketCommand,
  S3Client
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

suite("M15 isolated S3-compatible adapter", () => {
  afterEach(async () => {
    if (storage && createdObject) {
      await storage.delete(createdObject).catch(() => undefined);
    }
    if (adminClient && bucket) {
      await adminClient.send(new DeleteBucketCommand({ Bucket: bucket }));
    }
    adminClient?.destroy();
    adminClient = null;
    storage = null;
    bucket = null;
    createdObject = null;
  });

  it("round-trips synthetic bytes and verifies cleanup", async () => {
    const runId = randomUUID();
    bucket = `m15-phase1-${runId}`;
    const config = isolatedConfig(bucket, `m15-phase1/${runId}`);
    adminClient = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      maxAttempts: 1
    });
    await adminClient.send(new CreateBucketCommand({ Bucket: bucket }));
    storage = new S3ObjectStorage(config);

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
});

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