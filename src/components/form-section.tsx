import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * One block of a form.
 *
 * The long screens in this app — logging a visit, filing a closing report,
 * registering an institute — are the ones a rep meets standing up, one-handed,
 * at a gate. A wall of fields is the failure mode: everything the same size,
 * nothing telling you where one question ends and the next begins.
 *
 * So a form is a short stack of these instead. Each has a title in the same
 * place, an optional line saying why it is being asked, and the same internal
 * spacing, which is what lets a rep scroll and know how much is left. The
 * consistency is the point; a section that styles itself is a section that
 * drifts.
 */
export function FormSection({
  title,
  description,
  aside,
  children,
  className,
}: {
  /**
   * Optional, and almost always given.
   *
   * A section with ONE self-labelling field is the exception: the closing
   * report's "Notes" is a single textarea whose own label names the
   * field, and a heading above it repeating the same word is one label
   * too many. Leaving it off keeps the card, the padding and the rhythm — only
   * the duplicated heading goes.
   *
   * Everything else names its section. Reaching for this because a title is
   * hard to write usually means the section is really two.
   */
  title?: string;
  /** One line, in plain words, on why this is being asked. */
  description?: string;
  /** Sits opposite the title — a count, a badge, a small action. */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const hasHeader = Boolean(title || description || aside);

  return (
    <Card className={cn("gap-0 p-5 md:p-6", className)}>
      {hasHeader && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && (
              <h2 className="text-[15px] leading-tight font-semibold tracking-tight">
                {title}
              </h2>
            )}
            {description && (
              <p className="text-muted-foreground mt-1 max-w-prose text-xs leading-relaxed">
                {description}
              </p>
            )}
          </div>
          {aside && <div className="shrink-0">{aside}</div>}
        </div>
      )}
      <div className="space-y-4">{children}</div>
    </Card>
  );
}

/**
 * A field's label, with the required mark in one place.
 *
 * An asterisk drawn by hand in twenty places is an asterisk that is missing in
 * one of them, and a required field a rep only discovers by pressing Save is
 * the most annoying kind of form.
 */
export function FieldLabel({
  htmlFor,
  children,
  required,
  hint,
}: {
  htmlFor?: string;
  children: ReactNode;
  required?: boolean;
  /** Sits to the right, quieter — units, formats, "optional". */
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <label
        htmlFor={htmlFor}
        className="text-[13px] leading-none font-medium tracking-tight"
      >
        {children}
        {required && (
          <>
            <span className="text-danger ml-0.5" aria-hidden>
              *
            </span>
            <span className="sr-only"> (required)</span>
          </>
        )}
      </label>
      {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
    </div>
  );
}

/**
 * A group of related controls inside a section — a checkbox list, a row of
 * choices. Keeps the gap between "the question" and "the answers" the same
 * everywhere it appears.
 */
export function FieldGroup({
  label,
  required,
  hint,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={cn("space-y-2.5", className)}>
      <legend className="mb-2.5 flex w-full items-baseline justify-between gap-3">
        <span className="text-[13px] leading-none font-medium tracking-tight">
          {label}
          {required && (
            <>
              <span className="text-danger ml-0.5" aria-hidden>
                *
              </span>
              <span className="sr-only"> (required)</span>
            </>
          )}
        </span>
        {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
      </legend>
      {children}
    </fieldset>
  );
}
