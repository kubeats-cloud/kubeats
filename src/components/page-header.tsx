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
    <header className={cn("mb-5", className)}>
      {eyebrow && (
        <p className="text-primary text-xs font-semibold tracking-widest uppercase">
          {eyebrow}
        </p>
      )}
      <div className="flex items-start justify-between gap-3">
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1>
        {action && <div className="mt-1 shrink-0">{action}</div>}
      </div>
      {description && (
        <p className="text-muted-foreground mt-1.5 text-sm">{description}</p>
      )}
    </header>
  );
}
