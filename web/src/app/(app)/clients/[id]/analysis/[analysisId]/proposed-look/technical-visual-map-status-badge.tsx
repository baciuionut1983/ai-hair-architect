import { Badge, type BadgeVariant } from "@/components/ui";

// Technical Visual Map, Stage 4 -- the map lifecycle status badge. Mirrors
// proposed-look-status-badge.tsx's own pattern exactly: exported pure
// variant/label resolvers alongside the component so a plain .test.ts can
// assert the mapping without any rendering environment. Deliberately no
// REJECTED case -- a TechnicalVisualMap has no reject transition.

export function getTechnicalVisualMapStatusBadgeVariant(status: string): BadgeVariant {
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

export function getTechnicalVisualMapStatusLabel(status: string): string {
  switch (status) {
    case "DRAFT":
      return "Draft";
    case "CONFIRMED":
      return "Confirmed";
    case "SUPERSEDED":
      return "Superseded";
    default:
      return status;
  }
}

export function TechnicalVisualMapStatusBadge({ status }: { status: string }) {
  return <Badge variant={getTechnicalVisualMapStatusBadgeVariant(status)}>{getTechnicalVisualMapStatusLabel(status)}</Badge>;
}
