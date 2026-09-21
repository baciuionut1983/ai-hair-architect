import { Prisma } from "@prisma/client";
import { ProfessionalFieldClaimDecisionError } from "@/lib/professional-field-claim-decision-service";

export function decisionJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}
export class DecisionRequestError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "REQUEST_TOO_LARGE", readonly status: 400 | 413) { super(code); }
}
export function decisionErrorResponse(error: unknown) {
  if (error instanceof DecisionRequestError) return decisionJson({ error: error.code }, error.status);
  if (error instanceof ProfessionalFieldClaimDecisionError) {
    if (error.code === "INVALID_DECISION_REQUEST") return decisionJson({ error: "INVALID_REQUEST" }, 400);
    if (error.code === "DRAFT_NOT_FOUND") return decisionJson({ error: "DRAFT_NOT_FOUND" }, 404);
    return decisionJson({ error: error.code, message: "Review state changed. Refresh before submitting.", refreshRequired: true }, 409);
  }
  const known = error instanceof Prisma.PrismaClientKnownRequestError;
  const unavailable = known || error instanceof Prisma.PrismaClientInitializationError || error instanceof Prisma.PrismaClientRustPanicError
    || error instanceof Prisma.PrismaClientValidationError || error instanceof Prisma.PrismaClientUnknownRequestError;
  const status = unavailable ? 503 : 500;
  // Never log exceptions, message, stack, request bodies, notes or observations.
  console.error({ route: "professional-field-decisions", status, errorClass: known ? "PrismaKnownRequestError" : unavailable ? "PersistenceUnavailable" : "UnexpectedError",
    ...(known && /^P\d{4}$/.test(error.code) ? { prismaCode: error.code } : {}) });
  return decisionJson({ error: unavailable ? "PROFESSIONAL_FIELD_DECISION_UNAVAILABLE" : "INTERNAL_ERROR" }, status);
}

function normalizedHost(host: string, protocol: string): string | null {
  if (!host || /[\s,/@?#\\%]/.test(host)) return null;
  try {
    const parsed = new URL(`${protocol}//${host}`);
    return parsed.host.toLowerCase();
  } catch { return null; }
}
// Deployment boundary: Railway's trusted ingress must overwrite forwarded-host;
// never expose the backend directly to clients that can set that trusted header.
export function isSameOriginDecisionRequest(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null) return site === "same-origin";
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  if (!/^https?:\/\/[^/?#\s\\]+$/i.test(origin)) return false;
  try {
    const parsed = new URL(origin);
    if (parsed.username || parsed.password) return false;
    const originHost = normalizedHost(parsed.host, parsed.protocol);
    const host = normalizedHost(request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "", parsed.protocol);
    return host !== null && originHost === host;
  } catch { return false; }
}

const MAX_BODY_BYTES = 8 * 1024;
export async function readDecisionBody(request: Request): Promise<Record<string, unknown>> {
  const length = request.headers.get("content-length");
  if (length !== null && !/^\d+$/.test(length)) throw new DecisionRequestError("INVALID_REQUEST", 400);
  if (length !== null && Number(length) > MAX_BODY_BYTES) throw new DecisionRequestError("REQUEST_TOO_LARGE", 413);
  if (!request.body) throw new DecisionRequestError("INVALID_REQUEST", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new DecisionRequestError("REQUEST_TOO_LARGE", 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const body: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new DecisionRequestError("INVALID_REQUEST", 400);
    const input = body as Record<string, unknown>;
    if (Object.keys(input).some(key => !["expectedRevision", "observationDigest", "specificationVersion", "specificationDigest", "decision", "correctedValue", "note"].includes(key))
      || !Number.isInteger(input.expectedRevision) || (input.expectedRevision as number) < 0 || (input.expectedRevision as number) >= 2147483647
      || ["observationDigest", "specificationVersion", "specificationDigest", "decision"].some(key => typeof input[key] !== "string")
      || ["observationDigest", "specificationVersion", "specificationDigest"].some(key => !(input[key] as string).trim())
      || ["correctedValue", "note"].some(key => Object.hasOwn(input, key) && typeof input[key] !== "string")) throw new DecisionRequestError("INVALID_REQUEST", 400);
    return input;
  } catch (error) {
    if (error instanceof DecisionRequestError) throw error;
    throw new DecisionRequestError("INVALID_REQUEST", 400);
  } finally { reader.releaseLock(); }
}
