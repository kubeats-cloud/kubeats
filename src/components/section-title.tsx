import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Divides a screen into labelled blocks — "Today", "This week", "Open loops".
 * Renders an h2, so a screen's headings stay in a sensible order for
 * screen readers rather than being styled text pretending to be a heading.
 */
export function SectionTitle({
  children,
  action,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-3 flex items-center justify-between gap-3", className)}>
      <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
        {/* A small flame tick — brand as punctuation, not as background. */}
        <span aria-hidden className="brand-rule h-4 w-1 shrink-0 rounded-full" />
        {children}
      </h2>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
