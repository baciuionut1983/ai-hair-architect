import { randomUUID } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { prisma } from "@/lib/prisma";
import { createLearningEvidence } from "@/lib/professional-learning-evidence-repository";
import { createDraft, findDraftForOwner, transitionDraftStatus } from "@/lib/professional-learning-draft-repository";
import { buildProceduralInterpretation } from "@/lib/professional-learning-video-temporal-to-procedural-adapter";
import { hydrateProceduralDraft, isExpectedProceduralReviewRevision } from "@/lib/professional-learning-procedural-read";
import { GET } from "@/app/api/v1/learning-drafts/[draftId]/route";
import { GET as listGET } from "@/app/api/v1/learning-evidence/[evidenceId]/drafts/route";
import { POST } from "@/app/api/v1/learning-drafts/[draftId]/procedural-review/route";

const auth = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
vi.mock("@/lib/session-request-auth", () => auth);

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners: string[] = [];
const temporalEvidence = {
  observations: [], editGaps: [], sourceDurationSeconds: 20,
  actions: [
    { timeStartSeconds: 0, timeEndSeconds: 3, kind: "COMBING", source: "INFERRED" as const },
    { timeStartSeconds: 4, timeEndSeconds: 7, kind: "CUTTING_ACTION", source: "INFERRED" as const },
    { timeStartSeconds: 8, timeEndSeconds: 11, kind: "COMBING", source: "INFERRED" as const },
  ],
};

async function fixture(status = "APPROVED") {
  const owner = randomUUID(); owners.push(owner);
  await prisma.user.create({ data: { id: owner, email: `${owner}@r1.test`, passwordHash: "test", role: "professional", locale: "en" } });
  auth.authenticateSessionRequest.mockResolvedValue({ id: owner });
  const evidence = await createLearningEvidence(owner, {
    evidenceType: "TEXT", vertical: "hair_cutting", originalText: "Original demonstration",
    provenance: { channel: "typed" }, rightsClassification: "USER_OWNED_OR_AUTHORIZED",
  });
  const draft = await createDraft(owner, randomUUID(), {
    sourceEvidenceId: evidence.id, extractorVersion: "r1-test", discernmentCategory: "PROFESSIONAL_TECHNIQUE",
    comparisonOutcome: "EVIDENCE_FOR_EXISTING", comparedSkillId: null, extraction: {}, conflictDetail: null,
    createdByUserId: owner, temporalEvidence,
  });
  if (status === "APPROVED" || status === "SUPERSEDED") {
    await transitionDraftStatus(owner, draft.id, "READY_FOR_REVIEW");
    await transitionDraftStatus(owner, draft.id, "APPROVED");
  }
  if (status === "REJECTED") {
    await transitionDraftStatus(owner, draft.id, "READY_FOR_REVIEW");
    await transitionDraftStatus(owner, draft.id, "REJECTED");
  }
  if (status === "SUPERSEDED") await transitionDraftStatus(owner, draft.id, "SUPERSEDED");
  return { owner, draft, evidence };
}
function get(id: string) {
  return GET(new Request(`http://localhost/api/v1/learning-drafts/${id}`), { params: Promise.resolve({ draftId: id }) });
}
function post(id: string, revision: unknown, decision = "PROFESSIONALLY_CONFIRMED", extra: object = {}) {
  return POST(new Request(`http://localhost/api/v1/learning-drafts/${id}/procedural-review`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ claimId: "COMBING", decision, expectedProceduralReviewRevision: revision, ...extra }),
  }), { params: Promise.resolve({ draftId: id }) });
}
async function row(id: string) { return prisma.professionalLearningDraft.findUniqueOrThrow({ where: { id } }); }

describe("R1 revision validation and pure server projection", () => {
  it.each([undefined, null, -1, 0.5, "0", {}, [], NaN, Infinity, 2147483647, 2147483648])("rejects malformed/out-of-range revision %s", (value) => {
    expect(isExpectedProceduralReviewRevision(value)).toBe(false);
  });
  it.each([0, 1, 2147483646])("accepts revision %s", (value) => expect(isExpectedProceduralReviewRevision(value)).toBe(true));
  it("hydration has only the existing deterministic adapter as a runtime dependency", () => {
    const source = readFileSync(new URL("./professional-learning-procedural-read.ts", import.meta.url), "utf8");
    const imports = source.split(/\r?\n/).filter((line) => line.startsWith("import ") && !line.startsWith("import type "));
    expect(imports).toHaveLength(1);
    expect(imports[0]).toContain("professional-learning-video-temporal-to-procedural-adapter");
    const adapter = readFileSync(new URL("./professional-learning-video-temporal-to-procedural-adapter.ts", import.meta.url), "utf8");
    expect(adapter).not.toMatch(/from ["'][^"']*(?:prisma|extractor|provider|gemini|assimilation|repository)/i);
  });
  it("the entire hydration runtime dependency graph has no database/provider/activation path", () => {
    const visited = new Set<string>();
    function visit(name: string) {
      if (visited.has(name)) return;
      visited.add(name);
      const source = readFileSync(new URL(`./${name}.ts`, import.meta.url), "utf8");
      for (const match of source.matchAll(/^import(?!\s+type\b)[\s\S]*?from ["']([^"']+)["'];/gm)) {
        const dependency = match[1];
        if (dependency.startsWith("@/lib/")) visit(dependency.slice(6));
        else expect(["crypto", "node:crypto"]).toContain(dependency);
      }
      expect(source).not.toMatch(/\b(?:fetch|prisma|processEvidenceIntoDraft|selectProfessionalLearningExtractor)\s*[.(]/);
    }
    visit("professional-learning-procedural-read");
    expect([...visited]).not.toEqual(expect.arrayContaining(["prisma"]));
    expect(visited.has("professional-learning-video-temporal-to-procedural-adapter")).toBe(true);
  });
});

suite("R1 real PostgreSQL GET/POST contract", () => {
  afterEach(async () => {
    await prisma.professionalLearningDraft.deleteMany({ where: { ownerUserId: { in: owners } } });
    await prisma.professionalLearningEvidence.deleteMany({ where: { ownerUserId: { in: owners } } });
    await prisma.user.deleteMany({ where: { id: { in: owners } } }); owners.length = 0;
  });
  it("reload hydrates all unreviewed claims through the same engine; GET is read-only", async () => {
    const { draft, owner, evidence } = await fixture();
    const before = await row(draft.id);
    const loaded = (await (await get(draft.id)).json()).draft;
    expect(loaded.proceduralReviewRevision).toBe(0);
    expect(loaded.proceduralReview).toBeNull();
    expect(loaded.proceduralInterpretation).toEqual(buildProceduralInterpretation(draft.id, temporalEvidence));
    expect(loaded.reviewableProceduralClaims.map((c: { claimId: string }) => c.claimId)).toEqual(["COMBING", "CUTTING_ACTION"]);
    const listed = await listGET(new Request("http://localhost"), { params: Promise.resolve({ evidenceId: evidence.id }) });
    expect((await listed.json()).drafts[0]).toEqual(loaded);
    expect(await row(draft.id)).toEqual(before);
    for (const claim of loaded.reviewableProceduralClaims) {
      const response = await post(draft.id, (await row(draft.id)).proceduralReviewRevision, "PROFESSIONALLY_CONFIRMED", { claimId: claim.claimId });
      expect(response.status).toBe(200);
      expect((await response.json()).draft.proceduralReview.claims[claim.claimId].originalValue).toEqual(claim.originalValue);
    }
    const refreshed = (await (await get(draft.id)).json()).draft;
    expect(refreshed.reviewableProceduralClaims).toEqual(loaded.reviewableProceduralClaims);
    expect(refreshed.proceduralInterpretation).toEqual(loaded.proceduralInterpretation);
    expect(hydrateProceduralDraft((await findDraftForOwner(owner, draft.id))!)).toEqual(refreshed);
  });
  it("A and B read N; B writes; stale A conflicts; refetched A intentionally writes N+1", async () => {
    const { draft } = await fixture();
    const a = (await (await get(draft.id)).json()).draft;
    const b = (await (await get(draft.id)).json()).draft;
    expect((await post(draft.id, b.proceduralReviewRevision)).status).toBe(200);
    const storedB = await row(draft.id);
    const stale = await post(draft.id, a.proceduralReviewRevision, "PROFESSIONALLY_REJECTED");
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toBe("CONCURRENT_MODIFICATION");
    expect(await row(draft.id)).toEqual(storedB);
    const refetched = (await (await get(draft.id)).json()).draft;
    expect(refetched.proceduralReviewRevision).toBe(1);
    const intentional = await post(draft.id, refetched.proceduralReviewRevision, "PROFESSIONALLY_REJECTED");
    expect(intentional.status).toBe(200);
    expect((await intentional.json()).draft.proceduralReviewRevision).toBe(2);
  });
  it("five pairs of concurrent conflicting writers each have exactly one winner", async () => {
    const { draft } = await fixture();
    for (let revision = 0; revision < 5; revision++) {
      const responses = await Promise.all([
        post(draft.id, revision, "PROFESSIONALLY_CORRECTED", { correctedValue: `A${revision}` }),
        post(draft.id, revision, "PROFESSIONALLY_CORRECTED", { correctedValue: `B${revision}` }),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
      const winner = (await responses.find((r) => r.status === 200)!.json()).draft;
      const persisted = await row(draft.id);
      expect(persisted.proceduralReviewRevision).toBe(revision + 1);
      expect(persisted.proceduralReview).toEqual(winner.proceduralReview);
    }
  });
  it("lost-response identical stale retry conflicts; current-revision identical retry is a no-op", async () => {
    const { draft } = await fixture();
    expect((await post(draft.id, 0, "PROFESSIONALLY_CORRECTED", { correctedValue: "Professional correction" })).status).toBe(200);
    const first = await row(draft.id);
    expect((await post(draft.id, 0, "PROFESSIONALLY_CORRECTED", { correctedValue: "Professional correction" })).status).toBe(409);
    expect((await post(draft.id, 0, "PROFESSIONALLY_REJECTED")).status).toBe(409);
    expect((await post(draft.id, 1, "PROFESSIONALLY_CORRECTED", { correctedValue: "Professional correction" })).status).toBe(200);
    expect(await row(draft.id)).toEqual(first);
  });
  it("unrelated lifecycle writes preserve professional review and revision", async () => {
    const { draft } = await fixture();
    expect((await post(draft.id, 0)).status).toBe(200);
    const before = await row(draft.id);
    await transitionDraftStatus(before.ownerUserId, draft.id, "SUPERSEDED");
    const after = await row(draft.id);
    expect(after.proceduralReview).toEqual(before.proceduralReview);
    expect(after.proceduralReviewRevision).toBe(1);
    expect((await post(draft.id, 1, "PROFESSIONALLY_REJECTED")).status).toBe(409);
    expect(await row(draft.id)).toEqual(after);
  });
  it.each([undefined, null, -1, 0.5, "0", {}, [], 2147483647])("invalid revision %s returns 400 without writes", async (revision) => {
    const { draft } = await fixture(); const before = await row(draft.id);
    expect((await post(draft.id, revision)).status).toBe(400);
    expect(await row(draft.id)).toEqual(before);
  });
  it.each(["DRAFT", "REJECTED", "SUPERSEDED"])("%s lifecycle blocks review without increment", async (status) => {
    const { draft } = await fixture(status); const before = await row(draft.id);
    expect((await post(draft.id, 0)).status).toBe(409);
    expect(await row(draft.id)).toEqual(before);
  });
  it.each(["__proto__", "constructor", "FABRICATED", "PROGRESSION", "ZONE_COMPLETE"])("invalid claim %s returns 404, never 500 or write", async (claimId) => {
    const { draft } = await fixture(); const before = await row(draft.id);
    expect((await post(draft.id, 0, "PROFESSIONALLY_CONFIRMED", { claimId })).status).toBe(404);
    expect(await row(draft.id)).toEqual(before);
  });
  it("invalid decision/correction, 401 and cross-owner revision do not authorize or increment", async () => {
    const { draft, owner } = await fixture(); const before = await row(draft.id);
    expect((await post(draft.id, 0, "MADE_UP")).status).toBe(400);
    expect((await post(draft.id, 0, "PROFESSIONALLY_CORRECTED", { correctedValue: " " })).status).toBe(400);
    auth.authenticateSessionRequest.mockResolvedValue(null);
    expect((await post(draft.id, 0)).status).toBe(401);
    expect((await get(draft.id)).status).toBe(401);
    const other = await fixture();
    expect((await post(draft.id, 0, "PROFESSIONALLY_CONFIRMED", { ownerUserId: owner, reviewedByUserId: owner })).status).toBe(404);
    expect((await get(draft.id)).status).toBe(404);
    expect(await row(draft.id)).toEqual(before);
    expect((await row(other.draft.id)).proceduralReviewRevision).toBe(0);
  });
  it("only Layer 3 and normal updatedAt change; evidence, AI and identities remain intact", async () => {
    const { draft, evidence, owner } = await fixture();
    const before = await row(draft.id);
    const evidenceBefore = await prisma.professionalLearningEvidence.findUniqueOrThrow({ where: { id: evidence.id } });
    const aiBefore = (await (await get(draft.id)).json()).draft.proceduralInterpretation;
    const response = await post(draft.id, 0, "PROFESSIONALLY_CORRECTED", { correctedValue: "45° Interior", reviewedByUserId: "spoof", ownerUserId: "spoof" });
    expect(response.status).toBe(200);
    const after = await row(draft.id);
    expect({ ...after, proceduralReview: before.proceduralReview, proceduralReviewRevision: before.proceduralReviewRevision, updatedAt: before.updatedAt }).toEqual(before);
    expect(await prisma.professionalLearningEvidence.findUniqueOrThrow({ where: { id: evidence.id } })).toEqual(evidenceBefore);
    const loaded = (await (await get(draft.id)).json()).draft;
    expect(loaded.proceduralInterpretation).toEqual(aiBefore);
    expect(loaded.proceduralReview.claims.COMBING.reviewedByUserId).toBe(owner);
    expect((await row(draft.id)).proceduralReviewRevision).toBe(1);
  });
});
