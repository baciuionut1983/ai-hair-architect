import type { M15ObjectStorageAliasResolver } from "./backup-m15-external-reference-verifier";
import type { ObjectStorage } from "./object-storage";
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

function resolveMode(value: string | undefined): ObjectStorageMode {
  return value === "production" || value === "development" || value === "test"
    ? value
    : "unknown";
}
