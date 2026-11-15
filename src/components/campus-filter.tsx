"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { campusLabel, type Campus } from "@/lib/campus-display";

/**
 * THE one campus picker, for every screen with a data table.
 *
 * ONE COMPONENT, THREE WAYS TO TELL IT WHAT CHANGED — because the screens it
 * serves keep their filter state in three different places, and forking the
 * control three ways is exactly the duplication this is meant to avoid:
 *
 *   onChange        the screen owns the URL (Review's `apply()`, the registry's
 *                   `pick()`). The control reports the new id and nothing else.
 *   name            a server-rendered `<form>` (Activity's filters on
 *                   /institutes?view=activity and /activity). A native select
 *                   is submitted with the form; no router involved.
 *   neither         the screen has no filter machinery of its own (Team). The
 *                   control writes the URL itself, preserving every other
 *                   parameter, and drops `page` so a narrowed list starts at
 *                   the top.
 *
 * HIDDEN WHEN THERE IS NOTHING TO CHOOSE. `campuses` is already the permitted
 * list — an admin's every campus, a team lead's or rep's own one — so a list of
 * one renders nothing. A disabled dropdown with a single option is furniture;
 * more importantly, the value it would hold is not something the reader can
 * change, and RLS has already narrowed the data to it.
 *
 * IT NARROWS THE QUERY, NOT THE ROWS ALREADY SENT. Every screen this is used on
 * passes the selection to its server-side data layer — `getRegistryPage`,
 * `listTeamVisits`, `listCallReports`, `getTeamWeek`, the activity models — so
 * the filter is applied where the data is read. This component never hides
 * table rows in the browser.
 *
 * "ALL CAMPUSES" IS AN EMPTY VALUE, NEVER A SENTINEL URL. The native select
 * posts "" and the URL simply loses the key, so no downstream schema has to
 * learn a magic string; Radix cannot hold an empty string, so the controlled
 * select maps its absence to `ALL` locally and strips it on the way out.
 */
const ALL = "all";

export function CampusFilter({
  campuses,
  value,
  onChange,
  name,
  paramName = "campus",
  extraParams,
  resetParams = ["page"],
  label = "Campus",
  id = "campus-filter",
  className = "grid min-w-0 gap-1",
}: {
  /** The campuses this reader may choose between. One hides the control. */
  campuses: Campus[];
  /** Current selection. Absent/empty means every permitted campus. */
  value?: string;
  /** Controlled mode: the screen decides where the selection goes. */
  onChange?: (next: string) => void;
  /** Form mode: the field name a server `<form>` submits. */
  name?: string;
  /** Navigate mode: the query key written to the URL. */
  paramName?: string;
  /** Navigate mode: other keys to restate (a tab, a card's own filters). */
  extraParams?: Record<string, string>;
  /** Navigate mode: keys removed on change. `page` by default. */
  resetParams?: string[];
  label?: string;
  id?: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  if (campuses.length <= 1) return null;

  const fromUrl = params.get(paramName) ?? "";
  const current = value ?? fromUrl;

  function change(next: string) {
    const real = next === ALL ? "" : next;
    onChange?.(real);
    if (onChange || name) return;

    const search = new URLSearchParams(params.toString());
    if (real) search.set(paramName, real);
    else search.delete(paramName);
    for (const key of resetParams) search.delete(key);
    for (const [key, nextValue] of Object.entries(extraParams ?? {})) {
      search.set(key, nextValue);
    }
    const query = search.toString();
    startTransition(() =>
      router.push(query ? `${pathname}?${query}` : pathname),
    );
  }

  return (
    <div className={className}>
      <Label
        htmlFor={id}
        className="text-muted-foreground text-xs font-medium"
      >
        {label}
      </Label>
      {name ? (
        // Native rather than Radix: this one has to be submitted BY the form it
        // sits in, and a hidden input mirroring a portal-rendered select would
        // be one more thing to keep in step. Empty means every campus.
        <select
          id={id}
          name={name}
          defaultValue={current}
          className="bg-card min-h-11 w-full min-w-0 rounded-md border px-2 text-sm"
        >
          <option value="">All campuses</option>
          {campuses.map((campus) => (
            <option key={campus.id} value={campus.id}>
              {campusLabel(campus)}
            </option>
          ))}
        </select>
      ) : (
        <Select
          value={current || ALL}
          onValueChange={change}
          disabled={pending}
        >
          <SelectTrigger id={id} className="h-10 w-full" aria-label={label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All campuses</SelectItem>
            {campuses.map((campus) => (
              <SelectItem key={campus.id} value={campus.id}>
                {campusLabel(campus)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
