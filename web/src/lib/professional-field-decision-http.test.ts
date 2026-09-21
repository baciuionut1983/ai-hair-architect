import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn(), submit: vi.fn() }));
vi.mock("@/lib/session-request-auth", () => ({ authenticateSessionRequest: mocks.auth }));
vi.mock("@/lib/professional-field-claim-decision-service", async original => ({ ...await original<typeof import("@/lib/professional-field-claim-decision-service")>(), readProfessionalFieldDecisionReview: mocks.read, submitProfessionalFieldClaimDecision: mocks.submit }));
import { GET } from "@/app/api/v1/learning-drafts/[draftId]/professional-field-decisions/route";
import { POST } from "@/app/api/v1/learning-drafts/[draftId]/professional-field-decisions/[field]/route";
import { ProfessionalFieldClaimDecisionError } from "@/lib/professional-field-claim-decision-service";
import { isSameOriginDecisionRequest, readDecisionBody } from "@/lib/professional-field-decision-http";

const input = { expectedRevision: 0, observationDigest: "sha256:a", specificationVersion: "v1", specificationDigest: "sha256:b", decision: "CONFIRMED" };
const context = (field = "elevation") => ({ params: Promise.resolve({ draftId: "draft", field }) });
const request = (body: unknown = input, headers: Record<string, string> = { "content-type": "application/json" }) => new Request("http://backend/api?ownerUserId=forged", { method: "POST", headers, body: JSON.stringify(body) });
async function check(response: Response, status: number) { expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toBe("private, no-store"); return response.json(); }
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ id: randomUUID() }); });
describe("b.2 HTTP safety and static failures", () => {
  it.each(["GET", "POST"])("authenticates first for %s, even invalid field/body/origin", async method => {
    mocks.auth.mockResolvedValue(null);
    const req = request([], { "sec-fetch-site": "cross-site" });
    const response = method === "GET" ? await GET(req, context("cuttingLine")) : await POST(req, context("cuttingLine"));
    expect(await check(response, 401)).toEqual({ error: "Unauthorized" });
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("uses only session owner despite query and headers", async () => {
    mocks.read.mockResolvedValue({ draftId: "draft", fields: [] });
    await check(await GET(request(input, { "ownerUserId": "forged", "x-owner-id": "forged" }), context()), 200);
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith((await mocks.auth()).id, "draft");
  });
  it.each(["", "text/plain", "application/problem+json"])("rejects media type %j", async contentType => {
    expect(await check(await POST(request(input, contentType ? { "content-type": contentType } : {}), context()), 415)).toEqual({ error: "UNSUPPORTED_MEDIA_TYPE" });
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("accepts case-insensitive JSON with parameters and projects POST DTO", async () => {
    mocks.submit.mockResolvedValue({ outcome: "CREATED", httpStatus: 201, decision: { id: "secret-row", ownerUserId: "secret-owner", reviewedByUserId: "secret-reviewer", observationDigest: "secret-digest", field: "elevation", revision: 1, decision: "CONFIRMED", professionalValue: "canonical", note: "Verbatim", createdAt: new Date(0) } });
    const body = await check(await POST(request(input, { "content-type": "Application/JSON; charset=utf-8", "x-owner-id": "forged" }), context()), 201);
    expect(body).toEqual({ outcome: "CREATED", decision: { field: "elevation", revision: 1, decision: "CONFIRMED", professionalValue: "canonical", note: "Verbatim", createdAt: new Date(0).toISOString() } });
    expect(mocks.submit).toHaveBeenCalledWith((await mocks.auth()).id, { ...input, field: "elevation", draftId: "draft" });
  });
  it.each(["ownerUserId", "reviewedByUserId", "actorUserId", "field", "draftId", "candidateResolution", "professionalValue", "allowedValues", "specification", "skillId", "applicability", "eligibility", "observationDigestVersion"])("rejects unknown key %s", async key => {
    expect(await check(await POST(request({ ...input, [key]: "forged" }), context()), 400)).toEqual({ error: "INVALID_REQUEST" });
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it.each([null, [], "string", {}, { ...input, expectedRevision: -1 }, { ...input, expectedRevision: 1.5 }, { ...input, expectedRevision: 2147483647 }, { ...input, expectedRevision: "0" }, { ...input, note: null }, { ...input, correctedValue: 45 }, ...["observationDigest", "specificationVersion", "specificationDigest", "decision"].flatMap(key => [{ ...input, [key]: undefined }, { ...input, [key]: 3 }])])("rejects malformed shape %j", async body => {
    await check(await POST(request(body), context()), 400); expect(mocks.submit).not.toHaveBeenCalled();
  });
  it.each(["", "{bad"])("rejects empty/malformed JSON", async body => {
    await check(await POST(new Request("https://app/", { method: "POST", headers: { "content-type": "application/json" }, body }), context()), 400);
  });
  it("rejects unsupported URL fields", async () => {
    expect(await check(await POST(request(), context("cuttingLine")), 404)).toEqual({ error: "FIELD_NOT_FOUND" });
  });
  it.each(["observationDigest", "specificationVersion", "specificationDigest"])("rejects empty/missing %s before b.1", async key => {
    for (const value of [undefined, "", " \t"]) {
      expect(await check(await POST(request({ ...input, [key]: value }), context()), 400)).toEqual({ error: "INVALID_REQUEST" });
      expect(mocks.submit).not.toHaveBeenCalled();
    }
  });
  it("runs body/media safeguards before URL field validation", async () => {
    expect(await check(await POST(request({}, {}), context("cuttingLine")), 415)).toEqual({ error: "UNSUPPORTED_MEDIA_TYPE" });
    expect(await check(await POST(request([]), context("cuttingLine")), 400)).toEqual({ error: "INVALID_REQUEST" });
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("rejects mismatching Origin at the HTTP boundary", async () => {
    expect(await check(await POST(request(input, { "content-type": "application/json", origin: "https://evil.example", host: "app.example" }), context()), 403)).toEqual({ error: "CROSS_ORIGIN_REJECTED" });
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("bounds declared and actual byte lengths, and cancels an overflowing stream", async () => {
    await check(await POST(request(input, { "content-type": "application/json", "content-length": "8193" }), context()), 413);
    await check(await POST(request({ ...input, note: "é".repeat(5000) }, { "content-type": "application/json", "content-length": "1" }), context()), 413);
    const cancel = vi.fn(); let chunks = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { chunks++; controller.enqueue(new Uint8Array(4097)); }, cancel });
    const req = new Request("https://app/", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    await expect(readDecisionBody(req)).rejects.toMatchObject({ code: "REQUEST_TOO_LARGE" });
    expect(cancel).toHaveBeenCalledOnce(); expect(chunks).toBeLessThanOrEqual(3);
  });
  it("accepts exactly 8192 bytes", async () => {
    const json = JSON.stringify(input); const body = json + " ".repeat(8192 - Buffer.byteLength(json));
    expect(await readDecisionBody(new Request("https://app/", { method: "POST", body }))).toEqual(input);
  });
  it("limits the 31st POST per session owner; GET stays unrate-limited", async () => {
    for (let i = 0; i < 30; i++) await check(await POST(request(input, { "sec-fetch-site": "cross-site" }), context()), 403);
    expect(await check(await POST(request(), context()), 429)).toEqual({ error: "Rate limit exceeded." });
    mocks.read.mockResolvedValue({ fields: [] }); await check(await GET(request(), context()), 200);
  });
  it.each(["GET", "POST"])("foreign and absent errors have the same static %s body", async method => {
    const service = method === "GET" ? mocks.read : mocks.submit;
    service.mockRejectedValue(new ProfessionalFieldClaimDecisionError("DRAFT_NOT_FOUND"));
    const invoke = () => method === "GET" ? GET(request(), context()) : POST(request(), context());
    expect(await check(await invoke(), 404)).toEqual({ error: "DRAFT_NOT_FOUND" });
    expect(await (await invoke()).text()).toBe('{"error":"DRAFT_NOT_FOUND"}');
  });
  it.each(["REVISION_CONFLICT", "OBSERVATION_DIGEST_MISMATCH", "SPEC_VERSION_CHANGED", "DRAFT_SUPERSEDED", "DRAFT_NOT_APPROVED", "EVIDENCE_NOT_ACTIVE", "EVIDENCE_SOURCE_DELETED"] as const)("maps %s with safe refresh instruction", async code => {
    mocks.submit.mockRejectedValue(new ProfessionalFieldClaimDecisionError(code));
    expect(await check(await POST(request(), context()), 409)).toEqual({ error: code, message: "Review state changed. Refresh before submitting.", refreshRequired: true });
    expect(mocks.submit).toHaveBeenCalledOnce();
  });
  it.each(["GET", "POST"])("redacts unexpected and persistence %s failures in response and logs", async method => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const service = method === "GET" ? mocks.read : mocks.submit;
    for (const [error, status, code] of [[new Error("SECRET SQL note observation"), 500, "INTERNAL_ERROR"], [new Prisma.PrismaClientKnownRequestError("SECRET SQL note observation", { code: "P2024", clientVersion: "test" }), 503, "PROFESSIONAL_FIELD_DECISION_UNAVAILABLE"]] as const) {
      service.mockRejectedValue(error);
      expect(await check(await (method === "GET" ? GET(request(), context()) : POST(request(), context())), status)).toEqual({ error: code });
    }
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/SECRET|SQL|observation|stack/); log.mockRestore();
  });
  it.each(["GET", "POST"])("contains all recognized Prisma error classes for %s", async method => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const service = method === "GET" ? mocks.read : mocks.submit;
    const secret = "SECRET SQL professional note raw AI observation";
    for (const error of [
      new Prisma.PrismaClientInitializationError(secret, "6.12.0", "P1001"),
      new Prisma.PrismaClientValidationError(secret, { clientVersion: "6.12.0" }),
      new Prisma.PrismaClientRustPanicError(secret, "6.12.0"),
      new Prisma.PrismaClientUnknownRequestError(secret, { clientVersion: "6.12.0" }),
      new Prisma.PrismaClientKnownRequestError(secret, { clientVersion: "6.12.0", code: "P2025" }),
    ]) {
      service.mockRejectedValue(error);
      expect(await check(await (method === "GET" ? GET(request(), context()) : POST(request(), context())), 503)).toEqual({ error: "PROFESSIONAL_FIELD_DECISION_UNAVAILABLE" });
    }
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/SECRET|SQL|note|observation|stack/);
    log.mockRestore();
  });
});
describe("proxy-aware local origin guard", () => {
  it.each([
    [{}, true], [{ "sec-fetch-site": "same-origin" }, true], [{ "sec-fetch-site": "same-site" }, false],
    [{ "sec-fetch-site": "cross-site" }, false], [{ "sec-fetch-site": "none" }, false], [{ "sec-fetch-site": "unexpected" }, false],
    [{ origin: "https://APP.EXAMPLE", host: "app.example" }, true],
    [{ origin: "https://aihairarchitect.com", host: "backend:8080", "x-forwarded-host": "aihairarchitect.com" }, true],
    [{ origin: "https://app.example:443", host: "APP.EXAMPLE" }, true],
    [{ origin: "http://app.example:80", host: "APP.EXAMPLE" }, true],
    [{ origin: "https://app.example", host: "APP.EXAMPLE:80" }, false],
    [{ origin: "https://app.example:80", host: "APP.EXAMPLE" }, false],
    [{ origin: "https://app.example\\evil", host: "app.example" }, false],
    [{ origin: "https://app.example:8443", host: "app.example:8443" }, true],
    [{ origin: "https://app.example:8443", host: "app.example:8080" }, false],
    [{ origin: "https://evil.example", host: "app.example" }, false],
    [{ origin: "null", host: "app.example" }, false], [{ origin: "not a url", host: "app.example" }, false],
    [{ origin: "https://user@app.example", host: "app.example" }, false],
    [{ origin: "https://app.example/path", host: "app.example" }, false],
    [{ origin: "https://app.example", host: "app.example", "x-forwarded-host": "evil.example, app.example" }, false],
    [{ origin: "https://app.example" }, false],
  ] as [Record<string, string>, boolean][])("%j => %s", (headers, expected) => {
    expect(isSameOriginDecisionRequest(new Request("http://backend:8080/", { headers }))).toBe(expected);
  });
});
