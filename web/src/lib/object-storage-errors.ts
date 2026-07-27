export type ObjectStorageErrorCode =
  | "not_found"
  | "access_denied"
  | "timeout"
  | "throttled"
  | "configuration"
  | "provider_unavailable";

const SAFE_MESSAGES: Record<ObjectStorageErrorCode, string> = {
  not_found: "The requested object was not found.",
  access_denied: "Object storage denied the operation.",
  timeout: "The object storage operation timed out.",
  throttled: "Object storage temporarily throttled the operation.",
  configuration: "Object storage is not configured correctly.",
  provider_unavailable: "Object storage is temporarily unavailable."
};

export class ObjectStorageError extends Error {
  readonly code: ObjectStorageErrorCode;
  readonly retryable: boolean;

  constructor(code: ObjectStorageErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = "ObjectStorageError";
    this.code = code;
    this.retryable = code === "timeout" || code === "throttled" || code === "provider_unavailable";
  }
}

export function classifyObjectStorageError(error: unknown): ObjectStorageError {
  if (error instanceof ObjectStorageError) {
    return error;
  }

  const providerError = asProviderError(error);
  const name = providerError?.name ?? "";
  const statusCode = providerError?.$metadata?.httpStatusCode;

  if (name === "AbortError" || name === "TimeoutError") {
    return new ObjectStorageError("timeout");
  }
  if (name === "NoSuchKey" || name === "NotFound" || statusCode === 404) {
    return new ObjectStorageError("not_found");
  }
  if (name === "AccessDenied" || statusCode === 401 || statusCode === 403) {
    return new ObjectStorageError("access_denied");
  }
  if (name === "SlowDown" || name === "Throttling" || statusCode === 429) {
    return new ObjectStorageError("throttled");
  }

  return new ObjectStorageError("provider_unavailable");
}

interface ProviderErrorShape {
  name?: string;
  $metadata?: { httpStatusCode?: number };
}

function asProviderError(error: unknown): ProviderErrorShape | null {
  return typeof error === "object" && error !== null ? (error as ProviderErrorShape) : null;
}