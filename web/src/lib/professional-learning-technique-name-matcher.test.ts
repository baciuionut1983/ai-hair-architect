import { describe, expect, it } from "vitest";

import { matchTechniqueNameToRegistry } from "./professional-learning-technique-name-matcher";
import { buildCanonicalCandidateSkillRegistry } from "./professional-brain-skill-templates";

const registry = buildCanonicalCandidateSkillRegistry();

describe("matchTechniqueNameToRegistry (Stage 8.5L4.R1 -- deterministic, post-extraction only)", () => {
  it("matches a name the model recognized in its own words to the real registry skillId", () => {
    expect(matchTechniqueNameToRegistry("One-Length Perimeter", registry)).toBe("skill-cutting-one-length-perimeter");
    expect(matchTechniqueNameToRegistry("constructing a one length perimeter haircut", registry)).toBe("skill-cutting-one-length-perimeter");
    expect(matchTechniqueNameToRegistry("Graduated Cutting", registry)).toBe("skill-cutting-graduated");
    expect(matchTechniqueNameToRegistry("slice and slide refinement", registry)).toBe("skill-cutting-slice-and-slide-refinement");
  });

  it("returns null for an empty or unrecognized name -- never a fabricated match", () => {
    expect(matchTechniqueNameToRegistry("", registry)).toBeNull();
    expect(matchTechniqueNameToRegistry("Butterfly Haircut", registry)).toBeNull();
    expect(matchTechniqueNameToRegistry("some completely unrelated phrase", registry)).toBeNull();
  });

  it("is case/punctuation/hyphen insensitive", () => {
    expect(matchTechniqueNameToRegistry("SLICE-AND-SLIDE REFINEMENT!", registry)).toBe("skill-cutting-slice-and-slide-refinement");
  });
});
