import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProceduralReviewSection } from "./teach-ai-procedural-review-section";
import type { ProceduralClaimReviewDecision, ProceduralClaimReviewEntry } from "@/lib/professional-learning-procedural-review-validators";
import { canEditClaim, canReanalyze, claimView, createReviewController, mergeReview, reviewCopy } from "./teach-ai-procedural-review-logic";
import type { LearningDraft } from "./teach-ai-procedural-review-types";

function fixture(status = "APPROVED", revision = 7): LearningDraft {
  return { id: "draft-1", status, discernmentCategory: "PROFESSIONAL_TECHNIQUE", comparisonOutcome: "INSUFFICIENT_INFORMATION", comparedSkillId: null, extraction: {}, temporalEvidence: null, conflictDetail: null,
    proceduralInterpretation: { orderedActions: [], repetitionByKind: {}, zoneCompletionByKind: { COMBING: "UNKNOWN" }, coreChainSummary: { PROGRESSION: "UNKNOWN" } },
    reviewableProceduralClaims: [{ claimId: "server-opaque-id", claimType: "PROCEDURAL_PATTERN", originalValue: { kind: "COMBING", occurrenceCount: 3 }, originalProvenance: "INFERRED" }, { claimId: "second-id", claimType: "PROCEDURAL_PATTERN", originalValue: { kind: "CUTTING_ACTION", occurrenceCount: 2 }, originalProvenance: "INFERRED" }],
    proceduralReview: null, proceduralReviewRevision: revision };
}
function entry(decision: ProceduralClaimReviewDecision): ProceduralClaimReviewEntry {
  return { claimId: "server-opaque-id", claimType: "PROCEDURAL_PATTERN", originalValue: { kind: "COMBING", occurrenceCount: 3 }, originalProvenance: "INFERRED", decision, ...(decision === "PROFESSIONALLY_CORRECTED" ? { correctedValue: "Două apariții clare" } : {}), reviewedAt: "2026-09-19T00:00:00Z", reviewedByUserId: "server-session-user" };
}
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function harness(draft = fixture()) {
  const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
  fetcher.mockResolvedValueOnce(response({ status: "already_processed", draft: { id: draft.id } })).mockResolvedValueOnce(response({ draft }));
  const controller = createReviewController(fetcher, vi.fn());
  return { fetcher, controller, load: () => controller.analyze("evidence-1") };
}
function partialUpdate(decision: ProceduralClaimReviewDecision, revision = 8) {
  return { id: "draft-1", proceduralReviewRevision: revision, proceduralReview: { claims: { "server-opaque-id": entry(decision) } } };
}

describe("procedural claim presentation", () => {
  it("renders reviewed correction separately and hides mutation actions until explicit edit", () => {
    const draft = { ...fixture(), ...partialUpdate("PROFESSIONALLY_CORRECTED") };
    // Use one reviewed card so an unreviewed sibling cannot mask hidden controls.
    draft.reviewableProceduralClaims = draft.reviewableProceduralClaims.slice(0, 1);
    const html = renderToStaticMarkup(createElement(ProceduralReviewSection, { draft, locked: false, saving: false, save: vi.fn() }));
    expect(html).toContain("Pieptănare: 3 apariții în material.");
    expect(html).toContain("Două apariții clare");
    expect(html).toContain(reviewCopy.edit);
    expect(html).not.toContain(">Confirmă<");
    expect(html).not.toContain(">Corectează<");
  });
  it.each(["DRAFT", "REJECTED", "SUPERSEDED"])("renders %s read-only without mutation buttons", status => {
    const html = renderToStaticMarkup(createElement(ProceduralReviewSection, { draft: fixture(status), locked: false, saving: false, save: vi.fn() }));
    expect(html).toContain("Pieptănare"); expect(html).not.toContain("<button");
  });
  it("renders phone-safe actions and a disabled whole-surface fieldset during save", () => {
    const html = renderToStaticMarkup(createElement(ProceduralReviewSection, { draft: fixture(), locked: true, saving: true, save: vi.fn() }));
    expect(html).toContain("grid-cols-1"); expect(html).toContain("sm:grid-cols-2");
    expect(html).toContain('<fieldset disabled=""'); expect(html).toContain(reviewCopy.saving);
    for (const label of Object.values(reviewCopy.actions)) expect(html).toContain(label);
  });
  it("uses server IDs/content only, with no cards derived from displayed progression", () => {
    const draft = fixture();
    const cards = draft.reviewableProceduralClaims.map(claim => claimView(claim, draft.proceduralReview));
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ claimId: "server-opaque-id", aiStatement: "Pieptănare: 3 apariții în material." });
    expect(cards.some(card => card.claimId === "PROGRESSION")).toBe(false);
  });
  it.each(Object.keys(reviewCopy.results) as ProceduralClaimReviewDecision[])("maps %s as a separate professional result", decision => {
    const draft = fixture();
    const before = claimView(draft.reviewableProceduralClaims[0], null);
    const after = claimView(draft.reviewableProceduralClaims[0], { claims: { "server-opaque-id": entry(decision) } });
    expect(after.aiStatement).toBe(before.aiStatement);
    expect(after.professionalResult).toBe(reviewCopy.results[decision]);
    expect(after.correctedValue).toBe(decision === "PROFESSIONALLY_CORRECTED" ? "Două apariții clare" : undefined);
  });
  it("requires explicit edit for a reviewed claim, with UNKNOWN equally complete", () => {
    expect(canEditClaim("APPROVED", true, false, false)).toBe(false);
    expect(canEditClaim("APPROVED", true, true, false)).toBe(true);
    expect(reviewCopy.results.PROFESSIONALLY_UNKNOWN).not.toMatch(/eroare|eșec|incomplet/i);
  });
  it.each(["DRAFT", "READY_FOR_REVIEW", "REJECTED", "SUPERSEDED", "REANALYZING"])("disables claim mutation in %s", status => {
    expect(canEditClaim(status, false, true, false)).toBe(false);
  });
  it("allows approved claims but disables the entire surface during any save", () => {
    expect(canEditClaim("APPROVED", false, false, false)).toBe(true);
    expect(canEditClaim("APPROVED", false, false, true)).toBe(false);
    expect(canEditClaim("APPROVED", true, true, true)).toBe(false);
  });
  it("merges only review authority and preserves both hydration fields", () => {
    const draft = fixture();
    const merged = mergeReview(draft, partialUpdate("PROFESSIONALLY_CORRECTED"));
    expect(merged.reviewableProceduralClaims).toBe(draft.reviewableProceduralClaims);
    expect(merged.proceduralInterpretation).toBe(draft.proceduralInterpretation);
    expect(merged.proceduralReviewRevision).toBe(8);
    expect(claimView(merged.reviewableProceduralClaims[0], merged.proceduralReview).correctedValue).toBe("Două apariții clare");
  });
});

describe("request sequencing and concurrency", () => {
  it("does no mount requests; Analyze POSTs directly without a draft-list GET or client version authority", async () => {
    const { fetcher, controller, load } = harness();
    expect(fetcher).not.toHaveBeenCalled();
    await load();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]).toEqual(["/api/v1/learning-evidence/evidence-1/drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "ANALYZE" }) }]);
    expect(fetcher.mock.calls[1]).toEqual(["/api/v1/learning-drafts/draft-1", { cache: "no-store" }]);
    expect(controller.getState().draft?.status).toBe("APPROVED");
  });
  it.each(["DRAFT", "APPROVED", "REJECTED", "SUPERSEDED", "REANALYZING"])("hydrates the server-selected current %s draft without selecting history", async status => {
    const { fetcher, controller, load } = harness(fixture(status)); await load();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(controller.getState().draft?.status).toBe(status);
  });
  it.each(["DRAFT", "APPROVED"])("historical approved draft cannot short-circuit POST selecting current %s", async status => {
    const historical = { ...fixture(), id: "historical" };
    const current = { ...fixture(status, 0), id: "current" };
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/drafts")) return response(init?.method === "POST" ? { status: "already_processed", draft: { id: current.id } } : { drafts: [historical] });
      return response({ draft: current });
    });
    const controller = createReviewController(fetcher, vi.fn());
    await controller.analyze("evidence-1");
    expect(fetcher.mock.calls[0][1]?.method).toBe("POST");
    expect(controller.getState().draft).toEqual(current);
    expect(historical.id).toBe("historical");
  });
  it("hydrates the exact newly created draft returned by POST", async () => {
    const { fetcher, controller, load } = harness();
    fetcher.mockReset().mockResolvedValueOnce(response({ status: "created", draft: { id: "draft-1" } }, 201)).mockResolvedValueOnce(response({ draft: fixture("DRAFT") }));
    await load();
    expect(controller.getState().draft?.status).toBe("DRAFT");
    expect(controller.getState().draft?.reviewableProceduralClaims).toHaveLength(2);
  });
  it.each([401, 404, 500])("POST failure %s fails safely without fallback or retry", async status => {
    const { fetcher, controller, load } = harness();
    fetcher.mockReset().mockResolvedValueOnce(response({}, status)); await load();
    expect(fetcher).toHaveBeenCalledTimes(1); expect(controller.getState().error).toBeTruthy();
    expect(controller.getState().draft).toBeNull(); expect(controller.getState().busy).toBe(false);
  });
  it.each([{}, { drafts: [fixture()] }, { draft: {} }, null])("malformed POST result %j fails closed", async body => {
    const { fetcher, controller, load } = harness(); fetcher.mockReset().mockResolvedValueOnce(response(body));
    await load(); expect(fetcher).toHaveBeenCalledTimes(1); expect(controller.getState().draft).toBeNull(); expect(controller.getState().error).toBeTruthy();
  });
  it("malformed or mismatched hydration cannot display another draft", async () => {
    for (const draft of [{ id: "draft-1" }, { ...fixture(), id: "different" }]) {
      const { fetcher, controller, load } = harness();
      fetcher.mockReset().mockResolvedValueOnce(response({ draft: { id: "draft-1" } })).mockResolvedValueOnce(response({ draft }));
      await load(); expect(controller.getState()).toMatchObject({ draft: null, refreshRequired: true });
      expect(controller.getState().error).toBeTruthy();
    }
  });
  it("ordinary double-click starts only one POST while pending", async () => {
    const { fetcher, controller, load } = harness();
    let finish!: (response: Response) => void;
    fetcher.mockReset().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(response({ draft: fixture("DRAFT") }));
    const pending = load(); await load();
    expect(controller.getState().busy).toBe(true); expect(fetcher).toHaveBeenCalledTimes(1);
    finish(response({ draft: { id: "draft-1" } })); await pending;
    expect(controller.getState().busy).toBe(false);
  });
  it("repeated completed Analyze uses the same idempotent mode and hydrates the server result", async () => {
    const { fetcher, controller, load } = harness(fixture("DRAFT")); await load();
    fetcher.mockResolvedValueOnce(response({ status: "already_processed", draft: { id: "draft-1" } })).mockResolvedValueOnce(response({ draft: fixture("DRAFT") }));
    await load();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(init!.body as string))).toEqual([{ mode: "ANALYZE" }, { mode: "ANALYZE" }]);
    expect(controller.getState().draft?.status).toBe("DRAFT");
  });
  it("aborted request clears busy and surfaces an error without an automatic retry", async () => {
    const { fetcher, controller, load } = harness();
    fetcher.mockReset().mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));
    await load(); expect(controller.getState()).toMatchObject({ busy: false, draft: null });
    expect(controller.getState().error).toBeTruthy(); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("server skip displays its reason without hydration", async () => {
    const { fetcher, controller, load } = harness();
    fetcher.mockReset().mockResolvedValueOnce(response({ status: "skipped", reason: "EVIDENCE_NOT_ACTIVE" }));
    await load(); expect(fetcher).toHaveBeenCalledTimes(1); expect(controller.getState().skipped).toBe("EVIDENCE_NOT_ACTIVE");
  });
  it.each(Object.keys(reviewCopy.actions) as ProceduralClaimReviewDecision[])("submits %s with revision N; next request uses N+1", async decision => {
    const { fetcher, controller, load } = harness(); await load();
    fetcher.mockResolvedValueOnce(response({ draft: partialUpdate(decision) })).mockResolvedValueOnce(response({ draft: partialUpdate("PROFESSIONALLY_UNKNOWN", 9) }));
    expect(await controller.save("server-opaque-id", decision, "Două apariții clare")).toBe(true);
    const payload = JSON.parse(fetcher.mock.calls[2][1]!.body as string);
    expect(payload).toEqual({ claimId: "server-opaque-id", decision, expectedProceduralReviewRevision: 7, ...(decision === "PROFESSIONALLY_CORRECTED" ? { correctedValue: "Două apariții clare" } : {}) });
    expect(controller.getState().draft?.proceduralReviewRevision).toBe(8);
    await controller.save("second-id", "PROFESSIONALLY_UNKNOWN");
    expect(JSON.parse(fetcher.mock.calls[3][1]!.body as string).expectedProceduralReviewRevision).toBe(8);
    expect(controller.getState().draft?.reviewableProceduralClaims).toHaveLength(2);
  });
  it("blocks rapid double submission and sibling submission synchronously", async () => {
    const { fetcher, controller, load } = harness(); await load();
    let finish!: (response: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = controller.save("server-opaque-id", "PROFESSIONALLY_CONFIRMED");
    expect(controller.getState().busy).toBe(true);
    expect(await controller.save("second-id", "PROFESSIONALLY_UNKNOWN")).toBe(false);
    expect(await controller.save("server-opaque-id", "PROFESSIONALLY_CONFIRMED")).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(3);
    finish(response({ draft: partialUpdate("PROFESSIONALLY_CONFIRMED") })); await first;
    expect(controller.getState().busy).toBe(false);
  });
  it("stale 409 refetches B's decision, clears editors, and never retries A", async () => {
    const { fetcher, controller, load } = harness(); await load();
    const latest = { ...fixture(), ...partialUpdate("PROFESSIONALLY_UNKNOWN") };
    fetcher.mockResolvedValueOnce(response({ error: "CONCURRENT_MODIFICATION" }, 409)).mockResolvedValueOnce(response({ draft: latest }));
    expect(await controller.save("server-opaque-id", "PROFESSIONALLY_CONFIRMED")).toBe(false);
    expect(controller.getState()).toMatchObject({ draft: latest, notice: reviewCopy.stale, error: null, refreshRequired: false });
    expect(controller.getState().editEpoch).toBeGreaterThan(0);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
  });
  it("failed conflict refresh locks writes until an explicit successful refresh", async () => {
    const { fetcher, controller, load } = harness(); await load();
    fetcher.mockResolvedValueOnce(response({ error: "CONCURRENT_MODIFICATION" }, 409)).mockRejectedValueOnce(new Error("network"));
    await controller.save("server-opaque-id", "PROFESSIONALLY_CONFIRMED");
    expect(controller.getState().refreshRequired).toBe(true);
    expect(await controller.save("second-id", "PROFESSIONALLY_UNKNOWN")).toBe(false);
    fetcher.mockResolvedValueOnce(response({ draft: fixture("APPROVED", 8) })); await controller.refresh();
    expect(controller.getState().refreshRequired).toBe(false);
    expect(controller.getState().draft?.proceduralReviewRevision).toBe(8);
  });
  it.each([400, 401, 500])("save failure %s preserves draft and editor epoch", async status => {
    const { fetcher, controller, load } = harness(); await load(); const before = controller.getState();
    fetcher.mockResolvedValueOnce(response({}, status));
    expect(await controller.save("server-opaque-id", "PROFESSIONALLY_CORRECTED", "Typed correction")).toBe(false);
    expect(controller.getState().draft).toBe(before.draft);
    expect(controller.getState().editEpoch).toBe(before.editEpoch);
    expect(controller.getState().error).toBe(status === 400 ? reviewCopy.invalid : status === 401 ? reviewCopy.session : reviewCopy.failed);
  });
  it("requires non-empty correction and refuses reconstructed IDs", async () => {
    const { fetcher, controller, load } = harness(); await load();
    expect(await controller.save("server-opaque-id", "PROFESSIONALLY_CORRECTED", "  ")).toBe(false);
    expect(await controller.save("COMBING", "PROFESSIONALLY_CONFIRMED")).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("whole draft lifecycle", () => {
  it.each(["APPROVED", "REJECTED"] as const)("one action sequences DRAFT → READY_FOR_REVIEW → %s → GET", async decision => {
    const { fetcher, controller, load } = harness(fixture("DRAFT")); await load();
    fetcher.mockResolvedValueOnce(response({ draft: { id: "draft-1", status: "READY_FOR_REVIEW" } })).mockResolvedValueOnce(response({ draft: { id: "draft-1", status: decision } })).mockResolvedValueOnce(response({ draft: fixture(decision) }));
    await controller.review(decision);
    expect(fetcher.mock.calls.slice(2).map(([url]) => url)).toEqual(["/api/v1/learning-drafts/draft-1/ready-for-review", "/api/v1/learning-drafts/draft-1/review", "/api/v1/learning-drafts/draft-1"]);
    expect(controller.getState().draft?.status).toBe(decision);
    expect(controller.getState().draft?.reviewableProceduralClaims).toHaveLength(2);
  });
  it("partial approval failure shows authoritative READY state, never fake approval", async () => {
    const { fetcher, controller, load } = harness(fixture("DRAFT")); await load();
    fetcher.mockResolvedValueOnce(response({ draft: { id: "draft-1", status: "READY_FOR_REVIEW" } })).mockResolvedValueOnce(response({}, 500)).mockResolvedValueOnce(response({ draft: fixture("READY_FOR_REVIEW") }));
    await controller.review("APPROVED");
    expect(controller.getState().draft?.status).toBe("READY_FOR_REVIEW"); expect(controller.getState().error).toBeTruthy();
  });
  it("failed post-approval hydration keeps confirmed approval but disables claims until refresh", async () => {
    const { fetcher, controller, load } = harness(fixture("READY_FOR_REVIEW")); await load();
    fetcher.mockResolvedValueOnce(response({ draft: { id: "draft-1", status: "APPROVED" } })).mockResolvedValueOnce(response({}, 503)).mockResolvedValueOnce(response({}, 503));
    await controller.review("APPROVED");
    expect(controller.getState()).toMatchObject({ refreshRequired: true, draft: { status: "APPROVED" } });
    expect(await controller.save("server-opaque-id", "PROFESSIONALLY_CONFIRMED")).toBe(false);
    fetcher.mockResolvedValueOnce(response({ draft: fixture() })); await controller.refresh();
    expect(controller.getState().draft?.reviewableProceduralClaims).toHaveLength(2);
    expect(controller.getState().refreshRequired).toBe(false);
  });
  it("lifecycle 409 differs from a stale revision and refreshes to read-only history", async () => {
    const { fetcher, controller, load } = harness(); await load();
    fetcher.mockResolvedValueOnce(response({ error: "DRAFT_NOT_APPROVED" }, 409)).mockResolvedValueOnce(response({ draft: fixture("SUPERSEDED") }));
    await controller.save("server-opaque-id", "PROFESSIONALLY_CONFIRMED");
    expect(controller.getState()).toMatchObject({ error: reviewCopy.lifecycle, notice: null, draft: { status: "SUPERSEDED" } });
  });
  it("ready transition failure does not attempt approval and refetches", async () => {
    const { fetcher, controller, load } = harness(fixture("DRAFT")); await load();
    fetcher.mockResolvedValueOnce(response({}, 409)).mockResolvedValueOnce(response({ draft: fixture("DRAFT") }));
    await controller.review("APPROVED");
    expect(fetcher.mock.calls.some(([url]) => url.endsWith("/review"))).toBe(false);
    expect(controller.getState().draft?.status).toBe("DRAFT");
  });
  it.each(["APPROVED", "REJECTED", "SUPERSEDED", "REANALYZING"])("never reanalyzes %s", async status => {
    expect(canReanalyze(status)).toBe(false);
    const { fetcher, controller, load } = harness(fixture(status)); await load(); await controller.analyze("evidence-1");
    expect(fetcher).toHaveBeenCalledTimes(2);
    if (status !== "APPROVED") expect(await controller.save("server-opaque-id", "PROFESSIONALLY_CONFIRMED")).toBe(false);
  });
  it("repeated Analyze stays idempotent and keeps current content pending and on failure", async () => {
    const { fetcher, controller, load } = harness(fixture("DRAFT")); await load(); const draft = controller.getState().draft;
    let finish!: (response: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = controller.analyze("evidence-1"); expect(controller.getState().draft).toBe(draft);
    expect(JSON.parse(fetcher.mock.calls[2][1]!.body as string)).toEqual({ mode: "ANALYZE" });
    finish(response({}, 500)); await pending;
    expect(controller.getState().draft).toBe(draft); expect(controller.getState().error).toBeTruthy();
  });
  it("frontend has no reasoning/provider/activation imports and renders only server claim cards", () => {
    const logic = readFileSync("src/components/consultation/teach-ai-procedural-review-logic.ts", "utf8");
    const section = readFileSync("src/components/consultation/teach-ai-procedural-review-section.tsx", "utf8");
    expect(logic + section).not.toMatch(/buildProceduralInterpretation|from ["'].*(?:gemini|provider|skill-registry|assimilation|execution-plan|knowledge)/i);
    expect(section).toContain("draft.reviewableProceduralClaims.map");
    expect(section).not.toContain("JSON.stringify");
  });
});
