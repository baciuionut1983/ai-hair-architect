import fs from "fs";
import path from "path";
import { Readable } from "stream";

import type {
  BackupM15V2LegacyLocalReferenceIdentity,
  BackupM15V2LegacyLocalReferenceResolver,
  BackupM15V2ObjectBackedReferenceIdentity,
  BackupM15V2ObjectBackedReferenceResolver,
  BackupM15V2ResolvedLegacyLocalReferenceSource,
  BackupM15V2ResolvedObjectBackedReferenceSource,
} from "./backup-m15-v2-external-reference-verifier";
import type { ObjectIdentity, ObjectStorage } from "./object-storage";
import { classifyObjectStorageError, ObjectStorageError } from "./object-storage-errors";

// A literal backslash in a path segment is rejected outright: on Windows, fs path
// functions treat both "/" and "\" as separators, so a segment smuggling a backslash
// could otherwise be reinterpreted as an extra path component after being split on "/".
const FORBIDDEN_SEGMENT_CHARACTER_PATTERN = /\\/;

export interface CreateLegacyLocalReferenceResolverOptions {
  readonly rootDir?: string;
}

export function createLegacyLocalReferenceResolver(
  options: CreateLegacyLocalReferenceResolverOptions = {},
): BackupM15V2LegacyLocalReferenceResolver {
  const rootDir = options.rootDir ?? path.join(process.cwd(), ".storage", "images");

  return {
    resolveLegacyLocalReference: async (
      identity: BackupM15V2LegacyLocalReferenceIdentity,
    ): Promise<BackupM15V2ResolvedLegacyLocalReferenceSource | null> => {
      if (identity.rootAlias !== "legacy-images") return null;

      const confinedPath = await resolveConfinedLegacyPath(rootDir, identity.relativePath);
      if (confinedPath === null) return null;

      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(confinedPath);
      } catch (error) {
        if (isErrnoCode(error, "ENOENT") || isErrnoCode(error, "ENOTDIR")) return null;
        throw new Error("The legacy local reference could not be read.");
      }
      if (!stat.isFile()) return null;

      return {
        rootAlias: "legacy-images",
        relativePath: identity.relativePath,
        sizeBytes: stat.size,
        // Reading is confined to the already-resolved, already-realpath-checked path above.
        // A TOCTOU window remains between that check and this stream open (e.g. a symlink
        // swapped in immediately before the read); no portable Node API closes it atomically
        // across platforms, so this is the strictest confinement achievable here.
        openStream: () => Readable.toWeb(fs.createReadStream(confinedPath)) as ReadableStream<Uint8Array>,
      };
    },
  };
}

async function resolveConfinedLegacyPath(rootDir: string, relativePath: string): Promise<string | null> {
  if (typeof relativePath !== "string" || relativePath.length === 0) return null;
  const segments = relativePath.split("/");
  for (const segment of segments) {
    if (
      !segment ||
      segment === "." ||
      segment === ".." ||
      FORBIDDEN_SEGMENT_CHARACTER_PATTERN.test(segment) ||
      path.isAbsolute(segment)
    ) {
      return null;
    }
  }

  const resolvedRoot = path.resolve(rootDir);
  const resolvedTarget = path.resolve(resolvedRoot, ...segments);
  if (!isConfined(resolvedRoot, resolvedTarget)) return null;

  let realRoot: string;
  try {
    realRoot = await fs.promises.realpath(resolvedRoot);
  } catch {
    return null;
  }

  let realTarget: string;
  try {
    realTarget = await fs.promises.realpath(resolvedTarget);
  } catch (error) {
    if (isErrnoCode(error, "ENOENT") || isErrnoCode(error, "ENOTDIR")) return null;
    throw new Error("The legacy local reference could not be resolved.");
  }
  if (!isConfined(realRoot, realTarget)) return null;

  return realTarget;
}

function isConfined(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isErrnoCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === code;
}

export interface CreateObjectBackedReferenceResolverOptions {
  readonly resolveObjectStorage: (bucketAlias: string) => Promise<ObjectStorage | null> | ObjectStorage | null;
}

export function createObjectBackedReferenceResolver(
  options: CreateObjectBackedReferenceResolverOptions,
): BackupM15V2ObjectBackedReferenceResolver {
  return {
    resolveObjectBackedReference: async (
      identity: BackupM15V2ObjectBackedReferenceIdentity,
    ): Promise<BackupM15V2ResolvedObjectBackedReferenceSource | null> => {
      let storage: ObjectStorage | null;
      try {
        storage = await options.resolveObjectStorage(identity.bucketAlias);
      } catch {
        throw new Error("Object storage could not be resolved.");
      }
      if (!storage) return null;

      const objectIdentity: ObjectIdentity = {
        bucketAlias: identity.bucketAlias,
        key: identity.key,
        versionId: identity.versionId,
      };

      let metadata;
      try {
        metadata = await storage.head(objectIdentity);
      } catch (error) {
        const classified = classifyObjectStorageError(error);
        if (classified.code === "not_found" || classified.code === "missing_version") return null;
        throw classified;
      }

      if (
        typeof metadata.bucketAlias !== "string" ||
        typeof metadata.key !== "string" ||
        typeof metadata.versionId !== "string" ||
        !metadata.versionId ||
        !Number.isSafeInteger(metadata.sizeBytes) ||
        metadata.sizeBytes <= 0
      ) {
        throw new Error("Object storage metadata is invalid.");
      }

      return {
        bucketAlias: metadata.bucketAlias,
        key: metadata.key,
        versionId: metadata.versionId,
        sizeBytes: metadata.sizeBytes,
        openStream: () => openObjectStream(storage!, objectIdentity),
      };
    },
  };
}

function openObjectStream(storage: ObjectStorage, identity: ObjectIdentity): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let stored;
      try {
        stored = await storage.get(identity);
      } catch (error) {
        controller.error(classifyObjectStorageError(error));
        return;
      }

      const reader = stored.body.getReader();
      try {
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          controller.enqueue(result.value);
        }
        controller.close();
      } catch (error) {
        controller.error(error instanceof ObjectStorageError ? error : classifyObjectStorageError(error));
      } finally {
        reader.releaseLock();
      }
    },
  });
}
