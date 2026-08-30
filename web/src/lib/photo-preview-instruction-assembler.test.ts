import { describe, expect, it } from "vitest";

import { assembleGeminiPhotoPreviewInstruction } from "@/lib/photo-preview-instruction-assembler";
import { buildSealedPhotoPreviewRequest, buildPhotoPreviewPreserveInvariants, type BuildSealedPhotoPreviewRequestInput } from "@/lib/photo-preview-contracts";
import type { TechnicalVisualMapSpatialPayload } from "@/lib/technical-visual-map-spatial-validators";

// Real AI Photo Preview, Stage 2 -- deterministic assembly tests, fully
// separate from any network transport (task §39, items 1-13). No provider
// SDK, no fetch, no fake/real client is even imported here.

function baseInput(overrides: Partial<BuildSealedPhotoPreviewRequestInput> = {}): BuildSealedPhotoPreviewRequestInput {
  const spatial: TechnicalVisualMapSpatialPayload = {
    zones: (["crown", "occipital", "nape", "top", "sides", "fringe"] as const).map((zone) => ({ zone, state: "not_placed" as const })),
    perimeter: { state: "not_placed" },
  };
  return {
    sourceImage: { assetId: "asset-1", width: 1080, height: 1440, orientation: 0, contentSha256: null, storageVersionId: null },
    viewLabel: "front",
    target: {
      globalIntent: {
        structuralTechnique: "graduation",
        cuttingTechnique: "slice_cutting",
        sectioning: "diagonal_back",
        elevation: "45_deg_graduation",
        distribution: "overdirected_back",
        guideline: "stationary",
      },
      zones: (["crown", "occipital", "nape", "top", "sides", "fringe"] as const).map((zone) => ({
        zone,
        lengthIntent: "unspecified" as const,
        lengthIntentSource: "global_default" as const,
        weightIntent: "unspecified" as const,
        weightIntentSource: "global_default" as const,
        densitySensitive: false,
        densitySensitiveSource: "global_default" as const,
        preserve: false,
        preserveSource: "global_default" as const,
      })),
      relationships: [],
    },
    spatial,
    mapPreserveConstraints: [],
    contraindications: [],
    ...overrides,
  };
}

describe("assembleGeminiPhotoPreviewInstruction", () => {
  it("1. attaches no image itself -- this is text-only; the source image is a SEPARATE input the adapter sends alongside it", () => {
    const instruction = assembleGeminiPhotoPreviewInstruction(buildSealedPhotoPreviewRequest(baseInput()));
    expect(typeof instruction).toBe("string");
    expect(instruction).not.toMatch(/base64|inlineData/i);
  });

  it("2. includes an explicit same-person / identity-preservation instruction", () => {
    const instruction = assembleGeminiPhotoPreviewInstruction(buildSealedPhotoPreviewRequest(baseInput()));
    expect(instruction).toMatch(/same person/i);
  });

  it("3. includes an explicit hair-only instruction", () => {
    const instruction = assembleGeminiPhotoPreviewInstruction(buildSealedPhotoPreviewRequest(baseInput()));
    expect(instruction).toMatch(/modify the hair only/i);
  });

  it("4. includes explicit unrelated-appearance preservation (face, skin, body, clothing, background)", () => {
    const instruction = assembleGeminiPhotoPreviewInstruction(buildSealedPhotoPreviewRequest(baseInput()));
    expect(instruction).toMatch(/skin tone/i);
    expect(instruction).toMatch(/clothing/i);
    expect(instruction).toMatch(/background/i);
  });

  it("5. translates the confirmed target's technique fields into readable text", () => {
    const instruction = assembleGeminiPhotoPreviewInstruction(buildSealedPhotoPreviewRequest(baseInput()));
    expect(instruction).toMatch(/Graduation/);
    expect(instruction).toMatch(/Slice Cutting/);
  });

  it("6. translates per-zone semantic intent -- a zone with a real claim appears, a fully unspecified zone does not", () => {
    const input = baseInput();
    input.target.zones = input.target.zones.map((z) => (z.zone === "nape" ? { ...z, lengthIntent: "shorten" as const } : z));
    const instruction = assembleGeminiPhotoPreviewInstruction(buildSealedPhotoPreviewRequest(input));
    expect(instruction).toMatch(/Nape: shorten the length/);
    expect(instruction).not.toMatch(/Crown:/); // Crown stayed fully unspecified -- never invented
  });

  it("7. represents a PLACED spatial anchor with its normalized coordinates", () => {
    const input = baseInput();
    input.spatial = {
      ...input.spatial,
      zones: input.spatial.zones.map((z) => (z.zone === "crown" ? { zone: "crown" as const, state: "placed" as const, x: 0.5, y: 0.1, source: "professional" as const } : z)),
    };
    const instruction = assembleGeminiPhotoPreviewInstruction(buildSealedPhotoPreviewRequest(input));
    expect(instruction).toMatch(/Crown anchor is approximately at normalized image position \(x=0\.50, y=0\.10\)/);
  });

  it("8. not_visible never becomes invented geometry -- it explicitly says so instead", () => {
    const input = baseInput();
    input.spatial = { ...input.spatial, zones: input.spatial.zones.map((z) => (z.zone === "occipital" ? { zone: "occipital" as const, state: "not_visible" as const } : z)) };
    const instruction = assembleGeminiPhotoPreviewInstruction(buildSealedPhotoPreviewRequest(input));
    expect(instruction).toMatch(/Occipital is not visible in this photo -- do not infer or invent its geometry/);
  });

  it("9. not_placed never becomes invented geometry -- it produces no line at all for that zone", () => {
    const instruction = assembleGeminiPhotoPreviewInstruction(buildSealedPhotoPreviewRequest(baseInput())); // every zone not_placed
    expect(instruction).not.toMatch(/Fringe anchor/);
    expect(instruction).not.toMatch(/Fringe is not visible/);
  });

  it("10. a placed perimeter is described as approximate guidance, never a hard line/mask", () => {
    const input = baseInput();
    input.spatial = { ...input.spatial, perimeter: { state: "placed", points: [{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }], source: "professional" } };
    const instruction = assembleGeminiPhotoPreviewInstruction(buildSealedPhotoPreviewRequest(input));
    expect(instruction).toMatch(/approximate guide/i);
    expect(instruction).toMatch(/do not draw a visible line, outline, or hard edge/i);
  });

  it("11. never contains any 'browser prompt' concept -- the function's only input is the sealed request, no free-text parameter exists", () => {
    // Structural proof: the function signature itself takes exactly one
    // argument (the sealed request) -- verified by TypeScript at compile
    // time; this test documents/pins that contract.
    expect(assembleGeminiPhotoPreviewInstruction.length).toBe(1);
  });

  it("12. never contains raw Consult AI chat content -- nothing in the sealed request carries chat transcript fields", () => {
    const instruction = assembleGeminiPhotoPreviewInstruction(buildSealedPhotoPreviewRequest(baseInput()));
    expect(instruction).not.toMatch(/consult ai|chat message|chat transcript/i);
  });

  it("13. never references a mask field -- Stage 2 uses no mask, no control image, no segmentation", () => {
    const instruction = assembleGeminiPhotoPreviewInstruction(buildSealedPhotoPreviewRequest(baseInput()));
    expect(instruction).not.toMatch(/mask|segmentation|control image/i);
  });

  it("relationships between zones are translated into readable text", () => {
    const input = baseInput();
    input.target.relationships = [{ sourceZone: "nape", relationship: "shorter_than", targetZone: "crown", source: "professional_adjustment" }];
    const instruction = assembleGeminiPhotoPreviewInstruction(buildSealedPhotoPreviewRequest(input));
    expect(instruction).toMatch(/Nape should be shorter than Crown/);
  });

  it("map preserve constraints and contraindications are translated as context, not instructions", () => {
    const input = baseInput();
    input.mapPreserveConstraints = [{ type: "preserve_hairline", source: "professional_adjustment" }];
    input.contraindications = ["Recent chemical relaxer -- avoid implying additional processing."];
    const instruction = assembleGeminiPhotoPreviewInstruction(buildSealedPhotoPreviewRequest(input));
    expect(instruction).toMatch(/Preserve the natural hairline/);
    expect(instruction).toMatch(/Safety context.*Recent chemical relaxer/);
  });

  it("is deterministic -- identical input always produces the identical instruction string", () => {
    const request = buildSealedPhotoPreviewRequest(baseInput());
    expect(assembleGeminiPhotoPreviewInstruction(request)).toBe(assembleGeminiPhotoPreviewInstruction(request));
  });

  it("every fixed preserve invariant sentence is present when all invariants are included", () => {
    const request = buildSealedPhotoPreviewRequest(baseInput());
    expect(request.preserveContract.invariants).toEqual(buildPhotoPreviewPreserveInvariants());
    const instruction = assembleGeminiPhotoPreviewInstruction(request);
    expect(instruction).toMatch(/Preserve the exact facial geometry/);
    expect(instruction).toMatch(/photorealistic/i);
  });
});
