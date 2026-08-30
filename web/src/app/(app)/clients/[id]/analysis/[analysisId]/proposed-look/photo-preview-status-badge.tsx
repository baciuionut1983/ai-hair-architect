import { Badge } from "@/components/ui";
import type { PhotoPreviewGenerationStatus } from "@/lib/photo-preview-generation-repository";

import { getPhotoPreviewStatusBadgeVariant, getPhotoPreviewStatusLabel } from "./photo-preview-logic";

// Real AI Photo Preview, Stage 3 -- mirrors spatial-binding-status-badge.tsx
// exactly. Status is never communicated by color alone (task #29): the badge
// always renders the human label text alongside its variant color.
export function PhotoPreviewStatusBadge({ status }: { status: PhotoPreviewGenerationStatus }) {
  return <Badge variant={getPhotoPreviewStatusBadgeVariant(status)}>{getPhotoPreviewStatusLabel(status)}</Badge>;
}
