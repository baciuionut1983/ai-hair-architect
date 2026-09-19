import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/session-request-auth", () => ({ authenticateSessionRequest: mocks.auth }));
vi.mock("@/lib/reviewed-procedural-knowledge-service", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/reviewed-procedural-knowledge-service")>(), readReviewedProceduralKnowledge: mocks.read }));
import { ReviewedProceduralKnowledgeReadError } from "@/lib/reviewed-procedural-knowledge-service";
import { GET } from "./route";

const invoke = () => GET(new Request("http://localhost/api/v1/learning-drafts/draft/reviewed-procedural-knowledge?ownerUserId=foreign-owner", { headers: { "x-owner-id": "foreign-owner" } }), { params: Promise.resolve({ draftId: "draft" }) });
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ id: "session-owner" }); });
describe("GET reviewed procedural knowledge", () => {
  it("requires authentication before reading any private data", async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await invoke();
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("uses only session owner, ignores spoofed headers/query, and returns no-store projection", async () => {
    const projection = { ownerUserId: "session-owner", entries: [], professionallyUndetermined: [], reviewState: "MISSING" };
    mocks.read.mockResolvedValue(projection);
    const response = await invoke();
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith("session-owner", "draft");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ projection });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it.each([
    ["DRAFT_NOT_FOUND", 404], ["PROJECTION_UNAVAILABLE", 409], ["PROJECTION_READ_UNAVAILABLE", 503],
  ] as const)("returns %s without private details", async (code, status) => {
    mocks.read.mockRejectedValue(new ReviewedProceduralKnowledgeReadError(code, status));
    const response = await invoke();
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: code });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
