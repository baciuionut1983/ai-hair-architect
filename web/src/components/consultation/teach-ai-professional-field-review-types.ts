// Client mirror of the b.2 JSON response. No server runtime dependency.
export type ReviewField = "elevation" | "sectioning" | "guideType";
export type FieldDecision = "CONFIRMED" | "CORRECTED" | "UNKNOWN" | "REJECTED";
export interface DecisionDto {
  readonly field: string;
  readonly revision: number;
  readonly decision: string;
  readonly professionalValue: string | null;
  readonly note: string | null;
  readonly createdAt: string;
}
export interface FieldDto {
  readonly field: ReviewField;
  readonly review: { readonly reviewable: false; readonly reason: string } | {
    readonly reviewable: true;
    readonly candidate: {
      readonly resolution: "CANONICAL" | "UNRESOLVED_TEXT" | "UNCLEAR_MEANING";
      readonly normalizedValue: string | null;
      readonly observation: { readonly value?: unknown; readonly source: string; readonly confidence?: number; readonly rawObservation?: string; readonly note?: string };
      readonly pins: { readonly observationDigest: string; readonly observationDigestVersion: string; readonly specificationVersion: string; readonly specificationDigest: string };
    };
  };
  readonly specification: { readonly version: string; readonly digest: string; readonly allowedValues: readonly string[] };
  readonly latestRevision: number;
  readonly authority: "NONE" | "CURRENT" | "STALE";
  readonly latest: DecisionDto | null;
  readonly staleReason: string | null;
  readonly actions: { readonly canSubmit: boolean; readonly blockedReason?: string; readonly allowedDecisions: readonly FieldDecision[] };
  readonly history: readonly DecisionDto[];
  readonly historyTruncated: boolean;
}
export interface ReviewDto {
  readonly draftId: string;
  readonly lifecycle: { readonly open: boolean; readonly blockedBy: string | null };
  readonly fields: readonly FieldDto[];
}

const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const string = (v: unknown): v is string => typeof v === "string";
const nullable = (v: unknown) => v === null || string(v);
const integer = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(string);
const decision = (v: unknown) => ["CONFIRMED", "CORRECTED", "UNKNOWN", "REJECTED"].includes(v as string);
function decisionDto(v: unknown): boolean {
  return object(v) && string(v.field) && integer(v.revision) && decision(v.decision)
    && nullable(v.professionalValue) && nullable(v.note) && string(v.createdAt) && Number.isFinite(Date.parse(v.createdAt));
}
function fieldDto(v: unknown): boolean {
  if (!object(v) || !["elevation", "sectioning", "guideType"].includes(v.field as string)
    || !object(v.review) || !object(v.specification) || !strings(v.specification.allowedValues)
    || !string(v.specification.version) || !string(v.specification.digest) || !integer(v.latestRevision)
    || !["NONE", "CURRENT", "STALE"].includes(v.authority as string) || !nullable(v.staleReason)
    || !(v.latest === null || decisionDto(v.latest)) || !Array.isArray(v.history) || !v.history.every(decisionDto)
    || typeof v.historyTruncated !== "boolean" || !object(v.actions) || typeof v.actions.canSubmit !== "boolean"
    || !(v.actions.blockedReason === undefined || string(v.actions.blockedReason))
    || !Array.isArray(v.actions.allowedDecisions) || !v.actions.allowedDecisions.every(decision)) return false;
  if (v.review.reviewable === false) return string(v.review.reason);
  if (v.review.reviewable !== true || !object(v.review.candidate)) return false;
  const c = v.review.candidate;
  const observation = c.observation;
  const pins = c.pins;
  return ["CANONICAL", "UNRESOLVED_TEXT", "UNCLEAR_MEANING"].includes(c.resolution as string)
    && nullable(c.normalizedValue) && object(observation) && (observation.value === undefined || nullable(observation.value)) && string(observation.source)
    && (observation.confidence === undefined || (typeof observation.confidence === "number" && Number.isFinite(observation.confidence)))
    && ["rawObservation", "note"].every(k => observation[k] === undefined || string(observation[k]))
    && object(pins) && ["observationDigest", "observationDigestVersion", "specificationVersion", "specificationDigest"].every(k => string(pins[k]));
}
export function isReviewDto(v: unknown): v is ReviewDto {
  return object(v) && string(v.draftId) && object(v.lifecycle) && typeof v.lifecycle.open === "boolean"
    && nullable(v.lifecycle.blockedBy) && Array.isArray(v.fields) && v.fields.every(fieldDto)
    && new Set(v.fields.map(f => f.field)).size === v.fields.length;
}
