/**
 * The Activity tab's four cards, as plain data.
 *
 * ⚠ DELIBERATELY NOT IN `activity-tabs.tsx`. That file is a client component,
 * and exporting a value from a `"use client"` module turns it into a client
 * reference in any server component that imports it — `ACTIVITY_TABS.some()`
 * in `app/(app)/activity/page.tsx` then throws "is not a function" during SSR
 * and the whole page falls back to an error placeholder. Data the server has
 * to evaluate lives here, in a module with no directive.
 */
export type ActivityTabKey = "rep" | "call" | "pipeline" | "institute";

export const ACTIVITY_TABS: {
  key: ActivityTabKey;
  label: string;
  description: string;
}[] = [
  { key: "rep", label: "Rep Activity", description: "One row per rep, by activity." },
  { key: "call", label: "Call Activity", description: "One row per rep, by call status." },
  { key: "pipeline", label: "Pipeline by Rep", description: "Where every institute stands now." },
  { key: "institute", label: "Institute-Wise Activity", description: "One row per institute." },
];

export const DEFAULT_ACTIVITY_TAB: ActivityTabKey = "rep";

export function isActivityTabKey(value: string | undefined): value is ActivityTabKey {
  return ACTIVITY_TABS.some((tab) => tab.key === value);
}
