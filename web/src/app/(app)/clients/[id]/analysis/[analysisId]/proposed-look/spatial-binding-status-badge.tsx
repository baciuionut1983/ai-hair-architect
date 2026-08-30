import { Badge, type BadgeVariant } from "@/components/ui";

// Technical Visual Map, Stage 5C -- the spatial binding lifecycle status
// badge. Mirrors technical-visual-map-status-badge.tsx exactly -- no
// REJECTED state, same variant/label resolvers exported alongside the
// component so a plain .test.ts can assert the mapping.

export function getSpatialBindingStatusBadgeVariant(status: string): BadgeVariant {
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

export function getSpatialBindingStatusLabel(status: string): string {
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

export function SpatialBindingStatusBadge({ status }: { status: string }) {
  return <Badge variant={getSpatialBindingStatusBadgeVariant(status)}>{getSpatialBindingStatusLabel(status)}</Badge>;
}
