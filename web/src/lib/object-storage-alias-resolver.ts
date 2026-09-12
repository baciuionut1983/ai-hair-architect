import type { M15ObjectStorageAliasResolver } from "./backup-m15-external-reference-verifier";
import type { MultipartObjectStorage, ObjectStorage } from "./object-storage";
import {
  loadObjectStorageConfig,
  type ObjectStorageConfig,
  type ObjectStorageMode,
  type S3ObjectStorageConfig,
} from "./object-storage-config";
import { S3ObjectStorage } from "./object-storage-s3";

export const OBJECT_STORAGE_ALIAS_RESOLVER_UNAVAILABLE = "OBJECT_STORAGE_ALIAS_RESOLVER_UNAVAILABLE" as const;

type EnvironmentSource = Readonly<Record<string, string | undefined>>;
type ObjectStorageConfigLoader = (
  environment: EnvironmentSource,
  mode: ObjectStorageMode,
) => ObjectStorageConfig;
type ObjectStorageProviderFactory = (config: S3ObjectStorageConfig) => ObjectStorage;

export interface ObjectStorageAliasResolverDependencies {
  environment?: EnvironmentSource;
  mode?: ObjectStorageMode;
  loadConfig?: ObjectStorageConfigLoader;
  createProvider?: ObjectStorageProviderFactory;
}

export class ObjectStorageAliasResolverError extends Error {
  readonly code = OBJECT_STORAGE_ALIAS_RESOLVER_UNAVAILABLE;

  constructor() {
    super("Object storage alias resolution is unavailable.");
    this.name = "ObjectStorageAliasResolverError";
  }
}

export function createObjectStorageAliasResolver(
  dependencies: ObjectStorageAliasResolverDependencies = {},
): M15ObjectStorageAliasResolver {
  const environment = dependencies.environment ?? process.env;
  const mode = dependencies.mode ?? resolveMode(environment.NODE_ENV);
  const loadConfig = dependencies.loadConfig ?? loadObjectStorageConfig;
  const createProvider = dependencies.createProvider ?? ((config) => new S3ObjectStorage(config));
  let configuration: S3ObjectStorageConfig | null = null;
  let configurationError: ObjectStorageAliasResolverError | null = null;
  let configurationEvaluated = false;
  let provider: ObjectStorage | null = null;
  let providerError: ObjectStorageAliasResolverError | null = null;

  return async (bucketAlias) => {
    if (!configurationEvaluated) {
      configurationEvaluated = true;
      try {
        const loaded = loadConfig(environment, mode);
        if (loaded.backend !== "s3") {
          throw new ObjectStorageAliasResolverError();
        }
        configuration = loaded;
      } catch {
        configurationError = new ObjectStorageAliasResolverError();
      }
    }

    if (configurationError || !configuration) {
      throw new ObjectStorageAliasResolverError();
    }
    if (bucketAlias !== configuration.bucketAlias) {
      return null;
    }
    if (provider) {
      return provider;
    }
    if (providerError) {
      throw new ObjectStorageAliasResolverError();
    }

    try {
      provider = createProvider(configuration);
      return provider;
    } catch {
      providerError = new ObjectStorageAliasResolverError();
      throw providerError;
    }
  };
}

// Stage 8.5L3.1 -- same config-loading/single-bucket-alias-match logic as
// createObjectStorageAliasResolver above, returned typed as
// MultipartObjectStorage & ObjectStorage instead of only the base
// ObjectStorage interface (finalization needs both: completeMultipartUpload
// AND a real head() call for the authoritative post-upload verification,
// Part 11/22). Deliberately a SEPARATE exported function rather than
// widening the existing resolver's return type -- every existing consumer
// of createObjectStorageAliasResolver (image-asset-retention-runtime.ts,
// photo-preview-output-storage.ts, video-asset-storage.ts, ...) keeps its
// exact current type unchanged. Not a second storage service: it
// resolves the SAME S3ObjectStorage instance shape (which implements
// both interfaces) -- only the local-disk backend is structurally unable
// to satisfy MultipartObjectStorage, which is why this resolver still
// throws ObjectStorageAliasResolverError whenever the configured backend
// is not s3, exactly like the base resolver does.
type MultipartCapableObjectStorage = MultipartObjectStorage & ObjectStorage;
type MultipartObjectStorageResolver = (bucketAlias: string) => Promise<MultipartCapableObjectStorage | null>;

export function createMultipartObjectStorageAliasResolver(
  dependencies: ObjectStorageAliasResolverDependencies = {},
): MultipartObjectStorageResolver {
  const base = createObjectStorageAliasResolver(dependencies);
  return async (bucketAlias) => (await base(bucketAlias)) as MultipartCapableObjectStorage | null;
}

function resolveMode(value: string | undefined): ObjectStorageMode {
  return value === "production" || value === "development" || value === "test"
    ? value
    : "unknown";
}
