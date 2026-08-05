import { beforeEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.hoisted(() => ({ cookies: vi.fn() }));
const storeMock = vi.hoisted(() => ({
  getSession: vi.fn(),
  sanitize: vi.fn((value: unknown) => (typeof value === "string" ? value.trim() : "")),
}));
const clientRepositoryMock = vi.hoisted(() => ({ resolveOwnedClient: vi.fn() }));
const clientPhotoRepositoryMock = vi.hoisted(() => {
  class ClientPhotoDependencyError extends Error {
    readonly code = "CLIENT_PHOTO_CLIENT_NOT_FOUND";
    readonly httpStatus = 404;
  }
  return {
    ClientPhotoDependencyError,
    createClientPhotoForOwner: vi.fn(),
    isClientPhotoPersistenceError: vi.fn(),
    clientPhotoPersistenceUnavailableResponse: vi.fn(),
  };
});

vi.mock("next/headers", () => cookiesMock);
vi.mock("@/lib/milestone1-store", () => storeMock);
vi.mock("@/lib/client-repository", () => clientRepositoryMock);
vi.mock("@/lib/client-photo-repository", () => clientPhotoRepositoryMock);

import { POST } from "./route";

function invoke(body: unknown): Promise<Response> {
  const request = new Request("http://localhost/api/v1/clients/client-1/photos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(request, { params: Promise.resolve({ id: "client-1" }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  cookiesMock.cookies.mockResolvedValue({ get: () => ({ value: "session-token" }) });
  storeMock.getSession.mockReturnValue({ id: "owner-1" });
  storeMock.sanitize.mockImplementation((value: unknown) => (typeof value === "string" ? value.trim() : ""));
  clientRepositoryMock.resolveOwnedClient.mockResolvedValue({ id: "client-1" });
  clientPhotoRepositoryMock.createClientPhotoForOwner.mockResolvedValue({
    id: "photo-1",
    clientId: "client-1",
    imageUrl: "https://example.com/a.jpg",
    caption: "Before",
    createdAt: "2026-08-05T10:00:00.000Z",
  });
  clientPhotoRepositoryMock.isClientPhotoPersistenceError.mockReturnValue(false);
});

describe("POST /api/v1/clients/:id/photos", () => {
  it("only exports POST -- no GET exists on this route", async () => {
    const routeModule = await import("./route");
    expect(routeModule).not.toHaveProperty("GET");
  });

  it("returns 401 without a session", async () => {
    storeMock.getSession.mockReturnValue(null);
    const response = await invoke({ imageUrl: "https://example.com/a.jpg", caption: "Before" });
    expect(response.status).toBe(401);
    expect(clientPhotoRepositoryMock.createClientPhotoForOwner).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent or another owner's client", async () => {
    clientRepositoryMock.resolveOwnedClient.mockResolvedValue(null);
    const response = await invoke({ imageUrl: "https://example.com/a.jpg", caption: "Before" });
    expect(response.status).toBe(404);
    expect(clientPhotoRepositoryMock.createClientPhotoForOwner).not.toHaveBeenCalled();
  });

  it("returns 400 when imageUrl is missing", async () => {
    const response = await invoke({ caption: "Before" });
    expect(response.status).toBe(400);
    expect(clientPhotoRepositoryMock.createClientPhotoForOwner).not.toHaveBeenCalled();
  });

  it("creates a photo and preserves the existing 201 response contract", async () => {
    const response = await invoke({ imageUrl: "https://example.com/a.jpg", caption: "Before" });

    expect(response.status).toBe(201);
    expect(clientPhotoRepositoryMock.createClientPhotoForOwner).toHaveBeenCalledWith({
      clientId: "client-1",
      ownerUserId: "owner-1",
      imageUrl: "https://example.com/a.jpg",
      caption: "Before",
    });
    const body = await response.json();
    expect(body).toEqual({
      photo: {
        id: "photo-1",
        clientId: "client-1",
        imageUrl: "https://example.com/a.jpg",
        caption: "Before",
        createdAt: "2026-08-05T10:00:00.000Z",
      },
    });
  });

  it("maps a repository dependency error to the existing 404 response", async () => {
    clientPhotoRepositoryMock.createClientPhotoForOwner.mockRejectedValue(
      new clientPhotoRepositoryMock.ClientPhotoDependencyError(),
    );
    const response = await invoke({ imageUrl: "u", caption: "" });
    expect(response.status).toBe(404);
  });

  it("fails closed with 503 when photo persistence is unavailable", async () => {
    const error = new Error("db down");
    clientPhotoRepositoryMock.createClientPhotoForOwner.mockRejectedValue(error);
    clientPhotoRepositoryMock.isClientPhotoPersistenceError.mockImplementation((value: unknown) => value === error);
    clientPhotoRepositoryMock.clientPhotoPersistenceUnavailableResponse.mockReturnValue(
      Response.json({ error: "CLIENT_PHOTO_PERSISTENCE_UNAVAILABLE" }, {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      }),
    );

    const response = await invoke({ imageUrl: "u", caption: "" });
    expect(response.status).toBe(503);
  });
});
