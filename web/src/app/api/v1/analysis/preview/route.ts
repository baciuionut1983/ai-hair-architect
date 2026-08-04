import { NextResponse } from "next/server";

import { analyzeInitial } from "@/lib/analysis-engine";
import type { AnalysisPreviewRequest, AnalysisPreviewResponse } from "@/lib/contracts";
import { checkRateLimit, getRequestClientIp } from "@/lib/hardening";

// "reshape", "cover", "lighten", and "treat" are deliberately excluded: each
// is a basic-field value that alone (with zero advanced fields) makes
// analyzeInitial fire a professional domain engine -- technicalCutPlan for
// "reshape", colorPlan for "cover"/"lighten" (M27), treatmentPlan for "treat"
// (M27) -- whose prose then leaks into recommendations/safetyNotes as
// professional-only terminology ("structural technique", "color direction",
// "treatment category", "document the ... in the consultation record") even
// after the plan objects themselves are stripped below. "reshape" was
// discovered by live verification during M24; "cover"/"lighten"/"treat" were
// discovered the same way, by directly exercising this route, when M27 added
// the Color and Treatment engines to analyzeInitial. Excluding all four here
// is the complete, minimal fix -- no change to any engine itself. Only
// "refresh" and "correct" are provably safe: neither alone triggers any of
// the three engines given just the 4 basic fields this route accepts.
const VALID_GOALS = ["refresh", "correct"] as const;
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

  // engineOutput.technicalCutPlan/colorPlan/treatmentPlan are deliberately
  // never read here (defense in depth alongside excluding "reshape",
  // "cover", "lighten", and "treat" above). confidenceScore, phase, and
  // clarificationRound are engine-internal and never surfaced either:
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
