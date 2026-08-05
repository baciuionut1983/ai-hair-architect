import { AlertCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "./cn";

export const ERROR_STATE_BASE_CLASSES =
  "flex flex-col items-center gap-2 rounded-2xl border border-danger/40 bg-danger/5 p-8 text-center";

export interface ErrorStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function ErrorState({ icon: Icon = AlertCircle, title, description, action, className }: ErrorStateProps) {
  return (
    <div className={cn(ERROR_STATE_BASE_CLASSES, className)} role="alert">
      <Icon className="h-8 w-8 text-danger" aria-hidden="true" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? <p className="text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
