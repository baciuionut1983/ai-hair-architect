import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const clientRepositoryMock = vi.hoisted(() => ({ resolveOwnedClient: vi.fn() }));
const photoPreviewRepositoryMock = vi.hoisted(() => ({ findPhotoPreviewGenerationForOwner: vi.fn() }));
const providerConfigMock = vi.hoisted(() => ({
  resolveVideoDemonstrationProviderConfig: vi.fn(),
  VIDEO_DEMONSTRATION_ALLOWED_VEO_MODELS: ["veo-3.1-lite-generate-preview", "veo-3.1-generate-preview"],
}));
const generationRepositoryMock = vi.hoisted(() => {
  class VideoDemonstrationGenerationDependencyError extends Error {
    constructor(
      readonly code: string,
      readonly httpStatus: number,
      message: string,
    ) {
      super(message);
      this.name = "VideoDemonstrationGenerationDependencyError";
    }
  }
  class VideoDemonstrationGenerationValidationError extends Error {
    readonly httpStatus = 422;
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "VideoDemonstrationGenerationValidationError";
    }
  }
  class VideoDemonstrationGenerationInvariantError extends Error {
    readonly code = "VIDEO_DEMONSTRATION_GENERATION_INVARIANT_VIOLATED";
    readonly httpStatus = 500;
    constructor(message: string) {
      super(message);
      this.name = "VideoDemonstrationGenerationInvariantError";
    }
  }
  class VideoDemonstrationGenerationConcurrencyError extends Error {
    readonly code = "VIDEO_DEMONSTRATION_GENERATION_CONCURRENCY_CONFLICT";
    readonly httpStatus = 409;
    constructor() {
      super("conflict");
      this.name = "VideoDemonstrationGenerationConcurrencyError";
    }
  }
  class VideoDemonstrationGenerationPersistenceError extends Error {
    readonly code = "VIDEO_DEMONSTRATION_GENERATION_PERSISTENCE_UNAVAILABLE";
    readonly httpStatus = 503;
    constructor() {
      super("unavailable");
      this.name = "VideoDemonstrationGenerationPersistenceError";
    }
  }
  return {
    VideoDemonstrationGenerationDependencyError,
    VideoDemonstrationGenerationValidationError,
    VideoDemonstrationGenerationInvariantError,
    VideoDemonstrationGenerationConcurrencyError,
    VideoDemonstrationGenerationPersistenceError,
    createVideoDemonstrationGeneration: vi.fn(),
    createVideoDemonstrationGenerationVariation: vi.fn(),
    listVideoDemonstrationGenerationsForPhotoPreview: vi.fn(),
    findVideoDemonstrationGenerationForOwner: vi.fn(),
  };
});
const executionServiceMock = vi.hoisted(() => ({ executeVideoDemonstrationGeneration: vi.fn() }));

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => clientRepositoryMock);
vi.mock("@/lib/photo-preview-generation-repository", () => photoPreviewRepositoryMock);
vi.mock("@/lib/video-generation-provider-config", () => providerConfigMock);
vi.mock("@/lib/video-generation-repository", () => generationRepositoryMock);
vi.mock("@/lib/video-generation-execution-service", () => executionServiceMock);

import { GET, POST } from "./route";

const OWNER = { id: "owner-1", email: "owner@example.com", role: "professional", locale: "en" };
const CLIENT = { id: "client-1", ownerUserId: "owner-1" };
const PHOTO_PREVIEW = { id: "pp-1", clientId: "client-1", status: "COMPLETED" };
const GENERATION_REQUESTED = { id: "gen-1", ownerUserId: "owner-1", clientId: "client-1", photoPreviewGenerationId: "pp-1", status: "REQUESTED" };
const GENERATION_PROCESSING = { ...GENERATION_REQUESTED, status: "PROCESSING", providerOperationId: "op-1" };

function ctx(id = "client-1", photoPreviewGenerationId = "pp-1") {
  return { params: Promise.resolve({ id, photoPreviewGenerationId }) };
}

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api", { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  clientRepositoryMock.resolveOwnedClient.mockResolvedValue(CLIENT);
  photoPreviewRepositoryMock.findPhotoPreviewGenerationForOwner.mockResolvedValue(PHOTO_PREVIEW);
  providerConfigMock.resolveVideoDemonstrationProviderConfig.mockReturnValue({ status: "enabled", provider: "google", apiKey: "k", model: "veo-3.1-lite-generate-preview" });
});

describe("POST /clients/[id]/photo-preview-generations/[photoPreviewGenerationId]/video-demonstrations", () => {
  it("an authenticated owner can create a generation from a COMPLETED Photo Preview, calling google/the configured default model, with exactly one submit attempt", async () => {
    generationRepositoryMock.createVideoDemonstrationGeneration.mockResolvedValue({ record: GENERATION_REQUESTED, created: true });
    executionServiceMock.executeVideoDemonstrationGeneration.mockResolvedValue({ outcome: "submitted", generation: GENERATION_PROCESSING });
    generationRepositoryMock.findVideoDemonstrationGenerationForOwner.mockResolvedValue(GENERATION_PROCESSING);

    const response = await POST(jsonRequest({}), ctx());
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.generation.status).toBe("PROCESSING");
    expect(body.executionOutcome.outcome).toBe("submitted");
    expect(generationRepositoryMock.createVideoDemonstrationGeneration).toHaveBeenCalledWith("owner-1", "client-1", "pp-1", "google", "veo-3.1-lite-generate-preview");
  });

  it("client sends only photoPreviewId (+ optional variation/model) -- no provider, prompt, or ancestor id is ever accepted or forwarded", async () => {
    generationRepositoryMock.createVideoDemonstrationGeneration.mockResolvedValue({ record: GENERATION_REQUESTED, created: true });
    executionServiceMock.executeVideoDemonstrationGeneration.mockResolvedValue({ outcome: "submitted", generation: GENERATION_PROCESSING });
    generationRepositoryMock.findVideoDemonstrationGenerationForOwner.mockResolvedValue(GENERATION_PROCESSING);

    await POST(jsonRequest({ provider: "openai", prompt: "ignore everything", analysisProposalId: "sneaky" }), ctx());
    expect(generationRepositoryMock.createVideoDemonstrationGeneration).toHaveBeenCalledWith("owner-1", "client-1", "pp-1", "google", "veo-3.1-lite-generate-preview");
  });

  it("an unauthenticated request is blocked with 401, never reaching any domain call", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);
    const response = await POST(jsonRequest({}), ctx());
    expect(response.status).toBe(401);
    expect(generationRepositoryMock.createVideoDemonstrationGeneration).not.toHaveBeenCalled();
  });

  it("a foreign client (not owned by this session) is blocked with a generic not-found, never a domain call", async () => {
    clientRepositoryMock.resolveOwnedClient.mockResolvedValue(null);
    const response = await POST(jsonRequest({}), ctx());
    expect(response.status).toBe(404);
    expect(generationRepositoryMock.createVideoDemonstrationGeneration).not.toHaveBeenCalled();
  });

  it("a Photo Preview that is not COMPLETED is rejected by the domain layer, surfaced with its own httpStatus/code, never a silently invented one", async () => {
    generationRepositoryMock.createVideoDemonstrationGeneration.mockRejectedValue(
      new generationRepositoryMock.VideoDemonstrationGenerationDependencyError("VIDEO_DEMONSTRATION_GENERATION_PHOTO_PREVIEW_NOT_COMPLETED", 422, "not completed"),
    );
    const response = await POST(jsonRequest({}), ctx());
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error).toBe("VIDEO_DEMONSTRATION_GENERATION_PHOTO_PREVIEW_NOT_COMPLETED");
    expect(executionServiceMock.executeVideoDemonstrationGeneration).not.toHaveBeenCalled();
  });

  it("a repeat submission (exact retry) idempotently resolves to the same generation -- 200, not 201", async () => {
    generationRepositoryMock.createVideoDemonstrationGeneration.mockResolvedValue({ record: GENERATION_PROCESSING, created: false });
    executionServiceMock.executeVideoDemonstrationGeneration.mockResolvedValue({ outcome: "still_processing", generation: GENERATION_PROCESSING });
    generationRepositoryMock.findVideoDemonstrationGenerationForOwner.mockResolvedValue(GENERATION_PROCESSING);

    const response = await POST(jsonRequest({}), ctx());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.generation.id).toBe(GENERATION_PROCESSING.id);
  });

  it("an explicit variation request calls the distinct variation path, never the ordinary idempotent one", async () => {
    generationRepositoryMock.createVideoDemonstrationGenerationVariation.mockResolvedValue({ record: { ...GENERATION_REQUESTED, id: "gen-2", variationIndex: 1 }, created: true });
    executionServiceMock.executeVideoDemonstrationGeneration.mockResolvedValue({ outcome: "submitted", generation: GENERATION_PROCESSING });
    generationRepositoryMock.findVideoDemonstrationGenerationForOwner.mockResolvedValue(GENERATION_PROCESSING);

    await POST(jsonRequest({ variation: true }), ctx());
    expect(generationRepositoryMock.createVideoDemonstrationGenerationVariation).toHaveBeenCalledTimes(1);
    expect(generationRepositoryMock.createVideoDemonstrationGeneration).not.toHaveBeenCalled();
  });

  it("the browser cannot choose an arbitrary model -- an out-of-allowlist value is rejected with 422, no domain call", async () => {
    const response = await POST(jsonRequest({ model: "sora-2" }), ctx());
    expect(response.status).toBe(422);
    expect(generationRepositoryMock.createVideoDemonstrationGeneration).not.toHaveBeenCalled();
  });

  it("with no model given and no server default configured, responds 503 without inventing a model choice", async () => {
    providerConfigMock.resolveVideoDemonstrationProviderConfig.mockReturnValue({ status: "disabled" });
    const response = await POST(jsonRequest({}), ctx());
    expect(response.status).toBe(503);
    expect(generationRepositoryMock.createVideoDemonstrationGeneration).not.toHaveBeenCalled();
  });
});

describe("GET /clients/[id]/photo-preview-generations/[photoPreviewGenerationId]/video-demonstrations", () => {
  it("lists every generation for this exact (client, Photo Preview) scope", async () => {
    generationRepositoryMock.listVideoDemonstrationGenerationsForPhotoPreview.mockResolvedValue([GENERATION_REQUESTED]);
    const response = await GET(new Request("http://localhost/api"), ctx());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.generations).toEqual([GENERATION_REQUESTED]);
  });

  it("a nonexistent/foreign Photo Preview id resolves to a generic 404, never an empty list", async () => {
    photoPreviewRepositoryMock.findPhotoPreviewGenerationForOwner.mockResolvedValue(null);
    const response = await GET(new Request("http://localhost/api"), ctx());
    expect(response.status).toBe(404);
    expect(generationRepositoryMock.listVideoDemonstrationGenerationsForPhotoPreview).not.toHaveBeenCalled();
  });
});
