import { NextResponse } from "next/server";

import { analyzeInitial } from "@/lib/analysis-engine";
import type { AnalysisPreviewRequest, AnalysisPreviewResponse } from "@/lib/contracts";
import { checkRateLimit, getRequestClientIp } from "@/lib/hardening";

// "reshape" is deliberately excluded: it is the one basic-field value that
// alone (with zero advanced fields) makes analyzeInitial compute a
// technicalCutPlan, whose prose then leaks into recommendations/safetyNotes
// as professional-only cutting terminology ("structural technique",
// "document the cutting map in the consultation record") even after the
// technicalCutPlan object itself is stripped below. Discovered by directly
// exercising this route with goal: "reshape" during verification, not
// assumed. Excluding it here is the complete, minimal fix -- no change to
// the engine itself.
const VALID_GOALS = ["refresh", "cover", "lighten", "correct", "treat"] as const;
const VALID_HAIR_TYPES = ["fine", "medium", "coarse"] as const;
const VALID_LEVELS = ["low", "medium", "high"] as const;

const RATE_LIMIT_MAX_REQUESTS = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;

const DISCLAIMER =
  "This is an orientative preview generated from the details you entered. It is not a photo analysis, not an external AI diagnosis, and not a professional assessment. Create a free account for the full consultation experience.";

// M24: public, unauthenticated, stateless guest preview. No session check by
// design -- this route must never require auth. No clientId is ever
// accepted or needed: analyzeInitial has no notion of client ownership.
export async function POST(request: Request) {
  const ip = getRequestClientIp(request);
  const limiter = checkRateLimit(`analysis-preview:${ip}`, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS);
  if (!limiter.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });
  }

  let body: Partial<AnalysisPreviewRequest>;
  try {
    body = (await request.json()) as Partial<AnalysisPreviewRequest>;
  } catch {
    return NextResponse.json({ error: "Invalid preview payload." }, { status: 400 });
  }

  if (
    !isEnumValue(body.goal, VALID_GOALS) ||
    !isEnumValue(body.hairType, VALID_HAIR_TYPES) ||
    !isEnumValue(body.density, VALID_LEVELS) ||
    !isEnumValue(body.porosity, VALID_LEVELS)
  ) {
    return NextResponse.json({ error: "Invalid preview payload." }, { status: 400 });
  }

  // Only the 4 basic fields are ever read from the request and passed to
  // the engine -- no advanced field (faceShape/headShape/hairLength/...)
  // is ever accepted here, matching the minimal-input requirement and
  // keeping this call shape identical to the engine's own minimum input.
  const engineOutput = analyzeInitial({
    goal: body.goal,
    hairType: body.hairType,
    density: body.density,
    porosity: body.porosity
  });

  // engineOutput.technicalCutPlan is deliberately never read here (defense
  // in depth alongside excluding "reshape" above). confidenceScore, phase,
  // and clarificationRound are engine-internal and never surfaced either:
  // nothing here is an invented precision number or an implied multi-step/
  // async process, and nothing is persisted.
  const response: AnalysisPreviewResponse = {
    preview: true,
    recommendations: engineOutput.recommendations,
    safetyNotes: engineOutput.safetyNotes,
    followUpQuestions: engineOutput.followUpQuestions,
    disclaimer: DISCLAIMER
  };

  return NextResponse.json(response, { status: 200 });
}

function isEnumValue<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}
