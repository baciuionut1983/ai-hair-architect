import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import type { readProfessionalFieldDecisionReview } from "@/lib/professional-field-claim-decision-service";
import { getProfessionalFieldSpecification } from "@/lib/professional-field-specification-governance";
import { ProfessionalFieldReviewSection, ProfessionalFieldReviewView } from "./teach-ai-professional-field-review-section";
import { createFieldReviewController, decisionPayload, emptyForm, fieldKey, initialFieldReviewView, mountsFieldReview, reconcileForms, type FieldReviewView } from "./teach-ai-professional-field-review-logic";
import { copyFor, en, ro, englishValues, romanianValues, valueLabel, errorCopy } from "./teach-ai-professional-field-review-labels";
import { isReviewDto, type FieldDto, type ReviewDto, type ReviewField } from "./teach-ai-professional-field-review-types";

// Compile witness: the real server aggregate must stay assignable to this mirror.
type Compatible = Awaited<ReturnType<typeof readProfessionalFieldDecisionReview>> extends ReviewDto ? true : false;
const compatible: Compatible = true;
export function fieldFixture(field: ReviewField = "elevation", patch: Partial<FieldDto> = {}): FieldDto {
  const values = englishValues[field].map(v => v.value);
  return { field, review: { reviewable: true, candidate: { resolution: "CANONICAL", normalizedValue: values[0], observation: { value: values[0], source: "OBSERVED", confidence: 0.8 }, pins: { observationDigest: "opaque-observation", observationDigestVersion: "opaque-observation-version", specificationDigest: "opaque-specification", specificationVersion: "opaque-version" } } },
    specification: { version: "opaque-version", digest: "opaque-specification", allowedValues: values }, latestRevision: 0, authority: "NONE", latest: null, staleReason: null,
    actions: { canSubmit: true, allowedDecisions: ["CONFIRMED", "CORRECTED", "UNKNOWN", "REJECTED"] }, history: [], historyTruncated: false, ...patch };
}
const aggregate = (fields = [fieldFixture()]): ReviewDto => ({ draftId: "draft", lifecycle: { open: true, blockedBy: null }, fields });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const deferred = () => { let resolve!: (response: Response) => void; const promise = new Promise<Response>(r => { resolve = r; }); return { promise, resolve }; };
function harness(data = aggregate()) {
  const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>().mockImplementation(async () => response(data));
  const publish = vi.fn();
  const controller = createFieldReviewController("draft", fetcher, publish);
  return { fetcher, controller, publish };
}
function markup(fields = [fieldFixture()], patch: Partial<FieldReviewView> = {}, language = "en", readOnly = false) {
  const view = { ...initialFieldReviewView, data: aggregate(fields), forms: reconcileForms(fields, {}), ...patch };
  return renderToStaticMarkup(createElement(ProfessionalFieldReviewView, { view, language, readOnly, controller: { edit: vi.fn(), save: vi.fn(), refresh: vi.fn() } }));
}
const row = (revision = 3) => ({ field: "elevation", revision, decision: "CORRECTED", professionalValue: "45_deg_graduation", note: "  Professional\nnote  ", createdAt: "2026-09-20T10:00:00.000Z" });
function unresolved(): FieldDto {
  const f = fieldFixture();
  if (!f.review.reviewable) throw Error();
  return { ...f, review: { reviewable: true, candidate: { ...f.review.candidate, resolution: "UNRESOLVED_TEXT", normalizedValue: null, observation: { value: "45° Interior", source: "OBSERVED" } } }, actions: { canSubmit: true, allowedDecisions: ["CORRECTED", "UNKNOWN", "REJECTED"] } };
}

describe("professional field review presentation and contract", () => {
  it("mirrors the actual server response type and guards the wire shape", () => { expect(compatible).toBe(true); expect(isReviewDto(aggregate())).toBe(true); expect(isReviewDto({ fields: [] })).toBe(false); });
  it.each([null, {}, { ...aggregate(), fields: [fieldFixture(), fieldFixture()] }, "not an aggregate"])("rejects malformed aggregate %j", value => { expect(isReviewDto(value)).toBe(false); });
  it("renders canonical observation and interpretation", () => { expect(markup()).toContain("Canonical interpretation: 0° blunt"); expect(markup()).toContain(en.NONE); });
  it("45° Interior remains only AI text without confirmation or interpretation or default correction", () => {
    const f = unresolved(); const html = markup([f]);
    expect(html).toContain("45° Interior"); expect(html).not.toContain("Canonical interpretation"); expect(html).not.toContain('value="CONFIRMED"'); expect(html).not.toContain("45° graduation"); expect(html).not.toContain("<select");
    expect(decisionPayload(f, emptyForm(f))).toBeNull();
    const form = { ...emptyForm(f), decision: "CORRECTED" as const };
    expect(decisionPayload(f, form)).toBeNull();
    const correcting = markup([f], { forms: { elevation: form } });
    expect(correcting).toContain('value="" selected=""'); expect(correcting).toContain(en.judgment);
    expect(decisionPayload(f, { ...form, correctedValue: "45_deg_graduation" })?.correctedValue).toBe("45_deg_graduation");
  });
  it("renders unclear meaning from raw observation without canonical interpretation", () => {
    const f = unresolved(); if (!f.review.reviewable) throw Error();
    const html = markup([{ ...f, review: { reviewable: true, candidate: { ...f.review.candidate, resolution: "UNCLEAR_MEANING", observation: { value: null, rawObservation: "unclear source", source: "UNKNOWN" } } } }]);
    expect(html).toContain("unclear source"); expect(html).not.toContain("Canonical interpretation");
  });
  it("uses raw observation in the primary card when the extracted value is blank", () => {
    const f = unresolved(); if (!f.review.reviewable) throw Error();
    const html = markup([{ ...f, review: { reviewable: true, candidate: { ...f.review.candidate, observation: { value: "", rawObservation: "preserved original", source: "UNKNOWN" } } } }]);
    expect(html.indexOf("preserved original")).toBeLessThan(html.indexOf("<details"));
  });
  it("accepts raw-only wire observations whose undefined value was omitted by JSON", () => {
    const f = unresolved(); if (!f.review.reviewable) throw Error();
    const wire = JSON.parse(JSON.stringify(aggregate([{ ...f, review: { reviewable: true, candidate: { ...f.review.candidate, resolution: "UNCLEAR_MEANING", observation: { source: "UNKNOWN", rawObservation: "preserved original" } } } }])));
    expect(isReviewDto(wire)).toBe(true);
    expect(markup(wire.fields)).toContain("preserved original");
  });
  it.each(["ABSENT", "EXTRACTION_UNKNOWN", "NO_OBSERVATION", "INVALID_OBSERVATION"] as const)("renders %s informationally without decisions", reason => {
    const html = markup([fieldFixture("elevation", { review: { reviewable: false, reason } }), fieldFixture("guideType")]);
    expect(html).toContain(en[reason]); expect((html.match(/<fieldset/g) ?? []).length).toBe(1);
  });
  it("collapses all nonreviewable fields into one summary", () => { const html = markup([fieldFixture("elevation", { review: { reviewable: false, reason: "ABSENT" } })]); expect(html).toContain(en.empty); expect(html).not.toContain("<article"); });
  it.each(["CURRENT", "STALE"] as const)("renders %s latest decision, value, note and date", authority => {
    const html = markup([fieldFixture("elevation", { authority, latest: row(), latestRevision: 3, history: [row(1), row(3)], historyTruncated: true })]);
    expect(html).toContain(en[authority]); expect(html).toContain("45° graduation"); expect(html).toContain("Professional\nnote"); expect(html).toContain("2026-09-20"); expect(html).toContain(en.older);
    if (authority === "STALE") { expect(html).toContain(en.staleLatest); expect(html).not.toContain(en.CURRENT); }
    expect(html.indexOf("Revision 3")).toBeLessThan(html.indexOf("Revision 1")); expect(html).not.toContain("<details open");
  });
  it("blocked lifecycle keeps candidate, latest and history without controls", () => {
    const html = markup([fieldFixture("elevation", { latest: row(), history: [row()], authority: "STALE", actions: { canSubmit: false, blockedReason: "DRAFT_SUPERSEDED", allowedDecisions: ["CORRECTED"] } })]);
    expect(html).toContain(en.superseded); expect(html).toContain(en.history); expect(html).toContain(en.ai); expect(html).not.toContain("<fieldset");
    expect(markup([fieldFixture()], {}, "en", true)).not.toContain("<fieldset");
  });
  it("escapes AI and professional text, preserving whitespace and direction", () => {
    const f = unresolved(); if (!f.review.reviewable) throw Error();
    const attack = '<img src=x onerror="alert(1)">';
    const html = markup([{ ...f, latest: { ...row(), note: attack }, review: { reviewable: true, candidate: { ...f.review.candidate, observation: { value: attack, source: attack, rawObservation: attack } } } }]);
    expect(html).not.toContain("<img"); expect(html).toContain("&lt;img"); expect(html).toContain('dir="auto"'); expect(html).toContain("whitespace-pre-wrap");
  });
  it("renders exactly the server actions and only the field's canonical values", () => {
    const f = fieldFixture("sectioning", { actions: { canSubmit: true, allowedDecisions: ["CORRECTED", "REJECTED"] } });
    const html = markup([f], { forms: { sectioning: { ...emptyForm(f), decision: "CORRECTED" } } });
    expect((html.match(/type="radio"/g) ?? []).length).toBe(2); expect(html).not.toContain('value="CONFIRMED"');
    for (const token of f.specification.allowedValues) expect(html).toContain(`value="${token}"`);
    expect(html).not.toContain('value="45_deg_graduation"'); expect(decisionPayload(f, { ...emptyForm(f), decision: "CORRECTED", correctedValue: "45_deg_graduation" })).toBeNull();
  });
  it.each(["DRAFT", "READY_FOR_REVIEW", "REANALYZING", "REJECTED"])("does not mount %s", status => { expect(mountsFieldReview(status)).toBe(false); expect(renderToStaticMarkup(createElement(ProfessionalFieldReviewSection, { draftId: "draft", status }))).toBe(""); });
  it.each(["APPROVED", "SUPERSEDED"])("mounts %s", status => expect(mountsFieldReview(status)).toBe(true));
  it("uses matching local copy keys and English fallback", () => { expect(Object.keys(ro).sort()).toEqual(Object.keys(en).sort()); expect(copyFor("ro")).toBe(ro); expect(copyFor("fr")).toBe(en); expect(markup(undefined, {}, "ro")).toContain(ro.heading); });
  it.each(["elevation", "sectioning", "guideType"] as const)("labels every governed %s token without altering canonical values", field => {
    const governed = [...getProfessionalFieldSpecification(field).allowedValues].sort();
    expect(englishValues[field].map(v => v.value).sort()).toEqual(governed); expect(Object.keys(romanianValues[field]).sort()).toEqual(governed);
    for (const token of governed) { expect(valueLabel(field, token, "ro")).toBeTruthy(); expect(valueLabel(field, token, "en")).toBe(englishValues[field].find(v => v.value === token)?.label); }
  });
  it("keeps future canonical values visible and submits exact token", () => { const f = fieldFixture("elevation", { specification: { version: "v", digest: "d", allowedValues: ["future_token"] } }); expect(valueLabel("elevation", "future_token", "en")).toBe("future token"); expect(decisionPayload(f, { ...emptyForm(f), decision: "CORRECTED", correctedValue: "future_token" })?.correctedValue).toBe("future_token"); });
  it("uses labelled single-column touch controls, status and collapsed history", () => {
    const html = markup(); for (const text of ["grid-cols-1", "min-w-0", "overflow-wrap:anywhere", "min-h-11", "<fieldset", "<legend", "<label", "<textarea", 'maxLength="1000"', "aria-describedby", "<details"]) expect(html.toLowerCase()).toContain(text.toLowerCase());
    expect(html).not.toContain("<table"); expect(html).not.toContain("opaque-");
    expect(markup(undefined, { loading: true })).toContain('role="status"');
    expect(markup(undefined, { error: "temporary" })).toContain(en.retry);
  });
});

describe("professional review controller", () => {
  it.each([
    ["REVISION_CONFLICT", "changed"], ["OBSERVATION_DIGEST_MISMATCH", "observationChanged"], ["SPEC_VERSION_CHANGED", "specificationChanged"],
    ["DRAFT_SUPERSEDED", "superseded"], ["DRAFT_NOT_APPROVED", "notApproved"], ["EVIDENCE_NOT_ACTIVE", "sourceUnavailable"], ["EVIDENCE_SOURCE_DELETED", "sourceUnavailable"],
  ])("maps %s to friendly local copy", (code, expected) => expect(errorCopy(409, code)).toBe(expected));
  it("read-only controller cannot POST even if the supplied GET allows actions", async () => {
    const fetcher = vi.fn(async () => response(aggregate())); const c = createFieldReviewController("draft", fetcher, vi.fn(), true);
    await c.refresh(); c.edit("elevation", { decision: "UNKNOWN" }); await c.save("elevation"); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("unmount aborts a pending POST and does not refetch on its late response", async () => {
    const h = harness(); await h.controller.refresh(); h.controller.edit("elevation", { decision: "UNKNOWN" }); const pending = deferred(); h.fetcher.mockReturnValueOnce(pending.promise);
    const save = h.controller.save("elevation"); h.controller.dispose(); const calls = h.publish.mock.calls.length; pending.resolve(response({}, 201)); await save;
    expect(h.fetcher).toHaveBeenCalledTimes(2); expect(h.fetcher.mock.calls[1][1]?.signal?.aborted).toBe(true); expect(h.publish).toHaveBeenCalledTimes(calls);
  });
  it("per-field pending rendering disables only that card", () => {
    const html = markup([fieldFixture(), fieldFixture("sectioning")], { pending: { elevation: true } });
    expect((html.match(/<fieldset disabled=""/g) ?? []).length).toBe(1); expect((html.match(/<fieldset/g) ?? []).length).toBe(2);
  });
  it("GET uses no-store and abort signal", async () => { const h = harness(); await h.controller.refresh(); expect(h.fetcher.mock.calls[0]).toEqual(["/api/v1/learning-drafts/draft/professional-field-decisions", { cache: "no-store", signal: expect.any(AbortSignal) }]); });
  it.each([200, 201])("POST %i refetches with exact server pins, no optimistic authority", async status => {
    const h = harness(); await h.controller.refresh(); h.controller.edit("elevation", { decision: "UNKNOWN", note: "  keep\nspaces  " });
    const pending = deferred(); h.fetcher.mockResolvedValueOnce(response({ outcome: status === 201 ? "CREATED" : "UNCHANGED" }, status)).mockReturnValueOnce(pending.promise);
    const saving = h.controller.save("elevation"); await vi.waitFor(() => expect(h.fetcher).toHaveBeenCalledTimes(3));
    expect(h.controller.getState().data?.fields[0].authority).toBe("NONE");
    const init = h.fetcher.mock.calls[1][1]!; expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({ expectedRevision: 0, observationDigest: "opaque-observation", specificationVersion: "opaque-version", specificationDigest: "opaque-specification", decision: "UNKNOWN", note: "  keep\nspaces  " });
    pending.resolve(response(aggregate([fieldFixture("elevation", { latest: row(), latestRevision: 3, authority: "CURRENT" })]))); await saving;
    expect(h.controller.getState().data?.fields[0].authority).toBe("CURRENT"); expect(h.controller.getState().forms.elevation?.decision).toBe("");
  });
  it("409 refreshRequired shows change, clears local choices and never automatically retries", async () => {
    const h = harness(); await h.controller.refresh(); h.controller.edit("elevation", { decision: "CORRECTED" }); h.controller.edit("elevation", { correctedValue: "45_deg_graduation", note: "old" });
    h.fetcher.mockResolvedValueOnce(response({ error: "REVISION_CONFLICT", refreshRequired: true }, 409)); await h.controller.save("elevation");
    expect(h.fetcher).toHaveBeenCalledTimes(3); expect(h.controller.getState().notices.elevation).toBe("changed"); expect(h.controller.getState().forms.elevation).toEqual(emptyForm(fieldFixture()));
  });
  it.each([400, 401, 403, 404, 413, 415, 429, 500, 503])("%i gives friendly errors, preserves input and does not refetch", async status => {
    const h = harness(); await h.controller.refresh(); h.controller.edit("elevation", { decision: "UNKNOWN", note: "unchanged" }); const before = h.controller.getState().forms.elevation;
    h.fetcher.mockResolvedValueOnce(response({ error: "<secret backend stack>" }, status)); await h.controller.save("elevation");
    expect(h.fetcher).toHaveBeenCalledTimes(2); expect(h.controller.getState().forms.elevation).toEqual(before); expect(h.controller.getState().errors.elevation).toBe(errorCopy(status));
  });
  it("blocks duplicate clicks synchronously and permits another field to save", async () => {
    const h = harness(aggregate([fieldFixture(), fieldFixture("guideType")])); await h.controller.refresh();
    h.controller.edit("elevation", { decision: "UNKNOWN" }); h.controller.edit("guideType", { decision: "REJECTED" });
    const a = deferred(); const b = deferred(); h.fetcher.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const first = h.controller.save("elevation"); const duplicate = h.controller.save("elevation");
    expect(h.controller.getState().pending).toEqual({ elevation: true }); const second = h.controller.save("guideType");
    expect(h.fetcher).toHaveBeenCalledTimes(3); expect(h.controller.getState().pending.guideType).toBe(true);
    a.resolve(response({}, 400)); b.resolve(response({}, 400)); await Promise.all([first, duplicate, second]);
  });
  it("ignores older GET response and aborts it", async () => {
    const h = harness(); const old = deferred(); const newer = deferred(); h.fetcher.mockReturnValueOnce(old.promise).mockReturnValueOnce(newer.promise);
    const a = h.controller.refresh(); const b = h.controller.refresh(); expect(h.fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    newer.resolve(response(aggregate([fieldFixture("elevation", { latestRevision: 8 })]))); await b; old.resolve(response(aggregate())); await a;
    expect(h.controller.getState().data?.fields[0].latestRevision).toBe(8);
  });
  it("unmount aborts and ignores late responses", async () => { const h = harness(); const pending = deferred(); h.fetcher.mockReturnValueOnce(pending.promise); const load = h.controller.refresh(); h.controller.dispose(); const count = h.publish.mock.calls.length; pending.resolve(response(aggregate())); await load; expect(h.publish).toHaveBeenCalledTimes(count); expect(h.fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true); });
  it("failed post-confirmation refresh locks only that field until reload", async () => { const h = harness(); await h.controller.refresh(); h.controller.edit("elevation", { decision: "UNKNOWN" }); h.fetcher.mockResolvedValueOnce(response({}, 201)).mockResolvedValueOnce(response({}, 503)); await h.controller.save("elevation"); expect(h.controller.getState().needsRefresh.elevation).toBe(true); await h.controller.save("elevation"); expect(h.fetcher).toHaveBeenCalledTimes(3); await h.controller.refresh(); expect(h.controller.getState().needsRefresh.elevation).toBeUndefined(); });
  it("preserves same-key input across another card's refetch", async () => { const h = harness(); await h.controller.refresh(); h.controller.edit("elevation", { decision: "UNKNOWN", note: "unsaved" }); await h.controller.refresh(); expect(h.controller.getState().forms.elevation?.note).toBe("unsaved"); });
  it.each(["field", "observationDigest", "specificationDigest", "latestRevision"])("resets changed %s and never carries corrected values", key => {
    const f = fieldFixture(); const changed = structuredClone(f); if (!changed.review.reviewable) throw Error();
    const mutable = changed as unknown as { field: ReviewField; latestRevision: number; review: { candidate: { pins: { observationDigest: string; specificationDigest: string } } } };
    if (key === "field") mutable.field = "guideType"; if (key === "latestRevision") mutable.latestRevision = 1; if (key === "specificationDigest") mutable.review.candidate.pins.specificationDigest = "changed"; if (key === "observationDigest") mutable.review.candidate.pins.observationDigest = "changed";
    expect(fieldKey(changed)).not.toBe(fieldKey(f)); const result = reconcileForms([changed], { elevation: { ...emptyForm(f), decision: "CORRECTED", correctedValue: "45_deg_graduation", note: "old" } });
    expect(result[changed.field]).toMatchObject({ decision: "", correctedValue: "", note: "" });
  });
  it("stale re-review starts empty and blocked or disallowed payloads fail closed", () => { const f = fieldFixture("elevation", { authority: "STALE", latest: row(), latestRevision: 3 }); expect(emptyForm(f).decision).toBe(""); expect(emptyForm(f).note).toBe(""); expect(decisionPayload({ ...f, actions: { canSubmit: false, allowedDecisions: ["UNKNOWN"] } }, { ...emptyForm(f), decision: "UNKNOWN" })).toBeNull(); expect(decisionPayload(unresolved(), { ...emptyForm(unresolved()), decision: "CONFIRMED" })).toBeNull(); });
  it("omits empty note, rejects whitespace/overlength, never submits presentation labels", () => { const f = fieldFixture(); expect(decisionPayload(f, { ...emptyForm(f), decision: "UNKNOWN" })).not.toHaveProperty("note"); for (const note of ["  ", "x".repeat(1001)]) expect(decisionPayload(f, { ...emptyForm(f), decision: "UNKNOWN", note })).toBeNull(); expect(decisionPayload(f, { ...emptyForm(f), decision: "CORRECTED", correctedValue: "45° graduation" })).toBeNull(); });
});

describe("UI structural security and integration", () => {
  const files = ["types.ts", "logic.ts", "labels.ts", "section.tsx"].map(suffix => readFileSync(`src/components/consultation/teach-ai-professional-field-review-${suffix}`, "utf8"));
  it("introduces no HTML execution, authority persistence, forged identity or downstream runtime", () => {
    const source = files.join("\n");
    for (const forbidden of ["dangerouslySetInnerHTML", "innerHTML", "localStorage", "sessionStorage", "ownerUserId", "reviewedByUserId", "actorUserId", "node:crypto", "@prisma", "professional-field-review-candidates", "professional-field-specification-governance", "professional-field-claim-decision-service", "owner-knowledge-eligibility", "professional-brain", "prepareReasoningRequestPackage", "ExecutionPlan", "skill-selector", "provider", "photo-preview", "result-video"]) expect(source).not.toContain(forbidden);
    expect(source).not.toMatch(/URLSearchParams|window\.location|\.searchParams/);
  });
  it("mounts before the independent procedural review and adds no page or lifecycle", () => { const source = readFileSync("src/components/consultation/teach-ai-learning-draft-review.tsx", "utf8"); expect(source.indexOf("<ProfessionalFieldReviewSection")).toBeLessThan(source.indexOf("<ProceduralReviewSection")); for (const forbidden of ["Review complete", "Activate knowledge", "Use in Brain", "restore", "deleteDecision"]) expect(files.join("\n")).not.toContain(forbidden); });
});
