import { Loader2 } from "lucide-react";

import { cn } from "./cn";

export const LOADING_STATE_BASE_CLASSES = "flex items-center justify-center gap-2 p-6 text-sm text-muted";

export const DEFAULT_LOADING_LABEL = "Loading...";

export interface LoadingStateProps {
  label?: string;
  className?: string;
}

export function LoadingState({ label = DEFAULT_LOADING_LABEL, className }: LoadingStateProps) {
  return (
    <div className={cn(LOADING_STATE_BASE_CLASSES, className)} role="status">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
