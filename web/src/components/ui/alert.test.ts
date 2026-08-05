import { CheckCircle2, Info } from "lucide-react";
import { describe, expect, it } from "vitest";

import { getAlertClasses, getAlertIcon } from "./alert";

describe("getAlertClasses", () => {
  it("defaults to the info variant", () => {
    expect(getAlertClasses()).toContain("accent-secondary");
  });

  it("returns success variant classes", () => {
    expect(getAlertClasses("success")).toContain("bg-success/10");
  });

  it("returns warning variant classes", () => {
    expect(getAlertClasses("warning")).toContain("bg-warning/10");
  });

  it("returns error variant classes", () => {
    expect(getAlertClasses("error")).toContain("bg-danger/10");
  });

  it("appends a caller-provided className", () => {
    expect(getAlertClasses("info", "mt-4")).toContain("mt-4");
  });
});

describe("getAlertIcon", () => {
  it("maps the info variant to the Info icon", () => {
    expect(getAlertIcon("info")).toBe(Info);
  });

  it("maps the success variant to the CheckCircle2 icon", () => {
    expect(getAlertIcon("success")).toBe(CheckCircle2);
  });

  it("defaults to the info icon", () => {
    expect(getAlertIcon()).toBe(Info);
  });
});
