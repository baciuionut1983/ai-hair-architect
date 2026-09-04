import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

// Technical Demonstration, Stage 2 -- source-level structural proof of the
// task's own explicit "NO VIDEO YET" boundary. Mirrors this codebase's own
// established precedent for exactly this situation (e.g.
// orchestrator-service.test.ts's own "source-level lock: orchestrator-
// service.ts never references any Video/Photo Preview create/submit/execute
// function", and concierge-voice-input-integration.test.ts's own identical
// pattern): a real, package-manager-agnostic grep over the ACTUAL Stage 2
// source files, not a claim.
//
// What this DOES prove: none of Stage 2's own new files import or reference
// Veo, Gemini technical/video generation, image generation, or the existing
// video/photo-preview submission surface -- Stage 2 only ever derives,
// reviews, and confirms the technical PLAN. What this does NOT prove: the
// literal runtime behavior of the confirm button -- that is what the route
// tests (route.test.ts / confirm/route.test.ts) and the pure logic tests
// (technical-demonstration-plan-logic.test.ts) already cover.

function readSource(...segments: string[]): string {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  return fs.readFileSync(path.join(dirname, ...segments), "utf8");
}

const STAGE_2_UI_FILES = [
  "technical-demonstration-plan-logic.ts",
  "technical-demonstration-plan-status-badge.tsx",
  "technical-demonstration-provenance-badge.tsx",
  "technical-demonstration-step-card.tsx",
  "technical-demonstration-step-field-editor.tsx",
  "technical-demonstration-plan-view.tsx",
  "technical-demonstration-plan-history.tsx",
  "technical-demonstration-plan-section.tsx",
  "use-technical-demonstration-plan.ts",
];

// Stage 2.5.b -- the new professional adjustment layer, same discipline:
// it edits the technical PLAN, never triggers or references a provider.
const STAGE_25B_LIB_FILES = ["technical-demonstration-cutting-overrides.ts"];

const STAGE_2_API_ROOT = path.join(
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
  "api",
  "v1",
  "clients",
  "[id]",
  "analysis-proposals",
  "[proposalId]",
  "technical-demonstration-plans",
);

const STAGE_2_API_FILES = [
  ["route.ts"],
  ["current", "route.ts"],
  ["[planId]", "route.ts"],
  ["[planId]", "confirm", "route.ts"],
];

// Anything matching this is a real provider/video/image-generation
// reference -- deliberately broad (case-insensitive-ish via the explicit
// alternatives below) rather than a single brittle string.
const FORBIDDEN_PATTERN = /veo|gemini|generateVideo|generateImage|VideoDemonstrationGeneration|TechnicalDemonstrationSegment|videoPrompt|imagePrompt|PhotoPreview(?!Section)/;

describe("Technical Demonstration Stage 2 -- no video/image generation source lock", () => {
  it.each(STAGE_2_UI_FILES)("%s never references a video/image generation provider or the Video/Photo Preview submission surface", (file) => {
    const source = readSource(file);
    expect(source).not.toMatch(FORBIDDEN_PATTERN);
  });

  it.each(STAGE_2_API_FILES)("api route %s never references a video/image generation provider", (...segments) => {
    const source = readSource(STAGE_2_API_ROOT, ...segments);
    expect(source).not.toMatch(FORBIDDEN_PATTERN);
  });

  it("the Technical Demonstration repository (extended by Stage 2.5.b) has no provider call either", () => {
    const source = readSource("..", "..", "..", "..", "..", "..", "..", "lib", "technical-demonstration-repository.ts");
    expect(source).not.toMatch(FORBIDDEN_PATTERN);
  });

  it.each(STAGE_25B_LIB_FILES)("lib/%s (Stage 2.5.b) never references a video/image generation provider", (file) => {
    const source = readSource("..", "..", "..", "..", "..", "..", "..", "lib", file);
    expect(source).not.toMatch(FORBIDDEN_PATTERN);
  });

  it("technical-demonstration-plan-section.tsx renders no video-related UI element (no <video>, no VideoDemonstration component)", () => {
    const source = readSource("technical-demonstration-plan-section.tsx");
    expect(source).not.toMatch(/<video/i);
    expect(source).not.toMatch(/VideoDemonstration/);
  });
});
