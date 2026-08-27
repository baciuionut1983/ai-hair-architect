import { Badge, type BadgeVariant } from "@/components/ui";

// AI Proposed Look (Phase 2), Stage 4 -- the proposal lifecycle status badge.
// Mirrors plan-base.tsx's own pattern of exporting the pure variant/label
// resolvers alongside the component so a plain .test.ts can assert the
// mapping without any rendering environment (this codebase has no
// component-rendering test setup).

export function getProposalStatusBadgeVariant(status: string): BadgeVariant {
  switch (status) {
    case "DRAFT":
      return "neutral";
    case "CONFIRMED":
      return "success";
    case "REJECTED":
      return "danger";
    case "SUPERSEDED":
      return "warning";
    default:
      return "neutral";
  }
}

export function getProposalStatusLabel(status: string): string {
  switch (status) {
    case "DRAFT":
      return "Draft";
    case "CONFIRMED":
      return "Confirmed";
    case "REJECTED":
      return "Rejected";
    case "SUPERSEDED":
      return "Superseded";
    default:
      return status;
  }
}

export function ProposalStatusBadge({ status }: { status: string }) {
  return <Badge variant={getProposalStatusBadgeVariant(status)}>{getProposalStatusLabel(status)}</Badge>;
}
