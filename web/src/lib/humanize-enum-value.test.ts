import { describe, expect, it } from "vitest";

import { humanizeEnumValue } from "./humanize-enum-value";

describe("humanizeEnumValue", () => {
  it("converts a snake_case value to Title Case", () => {
    expect(humanizeEnumValue("single_process_gray_coverage")).toBe("Single Process Gray Coverage");
  });

  it("capitalizes a single word", () => {
    expect(humanizeEnumValue("balanced")).toBe("Balanced");
  });

  it("handles a two-word value", () => {
    expect(humanizeEnumValue("root_shadow")).toBe("Root Shadow");
  });

  it("handles values with numbers", () => {
    expect(humanizeEnumValue("90_deg_uniform_layer")).toBe("90 Deg Uniform Layer");
  });

  it("returns an empty string for an empty input", () => {
    expect(humanizeEnumValue("")).toBe("");
  });
});
