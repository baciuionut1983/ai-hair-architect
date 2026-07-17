import { describe, expect, it } from "vitest";

import { DEFAULT_LOCALE, resolveLocale } from "./i18n";

describe("resolveLocale", () => {
  it("returns romanian for ro locale", () => {
    expect(resolveLocale("ro-RO")).toBe("ro");
  });

  it("falls back to english for unknown locale", () => {
    expect(resolveLocale("de-DE")).toBe("en");
  });

  it("falls back to default for null", () => {
    expect(resolveLocale(null)).toBe(DEFAULT_LOCALE);
  });
});
