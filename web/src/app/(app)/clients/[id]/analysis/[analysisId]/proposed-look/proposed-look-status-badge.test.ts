import { describe, expect, it } from "vitest";

import { getProposalStatusBadgeVariant, getProposalStatusLabel } from "./proposed-look-status-badge";

describe("getProposalStatusBadgeVariant", () => {
  it("maps DRAFT to neutral", () => {
    expect(getProposalStatusBadgeVariant("DRAFT")).toBe("neutral");
  });

  it("maps CONFIRMED to success", () => {
    expect(getProposalStatusBadgeVariant("CONFIRMED")).toBe("success");
  });

  it("maps REJECTED to danger", () => {
    expect(getProposalStatusBadgeVariant("REJECTED")).toBe("danger");
  });

  it("maps SUPERSEDED to warning", () => {
    expect(getProposalStatusBadgeVariant("SUPERSEDED")).toBe("warning");
  });

  it("maps an unrecognized status to neutral", () => {
    expect(getProposalStatusBadgeVariant("ARCHIVED")).toBe("neutral");
  });
});

describe("getProposalStatusLabel", () => {
  it("labels DRAFT", () => {
    expect(getProposalStatusLabel("DRAFT")).toBe("Draft");
  });

  it("labels CONFIRMED", () => {
    expect(getProposalStatusLabel("CONFIRMED")).toBe("Confirmed");
  });

  it("labels REJECTED", () => {
    expect(getProposalStatusLabel("REJECTED")).toBe("Rejected");
  });

  it("labels SUPERSEDED", () => {
    expect(getProposalStatusLabel("SUPERSEDED")).toBe("Superseded");
  });

  it("returns an unrecognized status unchanged", () => {
    expect(getProposalStatusLabel("ARCHIVED")).toBe("ARCHIVED");
  });
});
