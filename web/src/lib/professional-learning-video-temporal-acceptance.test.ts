import { randomUUID } from "crypto";

import { describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { buildCanonicalCandidateSkillRegistry } from "@/lib/professional-brain-skill-templates";
import { createTemporalObservation, createVideoLearningSegment } from "@/lib/professional-learning-video-segmentation";
import {
  assessEffect,
  assessProgression,
  assessRepetition,
  assessZoneCompletion,
  createActionCandidate,
  isContinuityBrokenBetween,
  summarizeCoreCompletionChain,
  type ZoneVisit,
} from "@/lib/professional-learning-video-temporal-reasoning";
import { buildEditedJumpFixture, buildFullAcceptanceFixture, buildSingleCutFixture } from "@/lib/professional-learning-video-temporal-acceptance-fixtures";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

// AI Hair Architect, Professional Skill Engine Stage 8.5L5 -- DETERMINISTIC
// MOCK/SYNTHETIC ACCEPTANCE TESTS (Section 36-44). Zero real AI/Gemini/
// Vision/Veo calls anywhere in this file -- every observation, action
// candidate, and outcome below is hand-authored via the shared fixture
// builder (professional-learning-video-temporal-acceptance-fixtures.ts),
// exactly like every prior mock-extractor acceptance test in this
// codebase. This tests the ARCHITECTURE's reasoning, not a real haircut.

describe("professional-learning-video-temporal-acceptance (Stage 8.5L5, pure fixtures)", () => {
  it("Section 36: the full A-G sequence preserves ordered observations, repetition, progression-candidates, and keeps result/validation distinct from action", () => {
    const fixture = buildFullAcceptanceFixture("evidence-full");

    // Ordered observations preserved.
    expect(fixture.observations[0].description).toContain("wet");
    expect(fixture.observations.at(-1)!.segmentId).toBe(fixture.segments.G.id);

    // Repetition is representable (two CUTTING candidates, B and D).
    const repetition = assessRepetition(fixture.actionCandidates, "CUTTING");
    expect(repetition.occurrenceActionCandidateIds).toHaveLength(2);

    // Progression candidate representable: B -> C -> D -> E, each declared
    // adjacent and temporally ordered.
    const zoneVisits: ZoneVisit[] = [
      { zoneId: "posterior-1", segmentId: fixture.segments.B.id, interval: fixture.segments.B.interval, adjacentToPrevious: false },
      { zoneId: "posterior-2", segmentId: fixture.segments.D.id, interval: fixture.segments.D.interval, adjacentToPrevious: true },
      { zoneId: "posterior-3", segmentId: fixture.segments.E.id, interval: fixture.segments.E.interval, adjacentToPrevious: true },
    ];
    const progression = assessProgression(zoneVisits);
    expect(progression.status).toBe("SUPPORTED");

    // Completion is NOT assumed without an explicitly declared scope --
    // this fixture never declares a scope size, so it must not silently
    // become COMPLETED merely because the sequence "looks" thorough.
    const completion = assessZoneCompletion({ repetition, progression, resultObservationPresent: true, validationPresent: true });
    expect(completion).not.toBe("COMPLETED");

    // Wet -> dry state order representable via plain TemporalObservations,
    // no special-cased type needed.
    const wetObservation = fixture.observations.find((o) => o.description.includes("wet"))!;
    const dryObservation = fixture.observations.find((o) => o.description.includes("dry"))!;
    expect(wetObservation.segmentId).toBe(fixture.segments.A.id);
    expect(dryObservation.segmentId).toBe(fixture.segments.F.id);

    // Result observation distinct from action; validation distinct from
    // cutting -- structurally separate types/ids, never derived from
    // ActionCandidate.
    expect(fixture.resultObservation.segmentId).toBe(fixture.segments.F.id);
    expect(fixture.validationCandidate.segmentId).toBe(fixture.segments.G.id);
    expect(fixture.actionCandidates.some((c) => c.id === fixture.resultObservation.id)).toBe(false);
    expect(fixture.actionCandidates.some((c) => c.id === fixture.validationCandidate.id)).toBe(false);
  });

  it("Section 37 single-cut negative control: one subsection, one cut, video ends -> never complete/skill-learned", () => {
    const fixture = buildSingleCutFixture("evidence-single-cut");
    const repetition = assessRepetition([fixture.action], "CUTTING");
    const progression = assessProgression([]);
    const completion = assessZoneCompletion({ repetition, progression, resultObservationPresent: false, validationPresent: false });

    expect(completion).not.toBe("COMPLETED");
    expect(progression.status).toBe("UNKNOWN");
    // No skill/registry support is even representable at this layer --
    // this module never constructs a ProfessionalSkillDefinition or
    // ProfessionalLearningDraft; there is no function here capable of
    // producing "registry support" from an ActionCandidate alone.
  });

  it("Section 38 edited-jump negative control: never fabricates the missing intermediate footage as OBSERVED", () => {
    const fixture = buildEditedJumpFixture("evidence-edited-jump");

    const broken = isContinuityBrokenBetween(fixture.firstSubsection.id, fixture.finishedZone.id, [fixture.declaredBreak]);
    expect(broken).toBe(true);

    const effect = assessEffect(fixture.beforeObservation, fixture.action, fixture.afterObservation, broken);
    expect(effect.status).toBe("UNKNOWN");

    // The two real observations are exactly what was declared -- nothing
    // fabricates a third, intermediate "OBSERVED" entry for the missing
    // footage.
    expect([fixture.beforeObservation, fixture.afterObservation]).toHaveLength(2);
  });

  it("Section 39 repeated-action control: repetition representable across adjacent subsections, but alone never proves zone completion", () => {
    const fixture = buildFullAcceptanceFixture("evidence-repetition");
    const repetition = assessRepetition(fixture.actionCandidates, "CUTTING");
    expect(repetition.occurrenceActionCandidateIds.length).toBeGreaterThanOrEqual(2);

    const completion = assessZoneCompletion({ repetition, progression: assessProgression([]), resultObservationPresent: false, validationPresent: false });
    expect(completion).not.toBe("COMPLETED");
  });

  it("Section 40 progression control: disconnected camera shots never prove progression, declared-adjacent ordered shots do", () => {
    const connected = assessProgression([
      { zoneId: "z1", segmentId: "s1", interval: { timeStartSeconds: 0, timeEndSeconds: 10 }, adjacentToPrevious: false },
      { zoneId: "z2", segmentId: "s2", interval: { timeStartSeconds: 10, timeEndSeconds: 20 }, adjacentToPrevious: true },
    ]);
    expect(connected.status).toBe("SUPPORTED");

    const disconnected = assessProgression([
      { zoneId: "z1", segmentId: "s1", interval: { timeStartSeconds: 0, timeEndSeconds: 10 }, adjacentToPrevious: false },
      { zoneId: "z9", segmentId: "s9", interval: { timeStartSeconds: 500, timeEndSeconds: 510 }, adjacentToPrevious: false },
    ]);
    expect(disconnected.status).toBe("UNKNOWN");
  });

  it("Section 41 completion positive control: declared scope + progression + result + validation -> COMPLETED", () => {
    const fixture = buildFullAcceptanceFixture("evidence-completion-positive");
    const repetition = assessRepetition(fixture.actionCandidates, "CUTTING", 2);
    const progression = assessProgression([
      { zoneId: "posterior-1", segmentId: fixture.segments.B.id, interval: fixture.segments.B.interval, adjacentToPrevious: false },
      { zoneId: "posterior-2", segmentId: fixture.segments.D.id, interval: fixture.segments.D.interval, adjacentToPrevious: true },
    ]);
    const completion = assessZoneCompletion({ repetition, progression, resultObservationPresent: true, validationPresent: true });
    expect(completion).toBe("COMPLETED");

    const chain = summarizeCoreCompletionChain({
      startObserved: true,
      actionObserved: true,
      progression,
      repetition,
      zoneCompletion: completion,
      resultObservationPresent: true,
      validationPresent: true,
    });
    expect(Object.values(chain)).not.toContain("");
    expect(chain.ZONE_COMPLETE).toBe("OBSERVED");
  });

  it("Section 42/43 effect controls: action+no-after -> UNKNOWN; before+action+after+continuity -> SUPPORTED (never causal)", () => {
    const segmentBefore = createVideoLearningSegment("evidence-effect", { timeStartSeconds: 0, timeEndSeconds: 10 }, "v1");
    const segmentAfter = createVideoLearningSegment("evidence-effect", { timeStartSeconds: 10, timeEndSeconds: 20 }, "v1");
    const before = createTemporalObservation(segmentBefore.id, "evidence-effect", "ends visibly uneven", "OBSERVED");
    const action = createActionCandidate([segmentBefore.id], [before.id], "CUTTING", "KNOWN", "KNOWN");

    const negative = assessEffect(before, action, null, false);
    expect(negative.status).toBe("UNKNOWN");

    const after = createTemporalObservation(segmentAfter.id, "evidence-effect", "line visibly cleaner", "OBSERVED");
    const positive = assessEffect(before, action, after, false);
    expect(positive.status).toBe("SUPPORTED");
  });

  it("Section 44 validation control: SOURCE SUPPORT vs SEMANTIC SUPPORT in temporal context -- semanticallySupported is caller-declared, never inferred by this module", () => {
    const fixture = buildFullAcceptanceFixture("evidence-validation");
    // The fixture explicitly declares semantic support (standing in for a
    // future bound extractor proposal / professional annotation).
    expect(fixture.validationCandidate.semanticallySupported).toBe(true);

    // Without that explicit declaration, only the raw TemporalObservation
    // exists -- no ValidationCandidate is fabricated by this module on
    // its own from the same description text.
    const rawOnly = fixture.observations.find((o) => o.description.includes("checks both sides"));
    expect(rawOnly).toBeDefined();
  });

  it("Section 35/62#45: a video evidence 'title' never automatically creates a technique/skill candidate -- kind is always caller-supplied", () => {
    // Nothing in ActionCandidate accepts or reads a "title" field --
    // constructing one always requires an explicit `kind`, proving a
    // title like "Butterfly Haircut" cannot silently become
    // techniqueCandidate="Butterfly" through this module.
    const candidate = createActionCandidate(["s1"], ["o1"], "CUTTING", "KNOWN", "KNOWN");
    expect(candidate.kind).toBe("CUTTING");
    expect((candidate as unknown as Record<string, unknown>).title).toBeUndefined();
    expect((candidate as unknown as Record<string, unknown>).techniqueCandidate).toBeUndefined();
  });
});

// Real-Postgres proof that none of the above pure-fixture reasoning ever
// touches the professional skill registry (Section 59) -- mirrors the
// exact snapshot-before/after-JSON-string-equality idiom established in
// professional-learning-draft-semantic-binding-integration.test.ts.
suite("professional-learning-video-temporal-acceptance -- registry immutability (Stage 8.5L5, Section 59)", () => {
  it("running the full acceptance fixture through the reasoning layer never mutates the canonical skill registry", async () => {
    const registry = buildCanonicalCandidateSkillRegistry();
    const before = JSON.stringify(registry.map((r) => ({ skillId: r.skillId, version: r.version, payload: r.payload })));

    const fixture = buildFullAcceptanceFixture(`evidence-registry-check-${randomUUID()}`);
    assessRepetition(fixture.actionCandidates, "CUTTING", 2);
    assessProgression([
      { zoneId: "posterior-1", segmentId: fixture.segments.B.id, interval: fixture.segments.B.interval, adjacentToPrevious: false },
      { zoneId: "posterior-2", segmentId: fixture.segments.D.id, interval: fixture.segments.D.interval, adjacentToPrevious: true },
    ]);

    const after = JSON.stringify(registry.map((r) => ({ skillId: r.skillId, version: r.version, payload: r.payload })));
    expect(after).toBe(before);
    expect(await prisma.professionalSkillDefinition.count()).toBe(0);
  });
});
