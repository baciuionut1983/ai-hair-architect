import { describe, expect, it } from "vitest";

import {
  DENSITY_OPTIONS,
  DESIRED_COLOR_RESULT_OPTIONS,
  FACE_SHAPE_OPTIONS,
  type FieldOption,
  GOAL_OPTIONS,
  GRAY_PERCENTAGE_OPTIONS,
  GROWTH_PATTERN_OPTIONS,
  HAIR_CONDITION_OPTIONS,
  HAIR_LENGTH_OPTIONS,
  HAIR_TEXTURE_OPTIONS,
  HAIR_TYPE_OPTIONS,
  HEAD_SHAPE_OPTIONS,
  POROSITY_OPTIONS,
  SCALP_CONDITION_OPTIONS,
  TARGET_SHAPE_OPTIONS,
  TREATMENT_GOAL_DETAIL_OPTIONS
} from "./analysis-field-options";

// Mirrors the exact validation lists in
// src/app/api/v1/analysis/start/route.ts -- if either side drifts, these
// tests catch it instead of the UI silently offering a value the backend
// would reject with a 400.
const EXPECTED_VALUES: Record<string, readonly string[]> = {
  GOAL_OPTIONS: ["refresh", "cover", "lighten", "correct", "reshape", "treat"],
  HAIR_TYPE_OPTIONS: ["fine", "medium", "coarse"],
  DENSITY_OPTIONS: ["low", "medium", "high"],
  POROSITY_OPTIONS: ["low", "medium", "high"],
  FACE_SHAPE_OPTIONS: ["oval", "round", "square", "heart", "diamond", "oblong"],
  HEAD_SHAPE_OPTIONS: [
    "balanced",
    "flat_occipital",
    "prominent_crown",
    "wide_parietal",
    "irregular_occipital"
  ],
  HAIR_LENGTH_OPTIONS: ["pixie", "short", "medium", "long", "extra_long"],
  HAIR_TEXTURE_OPTIONS: ["straight", "wavy", "curly", "coily"],
  HAIR_CONDITION_OPTIONS: [
    "virgin_healthy",
    "chemically_treated",
    "high_porosity_damaged",
    "fragile_breakage"
  ],
  GROWTH_PATTERN_OPTIONS: [
    "regular",
    "double_crown",
    "front_cowlick",
    "nape_whorl",
    "strong_widow_peak"
  ],
  TARGET_SHAPE_OPTIONS: [
    "precision_bob",
    "graduated_bob",
    "long_layers",
    "shag_mullet",
    "pixie_crop",
    "face_framing_cascade",
    "blunt_perimeter_texturized"
  ],
  DESIRED_COLOR_RESULT_OPTIONS: [
    "gray_coverage",
    "gloss_refresh",
    "root_shadow",
    "balayage_highlights",
    "full_lightening",
    "color_correction"
  ],
  GRAY_PERCENTAGE_OPTIONS: ["none", "low", "medium", "high"],
  SCALP_CONDITION_OPTIONS: ["normal", "oily", "dry", "sensitive", "flaking"],
  TREATMENT_GOAL_DETAIL_OPTIONS: ["hydration", "repair", "detox_scalp", "bonding_repair", "post_color_recovery"]
};

const ACTUAL_LISTS: Record<string, FieldOption<string>[]> = {
  GOAL_OPTIONS,
  HAIR_TYPE_OPTIONS,
  DENSITY_OPTIONS,
  POROSITY_OPTIONS,
  FACE_SHAPE_OPTIONS,
  HEAD_SHAPE_OPTIONS,
  HAIR_LENGTH_OPTIONS,
  HAIR_TEXTURE_OPTIONS,
  HAIR_CONDITION_OPTIONS,
  GROWTH_PATTERN_OPTIONS,
  TARGET_SHAPE_OPTIONS,
  DESIRED_COLOR_RESULT_OPTIONS,
  GRAY_PERCENTAGE_OPTIONS,
  SCALP_CONDITION_OPTIONS,
  TREATMENT_GOAL_DETAIL_OPTIONS
};

describe("analysis-field-options", () => {
  for (const [name, expectedValues] of Object.entries(EXPECTED_VALUES)) {
    describe(name, () => {
      const list = ACTUAL_LISTS[name];

      it("has exactly the values the backend accepts, in order", () => {
        expect(list.map((option) => option.value)).toEqual(expectedValues);
      });

      it("has a non-empty label for every option", () => {
        for (const option of list) {
          expect(option.label.trim().length).toBeGreaterThan(0);
        }
      });

      it("has no duplicate values", () => {
        const values = list.map((option) => option.value);
        expect(new Set(values).size).toBe(values.length);
      });
    });
  }
});
