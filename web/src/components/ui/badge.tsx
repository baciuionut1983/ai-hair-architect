import type { HTMLAttributes } from "react";

import { cn } from "./cn";

export type BadgeVariant = "neutral" | "success" | "warning" | "danger";

const BADGE_BASE_CLASSES = "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium";

const BADGE_VARIANT_CLASSES: Record<BadgeVariant, string> = {
  neutral: "bg-surface-alt text-muted",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-danger/15 text-danger"
};

export function getBadgeClasses(variant: BadgeVariant = "neutral", className?: string): string {
  return cn(BADGE_BASE_CLASSES, BADGE_VARIANT_CLASSES[variant], className);
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({ variant = "neutral", className, children, ...rest }: BadgeProps) {
  return (
    <span className={getBadgeClasses(variant, className)} {...rest}>
      {children}
    </span>
  );
}
