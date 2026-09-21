import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
const mocks = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/session-request-auth", () => ({ authenticateSessionRequest: mocks.auth }));
import { prisma } from "@/lib/prisma";
import { GET } from "@/app/api/v1/learning-drafts/[draftId]/professional-field-decisions/route";
import { POST } from "@/app/api/v1/learning-drafts/[draftId]/professional-field-decisions/[field]/route";
import { readProfessionalFieldDecisionReview as review, submitProfessionalFieldClaimDecision as submit } from "@/lib/professional-field-claim-decision-service";
import { deriveProfessionalFieldReviewCandidates, PROFESSIONAL_FIELD_DECISIONS, validateProfessionalFieldDecisionRequest } from "@/lib/professional-field-review-candidates";
import { ELEVATION_OPTIONS, SECTIONING_OPTIONS, GUIDELINE_OPTIONS } from "@/lib/proposal-validators";
import * as governance from "@/lib/professional-field-specification-governance";
const database = new URL(process.env.DATABASE_URL ?? "postgresql://missing/missing");
if (!["localhost", "127.0.0.1"].includes(database.hostname) || database.pathname !== "/ai_hair_architect_test") throw Error("Requires established local test database");
const owners: string[] = [];
const originalTransaction = prisma.$transaction;
const observed = (value: string) => ({ value, source: "OBSERVED" });
async function fixture(extraction: Prisma.InputJsonObject = { elevation: observed(ELEVATION_OPTIONS[0]), sectioning: observed(SECTIONING_OPTIONS[0]), guideType: observed(GUIDELINE_OPTIONS[0]) }) {
  const owner = randomUUID(); owners.push(owner);
  await prisma.user.create({ data: { id: owner, email: `${owner}@b2.test`, passwordHash: "test", role: "professional", locale: "en" } });
  const evidence = await prisma.professionalLearningEvidence.create({ data: { ownerUserId: owner, evidenceType: "TEXT", vertical: "hair_cutting", originalText: "Test evidence", provenance: {}, rightsClassification: "USER_OWNED_OR_AUTHORIZED", createdByUserId: owner } });
  const draft = await prisma.professionalLearningDraft.create({ data: { ownerUserId: owner, sourceEvidenceId: evidence.id, extractorVersion: "b2-test", status: "APPROVED", discernmentCategory: "PROFESSIONAL_TECHNIQUE", comparisonOutcome: "POSSIBLE_NEW_SKILL", extraction, createdByUserId: owner } });
  mocks.auth.mockResolvedValue({ id: owner, role: "client" }); // No additional role gate.
  return { owner, draft, evidence };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const context = (f: Fixture, field = "elevation", draftId = f.draft.id) => ({ params: Promise.resolve({ draftId, field }) });
async function body(f: Fixture, extra = {}, field = "elevation") {
  const state = await review(f.owner, f.draft.id);
  const entry = state.fields.find(entry => entry.field === field)!;
  if (!entry.review.reviewable) throw Error("Invalid test fixture");
  const { observationDigest, specificationVersion, specificationDigest } = entry.review.candidate.pins;
  return { expectedRevision: entry.latestRevision, observationDigest, specificationVersion, specificationDigest, decision: "CONFIRMED", ...extra };
}
const post = async (f: Fixture, input: unknown, field = "elevation", draftId = f.draft.id) => POST(new Request("http://app/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }), context(f, field, draftId));
const get = async (f: Fixture, draftId = f.draft.id) => GET(new Request("http://app/?ownerUserId=forged"), context(f, "elevation", draftId));
afterEach(async () => {
  vi.restoreAllMocks(); prisma.$transaction = originalTransaction; const where = { ownerUserId: { in: owners } };
  await prisma.professionalFieldClaimDecision.deleteMany({ where }); await prisma.professionalLearningDraft.deleteMany({ where });
  await prisma.professionalLearningEvidence.deleteMany({ where }); await prisma.user.deleteMany({ where: { id: { in: owners.splice(0) } } });
});
describe("b.2 HTTP + real b.1 local database", () => {
  it("returns ordered all-field owner review state without writing or exposing row internals", async () => {
    const f = await fixture(); const response = await get(f);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    const state = await response.json();
    expect(state.fields.map((field: { field: string }) => field.field)).toEqual(["elevation", "sectioning", "guideType"]);
    expect(state.lifecycle).toEqual({ open: true, blockedBy: null });
    for (const field of state.fields) expect(field).toMatchObject({ latestRevision: 0, authority: "NONE", latest: null, history: [], historyTruncated: false, actions: { canSubmit: true }, review: { reviewable: true, candidate: { resolution: "CANONICAL" } } });
    expect(JSON.stringify(state)).not.toMatch(/ownerUserId|reviewedByUserId|"id"|storagePath|implementationFingerprint/);
    expect(await prisma.professionalFieldClaimDecision.count({ where: { ownerUserId: f.owner } })).toBe(0);
    expect(await prisma.professionalLearningDraft.findUnique({ where: { id: f.draft.id } })).toEqual(f.draft);
  });
  it.each(["CANONICAL", "UNRESOLVED_TEXT", "UNCLEAR_MEANING"])("derives %s actions with exact b.0 validator parity", async resolution => {
    const elevation = resolution === "CANONICAL" ? observed(ELEVATION_OPTIONS[0]) : resolution === "UNRESOLVED_TEXT" ? observed("45° Interior") : { value: null, source: "UNKNOWN", rawObservation: "45° Interior" };
    const f = await fixture({ elevation }); const field = (await review(f.owner, f.draft.id)).fields[0];
    const derived = deriveProfessionalFieldReviewCandidates(f.draft, ["elevation"]); if (!derived.ok) throw Error("invalid fixture");
    const candidate = derived.candidates[0];
    const allowed = PROFESSIONAL_FIELD_DECISIONS.filter(decision => {
      const req = { candidateId: candidate.id, field: "elevation", draftId: f.draft.id, sourceEvidenceId: f.evidence.id, extractorVersion: f.draft.extractorVersion, specificationVersion: candidate.specificationVersion, observationDigest: candidate.observationDigest, decision };
      return decision === "CORRECTED" ? ELEVATION_OPTIONS.some(correctedValue => validateProfessionalFieldDecisionRequest(candidate, { ...req, correctedValue }).ok) : validateProfessionalFieldDecisionRequest(candidate, req).ok;
    });
    expect(field.actions.allowedDecisions).toEqual(allowed);
    expect(field.review.reviewable && field.review.candidate.resolution).toBe(resolution);
  });
  it.each([
    [{}, "ABSENT"], [{ elevation: { value: null, source: "UNKNOWN" } }, "EXTRACTION_UNKNOWN"],
    [{ elevation: observed(" ") }, "NO_OBSERVATION"], [{ elevation: { value: "x", source: "PROFESSIONAL_INPUT" } }, "INVALID_OBSERVATION"],
    [{ elevation: { value: 23, source: "OBSERVED" } }, "INVALID_OBSERVATION"],
  ] as [Prisma.InputJsonObject, string][])("represents non-reviewable %j", async (extraction, reason) => {
    const f = await fixture(extraction); const field = (await review(f.owner, f.draft.id)).fields[0];
    expect(field.review).toEqual({ reviewable: false, reason });
    expect(field.actions).toEqual({ canSubmit: false, blockedReason: reason, allowedDecisions: [] });
  });
  it("preserves authorized AI observation fields and excludes sibling/private data", async () => {
    const elevation = { ...observed(ELEVATION_OPTIONS[0]), confidence: 0.8, note: "AI note", rawObservation: "raw", segments: [{ timeStartSeconds: 1, timeEndSeconds: 2, relevance: 1, frameReferences: ["frame-1"] }] };
    const f = await fixture({ elevation, techniqueCandidate: observed("SIBLING_PRIVATE") }); const field = (await review(f.owner, f.draft.id)).fields[0];
    expect(field.review.reviewable && field.review.candidate.observation).toEqual(elevation);
    expect(JSON.stringify(await review(f.owner, f.draft.id))).not.toContain("SIBLING_PRIVATE");
  });
  it("maps R1 to 201, 200, 409 and keeps prior revisions unchanged", async () => {
    const f = await fixture(); const input = await body(f); const first = await post(f, input);
    expect(first.status).toBe(201); const created = await first.json();
    const same = await post(f, { ...input, expectedRevision: 1 }); expect(same.status).toBe(200);
    expect(await same.json()).toEqual({ ...created, outcome: "UNCHANGED" });
    expect(await prisma.professionalFieldClaimDecision.count({ where: { ownerUserId: f.owner } })).toBe(1);
    for (const decision of ["CONFIRMED", "UNKNOWN"]) {
      const stale = await post(f, { ...input, decision }); expect(stale.status).toBe(409);
      expect(await stale.json()).toMatchObject({ error: "REVISION_CONFLICT", refreshRequired: true });
    }
    expect((await post(f, { ...input, expectedRevision: 1, decision: "REJECTED" })).status).toBe(201);
    const state = await (await get(f)).json(); const field = state.fields[0];
    expect(field.authority).toBe("CURRENT"); expect(field.latest).toMatchObject({ revision: 2, decision: "REJECTED", professionalValue: null });
    expect(field.history[1]).toEqual(created.decision);
    expect(JSON.stringify(state)).not.toMatch(/ownerUserId|reviewedByUserId|"id"/);
  });
  it("bounds newest-first history at 10 and never falls back when latest is stale", async () => {
    const f = await fixture(); const input = await body(f);
    for (let revision = 0; revision < 12; revision++) await submit(f.owner, { ...input, draftId: f.draft.id, field: "elevation", expectedRevision: revision, note: `Review ${revision}` });
    let field = (await review(f.owner, f.draft.id)).fields[0];
    expect(field.history.map(row => row.revision)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]); expect(field.historyTruncated).toBe(true);
    const changed = await prisma.professionalLearningDraft.update({ where: { id: f.draft.id }, data: { extraction: { elevation: observed(ELEVATION_OPTIONS[1]) } } });
    await post(f, await body({ ...f, draft: changed }));
    await prisma.professionalLearningDraft.update({ where: { id: f.draft.id }, data: { extraction: f.draft.extraction as Prisma.InputJsonObject } });
    field = (await review(f.owner, f.draft.id)).fields[0];
    expect(field).toMatchObject({ latestRevision: 13, authority: "STALE", staleReason: "OBSERVATION_DIGEST_MISMATCH", actions: { canSubmit: true }, latest: { revision: 13, professionalValue: ELEVATION_OPTIONS[1] } });
  });
  it("returns lifecycle-blocked drafts read-only with no submission actions", async () => {
    const f = await fixture(); await post(f, await body(f));
    await prisma.professionalLearningDraft.update({ where: { id: f.draft.id }, data: { status: "REJECTED" } });
    const response = await get(f); expect(response.status).toBe(200); const state = await response.json();
    expect(state.lifecycle).toEqual({ open: false, blockedBy: "DRAFT_NOT_APPROVED" });
    for (const field of state.fields) expect(field.actions).toMatchObject({ canSubmit: false, blockedReason: "DRAFT_NOT_APPROVED" });
    expect(state.fields[0]).toMatchObject({ authority: "STALE", staleReason: "DRAFT_NOT_APPROVED", latestRevision: 1 });
  });
  it("fails closed on unapproved semantic drift", async () => {
    const f = await fixture(); await post(f, await body(f)); const real = governance.getProfessionalFieldSpecification;
    vi.spyOn(governance, "getProfessionalFieldSpecification").mockImplementation(field => ({ ...real(field), normalization: "DRIFT" }));
    expect((await review(f.owner, f.draft.id)).fields[0]).toMatchObject({ authority: "STALE", staleReason: "SPEC_VERSION_CHANGED", actions: { canSubmit: false, blockedReason: "SPEC_VERSION_CHANGED" } });
  });
  it("foreign and nonexistent drafts are byte-equivalent for both methods", async () => {
    const a = await fixture(); const input = await body(a); const b = await fixture(); mocks.auth.mockResolvedValue({ id: a.owner });
    for (const method of ["GET", "POST"]) {
      const responses = [];
      for (const id of [b.draft.id, randomUUID()]) responses.push(method === "GET" ? await get(a, id) : await post(a, input, "elevation", id));
      expect(responses.map(r => r.status)).toEqual([404, 404]);
      expect(await responses[0].text()).toBe(await responses[1].text());
    }
  });
  it("45° Interior requires an explicit canonical elevation correction", async () => {
    const f = await fixture({ elevation: observed("45° Interior"), sectioning: observed(SECTIONING_OPTIONS[0]), guideType: observed(GUIDELINE_OPTIONS[0]) });
    expect((await post(f, await body(f))).status).toBe(400);
    const corrected = await post(f, await body(f, { decision: "CORRECTED", correctedValue: "45_deg_graduation" }));
    expect(corrected.status).toBe(201); expect((await corrected.json()).decision.professionalValue).toBe("45_deg_graduation");
    expect((await post(f, { ...await body(f), field: "cuttingLine" })).status).toBe(400);
    expect((await post(f, await body(f), "cuttingLine")).status).toBe(404);
    for (const field of ["sectioning", "guideType"]) expect((await post(f, await body(f, { decision: "CORRECTED", correctedValue: "45_deg_graduation" }, field), field)).status).toBe(400);
  });
  it.each(["", " \n", "x".repeat(1001), "a\u0000b", "a\u200bb", "a\u2028b", "a\u2029b"])("delegates semantic note rejection to b.1", async note => {
    const f = await fixture(); const response = await post(f, await body(f, { note }));
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: "INVALID_REQUEST" });
  });
  it.each(["UNKNOWN", "REJECTED"])("persists %s with no professional value through HTTP", async decision => {
    const f = await fixture(); const response = await post(f, await body(f, { decision }));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ outcome: "CREATED", decision: { revision: 1, decision, professionalValue: null } });
  });
  it("rejects confirmation of UNCLEAR_MEANING and invalid corrections", async () => {
    const f = await fixture({ elevation: { value: null, source: "UNKNOWN", rawObservation: "unclear angle" } });
    expect((await post(f, await body(f))).status).toBe(400);
    expect((await post(f, await body(f, { decision: "CORRECTED", correctedValue: "not canonical" }))).status).toBe(400);
    expect(await prisma.professionalFieldClaimDecision.count({ where: { ownerUserId: f.owner } })).toBe(0);
  });
  it.each([
    [{ observationDigest: "sha256:wrong" }, "OBSERVATION_DIGEST_MISMATCH"],
    [{ specificationVersion: "wrong" }, "SPEC_VERSION_CHANGED"],
    [{ specificationDigest: "sha256:wrong" }, "SPEC_VERSION_CHANGED"],
  ] as const)("rejects forged pins %j through the actual service", async (extra, error) => {
    const f = await fixture(); const response = await post(f, await body(f, extra));
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ error, refreshRequired: true });
    expect(await prisma.professionalFieldClaimDecision.count({ where: { ownerUserId: f.owner } })).toBe(0);
  });
  it.each(["DRAFT_SUPERSEDED", "EVIDENCE_NOT_ACTIVE", "EVIDENCE_SOURCE_DELETED"])("blocks %s through actual HTTP service", async error => {
    const f = await fixture(); const input = await body(f);
    if (error === "DRAFT_SUPERSEDED") await prisma.professionalLearningDraft.update({ where: { id: f.draft.id }, data: { supersededByDraftId: randomUUID() } });
    else await prisma.professionalLearningEvidence.update({ where: { id: f.evidence.id }, data: { status: error === "EVIDENCE_NOT_ACTIVE" ? "REVOKED" : "DELETED_SOURCE" } });
    const response = await post(f, input); expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error, refreshRequired: true });
  });
  it("persists a valid professional note verbatim through POST and GET", async () => {
    const f = await fixture(); const note = "  Observație românească\n\t✂️  ";
    const response = await post(f, await body(f, { note })); expect(response.status).toBe(201);
    expect((await response.json()).decision.note).toBe(note);
    expect((await (await get(f)).json()).fields[0].latest.note).toBe(note);
  });
  it.each(["duplicate", "competing"])("concurrent %s HTTP POST has one revision and a conflict loser", async kind => {
    const f = await fixture(); const input = await body(f);
    const results = await Promise.all([post(f, input), post(f, { ...input, ...(kind === "competing" ? { decision: "REJECTED" } : {}) })]);
    expect(results.map(result => result.status).sort()).toEqual([201, 409]);
    expect(await results.find(result => result.status === 409)!.json()).toMatchObject({ error: "REVISION_CONFLICT", refreshRequired: true });
    expect(await prisma.professionalFieldClaimDecision.count({ where: { ownerUserId: f.owner } })).toBe(1);
  });
  it("reads all authority and bounded history in one real RepeatableRead snapshot without writes", async () => {
    const f = await fixture(); const input = await body(f);
    const first = await submit(f.owner, { ...input, draftId: f.draft.id, field: "elevation" });
    const queries: Prisma.ProfessionalFieldClaimDecisionFindManyArgs[] = [];
    const replacement = vi.fn(async (work: (tx: Prisma.TransactionClient) => Promise<unknown>, options: { isolationLevel: Prisma.TransactionIsolationLevel }) => {
      return originalTransaction.call(prisma, async tx => {
        const observer = new Proxy(tx, { get(target, key) {
          if (key === "professionalLearningDraft") return new Proxy(target.professionalLearningDraft, { get(delegate, method) {
            if (method !== "findFirst") throw Error("Aggregate attempted unexpected draft operation");
            return async (args: Prisma.ProfessionalLearningDraftFindFirstArgs) => {
              const draft = await delegate.findFirst(args);
              // Separate committed writes AFTER the snapshot's first read.
              await prisma.professionalLearningDraft.update({ where: { id: f.draft.id }, data: { status: "REJECTED", extraction: { elevation: observed(ELEVATION_OPTIONS[1]) } } });
              await prisma.professionalLearningEvidence.update({ where: { id: f.evidence.id }, data: { status: "REVOKED" } });
              await prisma.professionalFieldClaimDecision.create({ data: { ...first.decision, id: randomUUID(), revision: 2, decision: "REJECTED", professionalValue: null } });
              return draft;
            };
          } });
          if (key === "professionalFieldClaimDecision") return new Proxy(target.professionalFieldClaimDecision, { get(delegate, method) {
            if (method !== "findMany") throw Error("Aggregate attempted a decision write or unbounded alternate query");
            return async (args: Prisma.ProfessionalFieldClaimDecisionFindManyArgs) => { queries.push(args); return delegate.findMany(args); };
          } });
          if (key === "professionalLearningEvidence") return new Proxy(target.professionalLearningEvidence, { get(delegate, method) {
            if (method !== "findFirst") throw Error("Aggregate attempted an evidence write");
            return delegate.findFirst.bind(delegate);
          } });
          throw Error(`Unexpected transaction access: ${String(key)}`);
        } });
        return work(observer);
      }, options);
    });
    // This observer intentionally supports only the interactive overload used
    // by the aggregate; the original overloaded client is restored below.
    prisma.$transaction = replacement as unknown as typeof prisma.$transaction;
    const state = await review(f.owner, f.draft.id);
    prisma.$transaction = originalTransaction;
    expect(replacement).toHaveBeenCalledOnce();
    expect(replacement.mock.calls[0][1]).toEqual({ isolationLevel: "RepeatableRead" });
    expect(state.lifecycle).toEqual({ open: true, blockedBy: null });
    expect(state.fields[0]).toMatchObject({ latestRevision: 1, authority: "CURRENT", staleReason: null, review: { candidate: { normalizedValue: ELEVATION_OPTIONS[0], pins: { observationDigest: input.observationDigest, specificationDigest: input.specificationDigest } } }, actions: { canSubmit: true } });
    expect(state.fields[0].history.map(row => row.revision)).toEqual([1]);
    expect(queries).toEqual(["elevation", "sectioning", "guideType"].map(field => ({ where: { ownerUserId: f.owner, draftId: f.draft.id, field }, orderBy: { revision: "desc" }, take: 11 })));
    const after = await review(f.owner, f.draft.id);
    expect(after.lifecycle).toEqual({ open: false, blockedBy: "DRAFT_NOT_APPROVED" });
    expect(after.fields[0].latestRevision).toBe(2);
  });
});
