import { Badge } from "@/components/ui";

import { getVideoDemonstrationStatusBadgeVariant, getVideoDemonstrationStatusLabel, type VideoDemonstrationUiStatus } from "./video-demonstration-logic";

// Video UI, Result Visualization -- mirrors photo-preview-status-badge.tsx
// exactly. Status is never communicated by color alone (task §16): the
// badge always renders the human label text alongside its variant color.
export function VideoDemonstrationStatusBadge({ status }: { status: VideoDemonstrationUiStatus }) {
  return <Badge variant={getVideoDemonstrationStatusBadgeVariant(status)}>{getVideoDemonstrationStatusLabel(status)}</Badge>;
}
