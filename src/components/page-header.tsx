import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The top of every screen. Keeping it in one place means the eyebrow, title and
 * action button sit in exactly the same spot on all six tabs, which is what
 * makes a small app feel finished.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  action,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  /** Usually a single button, right-aligned against the title. */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-6 md:mb-8", className)}>
      {eyebrow && (
        <p className="text-primary mb-1.5 text-[11px] font-semibold tracking-[0.12em] uppercase">
          {eyebrow}
        </p>
      )}
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-balance md:text-[28px]">
          {title}
        </h1>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {description && (
        <p className="text-muted-foreground mt-2 max-w-prose text-sm leading-relaxed">
          {description}
        </p>
      )}
    </header>
  );
}
