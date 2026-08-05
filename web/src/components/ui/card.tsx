import { forwardRef } from "react";
import type { HTMLAttributes } from "react";

import { cn } from "./cn";

export type CardVariant = "default" | "interactive";

const CARD_BASE_CLASSES = "rounded-2xl border border-border bg-surface p-4 shadow-panel";

const CARD_VARIANT_CLASSES: Record<CardVariant, string> = {
  default: "",
  interactive:
    "cursor-pointer transition-colors hover:bg-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
};

export function getCardClasses(variant: CardVariant = "default", className?: string): string {
  return cn(CARD_BASE_CLASSES, CARD_VARIANT_CLASSES[variant], className);
}

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { variant = "default", className, children, ...rest },
  ref
) {
  return (
    <div ref={ref} className={getCardClasses(variant, className)} {...rest}>
      {children}
    </div>
  );
});

Card.displayName = "Card";
