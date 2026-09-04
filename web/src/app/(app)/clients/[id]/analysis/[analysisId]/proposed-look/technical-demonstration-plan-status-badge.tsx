import { Badge, type BadgeVariant } from "@/components/ui";

// Technical Demonstration, Stage 2 -- the plan lifecycle status badge.
// Mirrors technical-visual-map-status-badge.tsx exactly: exported pure
// variant/label resolvers alongside the component so a plain .test.ts can
// assert the mapping without any rendering environment. Deliberately no
// REJECTED case -- a Technical Demonstration Plan has no reject transition
// (a derived artifact of an already-confirmed proposal, never an
// independently-evaluated option).

export function getTechnicalDemonstrationPlanStatusBadgeVariant(status: string): BadgeVariant {
  switch (status) {
    case "DRAFT":
      return "neutral";
    case "CONFIRMED":
      return "success";
    case "SUPERSEDED":
      return "warning";
    default:
      return "neutral";
  }
}

// "TECHNICAL PLAN CONFIRMED" wording for the confirmed state, per the
// Decision Lock's own explicit UI requirement. DRAFT/SUPERSEDED use plain,
// short labels -- the emphatic all-caps confirmation is reserved for the
// one moment it actually matters (a professional-approved authority
// boundary), not applied to every status uniformly.
export function getTechnicalDemonstrationPlanStatusLabel(status: string): string {
  switch (status) {
    case "DRAFT":
      return "Draft";
    case "CONFIRMED":
      return "TECHNICAL PLAN CONFIRMED";
    case "SUPERSEDED":
      return "Superseded";
    default:
      return status;
  }
}

export function TechnicalDemonstrationPlanStatusBadge({ status }: { status: string }) {
  return <Badge variant={getTechnicalDemonstrationPlanStatusBadgeVariant(status)}>{getTechnicalDemonstrationPlanStatusLabel(status)}</Badge>;
}
