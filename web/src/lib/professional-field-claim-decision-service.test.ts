import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { submitProfessionalFieldClaimDecision as submit, readProfessionalFieldClaimDecisions as read } from "@/lib/professional-field-claim-decision-service";
import { deriveProfessionalFieldReviewCandidates as derive, OBSERVATION_DIGEST_VERSION } from "@/lib/professional-field-review-candidates";
import * as governance from "@/lib/professional-field-specification-governance";
import { ELEVATION_OPTIONS, SECTIONING_OPTIONS, GUIDELINE_OPTIONS } from "@/lib/proposal-validators";
import type { StructuredProfessionalField } from "@/lib/structured-professional-field-claims";

// Fail rather than silently skip or ever exercise a non-local/non-test DB.
const database = new URL(process.env.DATABASE_URL ?? "postgresql://missing/missing");
if (!["localhost", "127.0.0.1"].includes(database.hostname) || database.pathname !== "/ai_hair_architect_test") throw new Error("b.1 requires the established local test database");
const owners: string[] = [];
const originalTransaction = prisma.$transaction;
const observed = (value: string) => ({ value, source: "OBSERVED" });
async function fixture(extraction: Prisma.InputJsonObject = { elevation: observed(ELEVATION_OPTIONS[0]) }) {
  const owner = randomUUID(); owners.push(owner);
  await prisma.user.create({ data: { id: owner, email: `${owner}@b1.test`, passwordHash: "test", role: "professional", locale: "en" } });
  const evidence = await prisma.professionalLearningEvidence.create({ data: { ownerUserId: owner, evidenceType: "TEXT", vertical: "hair_cutting", originalText: "Synthetic professional teaching", provenance: { channel: "test" }, rightsClassification: "USER_OWNED_OR_AUTHORIZED", createdByUserId: owner } });
  const draft = await prisma.professionalLearningDraft.create({ data: { ownerUserId: owner, sourceEvidenceId: evidence.id, extractorVersion: "b1-test-v1", status: "APPROVED", discernmentCategory: "PROFESSIONAL_TECHNIQUE", comparisonOutcome: "POSSIBLE_NEW_SKILL", extraction, createdByUserId: owner } });
  return { owner, draft, evidence };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function request(f: Fixture, extra: Record<string, unknown> = {}, field: StructuredProfessionalField = "elevation") {
  const result = derive(f.draft, [field]);
  if (!result.ok || !result.candidates[0]) throw Error("invalid test candidate");
  const candidate = result.candidates[0];
  return { draftId: f.draft.id, expectedRevision: 0, observationDigest: candidate.observationDigest,
    ...governance.pinProfessionalFieldSpecification(governance.getProfessionalFieldSpecification(field)), decision: "CONFIRMED", ...extra };
}
async function rejected(f: Fixture, input: unknown, code = "INVALID_DECISION_REQUEST") {
  await expect(submit(f.owner, input)).rejects.toMatchObject({ code, httpStatus: code === "INVALID_DECISION_REQUEST" ? 400 : 409 });
  expect(await prisma.professionalFieldClaimDecision.count({ where: { ownerUserId: f.owner } })).toBe(0);
}
afterEach(async () => {
  vi.restoreAllMocks();
  prisma.$transaction = originalTransaction;
  const where = { ownerUserId: { in: owners } };
  await prisma.professionalFieldClaimDecision.deleteMany({ where });
  await prisma.professionalLearningDraft.deleteMany({ where });
  await prisma.professionalLearningEvidence.deleteMany({ where });
  await prisma.captureSetImage.deleteMany({ where });
  await prisma.captureSet.deleteMany({ where });
  await prisma.imageAsset.deleteMany({ where });
  await prisma.videoAsset.deleteMany({ where });
  await prisma.client.deleteMany({ where });
  await prisma.user.deleteMany({ where: { id: { in: owners.splice(0) } } });
});

describe("b.1 append-only decisions in local Postgres", () => {
  it("creates revisions, preserves prior rows and source bytes, and reads ordered history", async () => {
    const f = await fixture(); const input = request(f);
    expect(await read(f.owner, f.draft.id, "elevation")).toEqual({ latest: null, staleReason: null, history: [] });
    const first = await submit(f.owner, input);
    expect(first).toMatchObject({ outcome: "CREATED", httpStatus: 201, decision: { revision: 1, professionalValue: ELEVATION_OPTIONS[0], reviewedByUserId: f.owner, candidateResolution: "CANONICAL", observationDigestVersion: OBSERVATION_DIGEST_VERSION } });
    const second = await submit(f.owner, { ...input, expectedRevision: 1, decision: "CORRECTED", correctedValue: ELEVATION_OPTIONS[1] });
    expect(second.decision.revision).toBe(2);
    expect(await read(f.owner, f.draft.id, "elevation")).toEqual({ latest: second.decision, staleReason: null, history: [first.decision, second.decision] });
    expect(await prisma.professionalLearningDraft.findUnique({ where: { id: f.draft.id } })).toEqual(f.draft);
    expect(await prisma.professionalLearningEvidence.findUnique({ where: { id: f.evidence.id } })).toEqual(f.evidence);
  });
  it.each([["elevation", ELEVATION_OPTIONS], ["sectioning", SECTIONING_OPTIONS], ["guideType", GUIDELINE_OPTIONS]] as const)("uses only server canonical %s values and semantic pins", async (field, values) => {
    const f = await fixture({ [field]: observed(values[0]) });
    const input = request(f, {}, field);
    const result = await submit(f.owner, input);
    expect(result.decision).toMatchObject({ field, professionalValue: values[0], specificationVersion: input.specificationVersion, specificationDigest: input.specificationDigest, observationDigest: input.observationDigest });
    expect(Object.keys(result.decision)).not.toContain("implementationFingerprint");
    const correction = await submit(f.owner, request(f, { decision: "CORRECTED", correctedValue: values[1], expectedRevision: 1 }, field));
    expect(correction.decision.professionalValue).toBe(values[1]);
  });
  it.each(["UNRESOLVED_TEXT", "UNCLEAR_MEANING"])("requires explicit correction for %s and never infers 45° Interior elevation", async resolution => {
    const f = await fixture({ elevation: resolution === "UNCLEAR_MEANING" ? { value: null, source: "UNKNOWN", rawObservation: "45° Interior" } : observed("45° Interior") });
    await rejected(f, request(f));
    const corrected = await submit(f.owner, request(f, { decision: "CORRECTED", correctedValue: ELEVATION_OPTIONS[1] }));
    expect(corrected.decision).toMatchObject({ candidateResolution: resolution, professionalValue: ELEVATION_OPTIONS[1] });
    expect((await prisma.professionalLearningDraft.findUniqueOrThrow({ where: { id: f.draft.id } })).extraction).toEqual(f.draft.extraction);
  });
  it("does not derive elevation from technique or cutting line", async () => {
    const f = await fixture({ techniqueCandidate: observed("45° Interior"), cuttingLine: observed("45_deg_graduation") });
    await rejected(f, { ...governance.pinProfessionalFieldSpecification(governance.getProfessionalFieldSpecification("elevation")), draftId: f.draft.id, expectedRevision: 0, decision: "CONFIRMED", observationDigest: "sha256:fake" }, "OBSERVATION_DIGEST_MISMATCH");
  });
  it.each([
    { decision: "CORRECTED", correctedValue: "invalid" },
    { decision: "CORRECTED", correctedValue: SECTIONING_OPTIONS[0] },
    { decision: "CORRECTED", correctedValue: ELEVATION_OPTIONS[0] },
    { decision: "CONFIRMED", correctedValue: ELEVATION_OPTIONS[1] },
    { decision: "UNKNOWN", correctedValue: ELEVATION_OPTIONS[1] },
    { decision: "REJECTED", correctedValue: ELEVATION_OPTIONS[1] },
    { decision: "INVALID" }, { professionalValue: ELEVATION_OPTIONS[1] },
    { candidateResolution: "CANONICAL" }, { ownerUserId: "other" }, { reviewedByUserId: "other" },
    { specification: {} }, { allowedValues: ["forged"] }, { expectedRevision: -1 }, { expectedRevision: 0.5 },
  ])("rejects invalid decisions/authority %j", async extra => {
    const f = await fixture(); await rejected(f, request(f, extra));
  });
  it.each(["__proto__", "toString", "cuttingLine", null])("guards unsupported field %j before governance lookup", async field => {
    const f = await fixture(); const input = request(f, { field });
    const getter = vi.spyOn(governance, "getProfessionalFieldSpecification");
    await rejected(f, input);
    await expect(read(f.owner, f.draft.id, field)).rejects.toMatchObject({ code: "INVALID_DECISION_REQUEST" });
    expect(getter).not.toHaveBeenCalled();
  });
  it("keeps UNKNOWN, REJECTED and unreviewed distinct with null values", async () => {
    const f = await fixture(); expect((await read(f.owner, f.draft.id, "elevation")).latest).toBeNull();
    const unknown = await submit(f.owner, request(f, { decision: "UNKNOWN" }));
    const reject = await submit(f.owner, request(f, { expectedRevision: 1, decision: "REJECTED" }));
    expect([unknown.decision, reject.decision].map(row => [row.decision, row.professionalValue])).toEqual([["UNKNOWN", null], ["REJECTED", null]]);
  });
  it.each([{ specificationVersion: "wrong" }, { specificationDigest: "sha256:wrong" }, { observationDigest: "sha256:wrong" }])("conflicts for stale caller pins %j", async extra => {
    const f = await fixture(); await rejected(f, request(f, extra), "observationDigest" in extra ? "OBSERVATION_DIGEST_MISMATCH" : "SPEC_VERSION_CHANGED");
  });
  it("uses default approved goldens and fails closed for unapproved semantic drift", async () => {
    const f = await fixture(); const input = request(f);
    await submit(f.owner, input);
    const real = governance.getProfessionalFieldSpecification;
    vi.spyOn(governance, "getProfessionalFieldSpecification").mockImplementation(field => ({ ...real(field), normalization: "UNAPPROVED_DRIFT" }));
    await expect(submit(f.owner, { ...input, expectedRevision: 1 })).rejects.toMatchObject({ code: "SPEC_VERSION_CHANGED" });
    expect((await read(f.owner, f.draft.id, "elevation")).staleReason).toBe("SPEC_VERSION_CHANGED");
  });
  it("applies R1: current identical no-op; stale identical/different conflict; current changed appends", async () => {
    const f = await fixture(); const input = request(f); const first = await submit(f.owner, input);
    expect(await submit(f.owner, { ...input, expectedRevision: 1 })).toEqual({ outcome: "UNCHANGED", httpStatus: 200, decision: first.decision });
    for (const decision of ["CONFIRMED", "UNKNOWN"]) await expect(submit(f.owner, { ...input, decision })).rejects.toMatchObject({ code: "REVISION_CONFLICT", httpStatus: 409 });
    expect(await prisma.professionalFieldClaimDecision.count({ where: { ownerUserId: f.owner } })).toBe(1);
    const next = await submit(f.owner, { ...input, expectedRevision: 1, note: "Reviewed again" });
    expect(next.decision.revision).toBe(2);
  });
  it("never leaks another owner's draft or history through read/write errors", async () => {
    const a = await fixture(); const b = await fixture(); await submit(b.owner, request(b));
    for (const id of [b.draft.id, randomUUID()]) {
      await expect(read(a.owner, id, "elevation")).rejects.toMatchObject({ message: "DRAFT_NOT_FOUND", code: "DRAFT_NOT_FOUND", httpStatus: 404 });
      await expect(submit(a.owner, { ...request(a), draftId: id })).rejects.toMatchObject({ message: "DRAFT_NOT_FOUND", code: "DRAFT_NOT_FOUND", httpStatus: 404 });
    }
  });
  it.each(["DRAFT", "READY_FOR_REVIEW", "REJECTED", "INVALID", "SUPERSEDED"])("gates draft lifecycle %s on write/read", async status => {
    const f = await fixture(); const input = request(f); await submit(f.owner, input);
    await prisma.professionalLearningDraft.update({ where: { id: f.draft.id }, data: { status } });
    const code = status === "SUPERSEDED" ? "DRAFT_SUPERSEDED" : "DRAFT_NOT_APPROVED";
    await expect(submit(f.owner, { ...input, expectedRevision: 1 })).rejects.toMatchObject({ code });
    expect((await read(f.owner, f.draft.id, "elevation")).staleReason).toBe(code);
  });
  it("detects supersession pointer even with APPROVED status", async () => {
    const f = await fixture(); await prisma.professionalLearningDraft.update({ where: { id: f.draft.id }, data: { supersededByDraftId: randomUUID() } });
    await rejected(f, request(f), "DRAFT_SUPERSEDED");
  });
  it.each([
    [{ status: "REVOKED" }, "EVIDENCE_NOT_ACTIVE"], [{ revokedAt: new Date() }, "EVIDENCE_NOT_ACTIVE"],
    [{ visibilityScope: "PUBLIC" }, "EVIDENCE_NOT_ACTIVE"], [{ status: "DELETED_SOURCE" }, "EVIDENCE_SOURCE_DELETED"],
    [{ sourceMediaDeletedAt: new Date() }, "EVIDENCE_SOURCE_DELETED"],
  ] as const)("gates evidence %j", async (data, code) => {
    const f = await fixture(); await prisma.professionalLearningEvidence.update({ where: { id: f.evidence.id }, data });
    await rejected(f, request(f), code);
  });
  it("owner-scopes soft evidence links and missing evidence", async () => {
    const a = await fixture(); const b = await fixture();
    for (const sourceEvidenceId of [b.evidence.id, randomUUID()]) {
      await prisma.professionalLearningDraft.update({ where: { id: a.draft.id }, data: { sourceEvidenceId, extractorVersion: randomUUID() } });
      await rejected(a, request(a), "EVIDENCE_NOT_ACTIVE");
    }
  });
  it.each(["IMAGE", "VIDEO", "IMAGE_SET"])("checks %s DB assets/client deletion without storage I/O", async kind => {
    const f = await fixture(); const client = await prisma.client.create({ data: { ownerUserId: f.owner, fullName: "b1 synthetic" } });
    const image = await prisma.imageAsset.create({ data: { ownerUserId: f.owner, clientId: client.id, fileName: "missing.png", storagePath: "no-such-file", mimeType: "image/png", sizeBytes: 1 } });
    const video = await prisma.videoAsset.create({ data: { ownerUserId: f.owner, clientId: client.id, storagePath: "no-such-file", mimeType: "video/mp4", sizeBytes: 1, origin: "uploaded_source" } });
    const set = await prisma.captureSet.create({ data: { ownerUserId: f.owner, clientId: client.id, captureSetVersion: 1, purpose: "PROFESSIONAL_LEARNING_SET", images: { create: { imageAssetId: image.id, viewLabel: "FRONT", ordinalPosition: 1 } } } });
    await prisma.professionalLearningEvidence.update({ where: { id: f.evidence.id }, data: { evidenceType: kind, imageAssetId: kind === "IMAGE" ? image.id : null, videoAssetId: kind === "VIDEO" ? video.id : null, captureSetId: kind === "IMAGE_SET" ? set.id : null } });
    const input = request(f); await submit(f.owner, input); // No real object exists.
    await prisma.client.update({ where: { id: client.id }, data: { deletedAt: new Date() } });
    await expect(submit(f.owner, { ...input, expectedRevision: 1 })).rejects.toMatchObject({ code: "EVIDENCE_SOURCE_DELETED" });
    await prisma.client.update({ where: { id: client.id }, data: { deletedAt: null } });
    if (kind === "VIDEO") await prisma.videoAsset.update({ where: { id: video.id }, data: { deletedAt: new Date() } });
    else await prisma.imageAsset.update({ where: { id: image.id }, data: { deletedAt: new Date() } });
    expect((await read(f.owner, f.draft.id, "elevation")).staleReason).toBe("EVIDENCE_SOURCE_DELETED");
  });
  it("latest stale never falls back to an older valid revision", async () => {
    const f = await fixture(); const original = request(f); const first = await submit(f.owner, original);
    const changed = await prisma.professionalLearningDraft.update({ where: { id: f.draft.id }, data: { extraction: { elevation: observed(ELEVATION_OPTIONS[1]) } } });
    const second = await submit(f.owner, request({ ...f, draft: changed }, { expectedRevision: 1 }));
    await prisma.professionalLearningDraft.update({ where: { id: f.draft.id }, data: { extraction: f.draft.extraction as Prisma.InputJsonObject } });
    const state = await read(f.owner, f.draft.id, "elevation");
    expect(state).toEqual({ latest: second.decision, staleReason: "OBSERVATION_DIGEST_MISMATCH", history: [first.decision, second.decision] });
    expect(state.history[0].observationDigest).toBe(original.observationDigest);
  });
  it.each([
    [{ specificationVersion: "future" }, "SPEC_VERSION_CHANGED"], [{ specificationDigest: "sha256:future" }, "SPEC_VERSION_CHANGED"],
    [{ professionalValue: "not-canonical" }, "VALUE_NOT_IN_CURRENT_SPEC"], [{ observationDigestVersion: "future-v2" }, "OBSERVATION_DIGEST_MISMATCH"],
  ] as const)("retains latest history but detects historical drift %j", async (change, reason) => {
    const f = await fixture(); const first = await submit(f.owner, request(f));
    // Direct synthetic historical row: service deliberately exposes no mutation API.
    const row = await prisma.professionalFieldClaimDecision.create({ data: { ...first.decision, id: randomUUID(), revision: 2, ...change } });
    expect(await read(f.owner, f.draft.id, "elevation")).toMatchObject({ latest: row, staleReason: reason });
  });
  it.each(["", " \t\n", "x".repeat(1001), "a\u0000b", "a\u2028b", "a\u2029b", "a\u200bb", null])("reuses note rejection policy %j", async note => {
    const f = await fixture(); await rejected(f, request(f, { note }));
  });
  it.each([undefined, "Observație românească\n\t✂️", "x".repeat(1000)])("preserves valid notes %j exactly", async note => {
    const f = await fixture(); const row = await submit(f.owner, request(f, note === undefined ? {} : { note }));
    expect(row.decision.note).toBe(note ?? null);
  });
  it("preserves b.0 Unicode and whitespace digest distinctions through persistence", async () => {
    const f = await fixture({ elevation: { ...observed(ELEVATION_OPTIONS[0]), note: "é " } });
    const input = request(f); const first = await submit(f.owner, input);
    expect(first.decision.observationDigest).toBe(input.observationDigest);
    for (const note of ["é", "e\u0301 "]) {
      await prisma.professionalLearningDraft.update({ where: { id: f.draft.id }, data: { extraction: { elevation: { ...observed(ELEVATION_OPTIONS[0]), note } } } });
      await expect(submit(f.owner, { ...input, expectedRevision: 1 })).rejects.toMatchObject({ code: "OBSERVATION_DIGEST_MISMATCH" });
    }
  });
  it("locks the existing observation digest regression fixture", () => {
    const result = derive({ id: "draft-1", sourceEvidenceId: "evidence-1", extractorVersion: "extractor-1", extraction: { elevation: observed("45_deg_graduation") } });
    expect(result.ok && result.candidates[0].observationDigest).toBe("sha256:4c105ff02c4eef2aac2da9bd7c6f07d49144749a311b2a80c3b978e145d07b74");
  });
  it("a real concurrent first revision has one winner and one conflict", async () => {
    const f = await fixture(); const input = request(f);
    const results = await Promise.allSettled([submit(f.owner, input), submit(f.owner, input)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "REVISION_CONFLICT", httpStatus: 409 } });
    expect(await prisma.professionalFieldClaimDecision.count({ where: { ownerUserId: f.owner } })).toBe(1);
  });
  it.each(["P2002", "P2034"])("maps %s deterministically and does not retry", async code => {
    const f = await fixture(); const input = request(f);
    const transaction = vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("synthetic conflict", { code, clientVersion: "6.12.0" }));
    await expect(submit(f.owner, input)).rejects.toMatchObject({ code: "REVISION_CONFLICT", httpStatus: 409 });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0][1]).toEqual({ isolationLevel: "RepeatableRead" });
  });
  it("database enforces unique revisions and composite draft ownership", async () => {
    const a = await fixture(); const b = await fixture(); const first = await submit(a.owner, request(a));
    await expect(prisma.professionalFieldClaimDecision.create({ data: { ...first.decision, id: randomUUID() } })).rejects.toMatchObject({ code: "P2002" });
    await expect(prisma.professionalFieldClaimDecision.create({ data: { ...first.decision, id: randomUUID(), ownerUserId: b.owner, revision: 2 } })).rejects.toMatchObject({ code: "P2003" });
  });
});
