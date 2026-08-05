import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { HTMLAttributes, ReactElement, ReactNode } from "react";

import { cn } from "./cn";

export type AlertVariant = "info" | "success" | "warning" | "error";

const ALERT_BASE_CLASSES = "flex items-start gap-3 rounded-xl border p-3 text-sm";

const ALERT_VARIANT_CLASSES: Record<AlertVariant, string> = {
  info: "border-accent-secondary/40 bg-accent-secondary/10",
  success: "border-success/40 bg-success/10",
  warning: "border-warning/40 bg-warning/10",
  error: "border-danger/40 bg-danger/10"
};

const ALERT_ICONS: Record<AlertVariant, LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle
};

export function getAlertClasses(variant: AlertVariant = "info", className?: string): string {
  return cn(ALERT_BASE_CLASSES, ALERT_VARIANT_CLASSES[variant], className);
}

export function getAlertIcon(variant: AlertVariant = "info"): LucideIcon {
  return ALERT_ICONS[variant];
}

const ALERT_ICON_CLASSES = "mt-0.5 h-4 w-4 shrink-0 text-foreground";

// Rendered through a switch (returning an already-created element) rather
// than assigning the resolved icon component to a local variable and using
// it as <Icon />, which react-hooks/static-components flags as creating a
// component during render. getAlertIcon() above stays exported purely for
// tests that assert the variant-to-icon mapping.
function renderAlertIcon(variant: AlertVariant): ReactElement {
  switch (variant) {
    case "success":
      return <CheckCircle2 className={ALERT_ICON_CLASSES} aria-hidden="true" />;
    case "warning":
      return <AlertTriangle className={ALERT_ICON_CLASSES} aria-hidden="true" />;
    case "error":
      return <XCircle className={ALERT_ICON_CLASSES} aria-hidden="true" />;
    case "info":
    default:
      return <Info className={ALERT_ICON_CLASSES} aria-hidden="true" />;
  }
}

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant;
  title?: string;
  children?: ReactNode;
}

export function Alert({ variant = "info", title, className, children, ...rest }: AlertProps) {
  return (
    <div className={getAlertClasses(variant, className)} role="alert" {...rest}>
      {renderAlertIcon(variant)}
      <div className="flex flex-col gap-0.5 text-foreground">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className="text-muted">{children}</div> : null}
      </div>
    </div>
  );
}
