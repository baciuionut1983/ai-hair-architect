import { forwardRef, useId } from "react";
import type { TextareaHTMLAttributes } from "react";

import { cn } from "./cn";

const TEXTAREA_BASE_CLASSES =
  "w-full resize-y rounded-xl border bg-surface-alt px-3 py-2 text-sm text-foreground placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 disabled:cursor-not-allowed";

export function getTextareaClasses(hasError: boolean, className?: string): string {
  return cn(TEXTAREA_BASE_CLASSES, hasError ? "border-danger" : "border-border", className);
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, error, id, className, ...rest },
  ref
) {
  const generatedId = useId();
  const textareaId = id ?? generatedId;

  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <label htmlFor={textareaId} className="text-sm text-muted">
          {label}
        </label>
      ) : null}
      <textarea
        ref={ref}
        id={textareaId}
        className={getTextareaClasses(Boolean(error), className)}
        aria-invalid={Boolean(error)}
        {...rest}
      />
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </div>
  );
});

Textarea.displayName = "Textarea";
