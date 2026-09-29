import { describe, expect, it } from "vitest";

import {
  DEFAULT_PROFESSIONAL_BRAIN_DOMAIN_INTENT,
  PROFESSIONAL_BRAIN_DOMAINS,
  hasDomain,
  includesUnimplementedDomain,
  isProfessionalBrainDomain,
  isValidProfessionalBrainDomainIntent,
  sortDomains,
  type ProfessionalBrainDomain,
} from "@/lib/professional-brain-domain-intent-contracts";

describe("professional-brain-domain-intent-contracts", () => {
  it("exactly three real domains -- cut, color, styling", () => {
    expect(PROFESSIONAL_BRAIN_DOMAINS).toEqual(["cut", "color", "styling"]);
  });

  it("isProfessionalBrainDomain accepts only the three real values", () => {
    expect(isProfessionalBrainDomain("cut")).toBe(true);
    expect(isProfessionalBrainDomain("color")).toBe(true);
    expect(isProfessionalBrainDomain("styling")).toBe(true);
    expect(isProfessionalBrainDomain("nails")).toBe(false);
    expect(isProfessionalBrainDomain("")).toBe(false);
    expect(isProfessionalBrainDomain(123)).toBe(false);
    expect(isProfessionalBrainDomain(null)).toBe(false);
  });

  it("isValidProfessionalBrainDomainIntent requires a non-empty, real, duplicate-free array", () => {
    expect(isValidProfessionalBrainDomainIntent({ domains: ["cut"] })).toBe(true);
    expect(isValidProfessionalBrainDomainIntent({ domains: ["cut", "color"] })).toBe(true);
    expect(isValidProfessionalBrainDomainIntent({ domains: ["cut", "color", "styling"] })).toBe(true);
    expect(isValidProfessionalBrainDomainIntent({ domains: [] })).toBe(false);
    expect(isValidProfessionalBrainDomainIntent({ domains: ["cut", "cut"] })).toBe(false);
    expect(isValidProfessionalBrainDomainIntent({ domains: ["cut", "nails"] })).toBe(false);
    expect(isValidProfessionalBrainDomainIntent({ domains: "cut" })).toBe(false);
    expect(isValidProfessionalBrainDomainIntent(null)).toBe(false);
    expect(isValidProfessionalBrainDomainIntent(undefined)).toBe(false);
    expect(isValidProfessionalBrainDomainIntent({})).toBe(false);
  });

  it("sortDomains applies the canonical cut/color/styling ordering regardless of input order", () => {
    expect(sortDomains(["styling", "cut"])).toEqual(["cut", "styling"]);
    expect(sortDomains(["color", "cut", "styling"])).toEqual(["cut", "color", "styling"]);
    expect(sortDomains([])).toEqual([]);
  });

  it("hasDomain checks membership, honestly false for a null/undefined intent", () => {
    const intent = { domains: ["cut"] as readonly ProfessionalBrainDomain[] };
    expect(hasDomain(intent, "cut")).toBe(true);
    expect(hasDomain(intent, "color")).toBe(false);
    expect(hasDomain(null, "cut")).toBe(false);
    expect(hasDomain(undefined, "cut")).toBe(false);
  });

  it("includesUnimplementedDomain is true only when styling is one of the selected domains", () => {
    expect(includesUnimplementedDomain({ domains: ["styling"] })).toBe(true);
    expect(includesUnimplementedDomain({ domains: ["cut", "styling"] })).toBe(true);
    expect(includesUnimplementedDomain({ domains: ["cut", "color"] })).toBe(false);
  });

  it("the legacy default is exactly cut+color -- reproduces this app's own pre-existing composed behavior for snapshots created before this requirement existed", () => {
    expect(DEFAULT_PROFESSIONAL_BRAIN_DOMAIN_INTENT).toEqual({ domains: ["cut", "color"] });
    expect(isValidProfessionalBrainDomainIntent(DEFAULT_PROFESSIONAL_BRAIN_DOMAIN_INTENT)).toBe(true);
  });
});
