import { Loader2 } from "lucide-react";
import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const BUTTON_BASE_CLASSES =
  "inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50 disabled:cursor-not-allowed";

const BUTTON_VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-background hover:bg-accent/90",
  secondary: "bg-surface-alt text-foreground border border-border hover:bg-surface",
  danger: "bg-danger text-white hover:bg-danger/90",
  ghost: "bg-transparent text-foreground hover:bg-surface-alt"
};

export function getButtonClasses(variant: ButtonVariant = "primary", className?: string): string {
  return cn(BUTTON_BASE_CLASSES, BUTTON_VARIANT_CLASSES[variant], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", loading = false, disabled, className, children, ...rest },
  ref
) {
  return (
    <button ref={ref} className={getButtonClasses(variant, className)} disabled={disabled || loading} {...rest}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
});

Button.displayName = "Button";
