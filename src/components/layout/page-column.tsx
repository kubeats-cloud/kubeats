import type { ReactNode } from "react";

/**
 * A reading-width column.
 *
 * The shell opens up to 6xl for admins so their tables and dashboards can use a
 * monitor. Forms must not follow it there: a label-and-field column stretched
 * to 1150px is harder to fill in, not easier, and an input the width of a desk
 * looks like nobody decided anything. Screens that are shaped like a form wrap
 * themselves in this and stay where the eye can hold them.
 */
export function PageColumn({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-2xl">{children}</div>;
}
