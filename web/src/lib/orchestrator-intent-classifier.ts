import type { OrchestratorIntent } from "@/lib/orchestrator-contracts";

// AI Concierge / Orchestrator, Stage 1 -- intent classification.
//
// DELIBERATE STAGE 1 DESIGN DECISION, stated explicitly rather than left
// implicit: this classifier is a bounded, deterministic, keyword-pattern
// matcher over English and Romanian (this app's only two FULL-coverage
// languages -- see translations.ts's own header comment), not a real model
// call. Building a real LLM-backed classifier here would itself be a new,
// unconsented AI cost surface -- this task authorizes building the
// Concierge's INFRASTRUCTURE and a first REAL, usable behavior, not a new
// billable AI call path (task section 12 forbids any real paid call in
// this stage; a text-classification call, while cheap, is still a real
// provider call this task never asked for or priced). A real-model-backed
// classifier is a clean drop-in replacement for JUST this function in a
// later stage: orchestrator-service.ts depends only on
// `classifyOrchestratorIntent(message): OrchestratorIntent`, never on how
// that answer was produced, and every decision built from its output still
// passes through isOrchestratorDecision's own validation boundary either
// way.
//
// DELIBERATE SCOPE BOUNDARY: this function identifies WHICH kind of goal
// the user stated -- it does NOT attempt to extract a client name from
// free text (a much more failure-prone NLP problem). Section 7's own
// phrasing separates "selects or identifies client/context" from "states
// the goal" as two distinct steps -- this codebase treats client selection
// as an explicit UI action (or an already-known page context), never a
// guess parsed out of a sentence.
export function classifyOrchestratorIntent(message: string): OrchestratorIntent {
  const normalized = message.toLowerCase();

  // Video: checked first -- "video" appears identically in both languages,
  // and a message like "vreau un video cu rezultatul" must route to the
  // video offer, not to the generic result/preview branch below.
  if (/\bvideo\b|\bclip\b/.test(normalized)) {
    return "request_video";
  }

  // Continuing an existing consultation/analysis. No trailing word
  // boundary on "continu" -- Romanian inflects the verb stem (continui/
  // continuă/continuăm), so a bare \bcontinue\b would miss all of those.
  if (/\bcontinu/.test(normalized) && /\bconsulta|\banaliz|\banalys/.test(normalized)) {
    return "open_analysis";
  }

  // Seeing an already-produced result -- "expected result", "proposed
  // look", "preview" (EN) / "rezultat", "propunere", "previzualizare" (RO).
  if (/\bresult\b|\bproposed look\b|\bexpected result\b|\bpreview\b|\brezultat|\bpropuner|\bprevizualiz/.test(normalized)) {
    return "open_analysis";
  }

  // Starting a new piece of work -- analyze/haircut/color/styling
  // (EN) / analizeaz/tunsoare/culoare/stilizare (RO).
  if (/\banaly[sz]e\b|\bhaircut\b|\bcolor(ing)?\b|\bstyl(e|ing)\b|\bconsultation\b|\banaliz|\btunsoare|\bculoare|\bstiliz|\bconsulta/.test(normalized)) {
    return "start_analysis";
  }

  // Finding/opening/creating a client, with no more specific goal stated.
  // No trailing word boundary -- Romanian inflects "client" (clientul,
  // clienta, clienți), so a bare \bclient\b would miss all of those.
  if (/\bclient/.test(normalized)) {
    return "open_clients";
  }

  return "unsupported";
}
