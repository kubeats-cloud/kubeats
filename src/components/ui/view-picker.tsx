"use client";

import { PlusIcon, RotateCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { TableView } from "@/lib/table-view";
import { cn } from "@/lib/utils";

/**
 * "Customise this table" — the one picker every table uses.
 *
 * ⚠ IT SHOWS AND HIDES WHAT IS ALREADY THERE. It adds no field, fetches
 * nothing, and narrows no query. A column the reader folds away was still
 * selected, still returned under the same RLS, and is still in the .xlsx —
 * which never renders a table component at all. `table-view.ts` makes the same
 * point from the storage side and is worth reading before changing either.
 *
 * ONE COMPONENT, FOUR TABLES, because the alternative is four pickers that
 * drift: one grows a "reset", another spells the empty state differently, a
 * third forgets `aria-expanded`. The tables differ only in what they pass as
 * `groups`.
 *
 * GROUPS ARE THE CATEGORIES. A flat table passes one unnamed group and gets a
 * plain list. The grid report passes one per band — Dashboard activities, Open,
 * Closed, No status — and each band header is itself a toggle, which is how a
 * reader turns off a whole category without ticking nine boxes. A group whose
 * columns are all hidden is the category being off; the header checkbox shows
 * that back to them.
 *
 * ACCESSIBILITY, the parts that are easy to get wrong here:
 *   - the trigger carries `aria-expanded` and an `aria-label` that says what it
 *     does, because a bare "+" announces as "plus button";
 *   - every toggle is a real `<label>` wrapping a real checkbox, so the hit
 *     area is the whole row and the keyboard reaches each one with Tab/Space;
 *   - the panel is Radix's popover, which already traps focus, closes on Escape
 *     and returns focus to the trigger;
 *   - the count of hidden columns rides on the trigger as text, not as a dot,
 *     so "this table is customised" is readable rather than merely visible.
 *
 * AT PHONE WIDTH the panel is capped and scrolls inside itself; the trigger
 * sits in the table's own header row rather than floating, so it cannot cover
 * content on a narrow screen.
 */

export interface ViewPickerGroup {
  /** Omitted for a flat table — the group then renders as a plain list. */
  label?: string;
  columns: { key: string; label: string }[];
}

export function ViewPicker({
  view,
  groups,
  label = "Customise columns",
  className,
}: {
  view: TableView;
  groups: ViewPickerGroup[];
  /** What the control is FOR, read out to a screen reader. */
  label?: string;
  className?: string;
}) {
  const everything = groups.flatMap((group) => group.columns.map((c) => c.key));
  const hidden = view.hiddenCount;

  // Nothing to choose between. A picker over one column is a control that can
  // only make the table worse, so it is not offered.
  if (everything.length < 2) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("h-9 gap-1.5", className)}
          // A "+" alone announces as "plus button". The label says what it
          // opens, and the count says whether anything is currently folded
          // away — which is the one piece of state the closed control has to
          // carry.
          aria-label={
            hidden > 0 ? `${label} — ${hidden} hidden` : label
          }
        >
          <PlusIcon className="size-4" aria-hidden />
          <span className="hidden sm:inline">Columns</span>
          {hidden > 0 && (
            <span className="bg-primary/10 text-primary rounded-full px-1.5 text-[11px] font-semibold tabular-nums">
              {hidden}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-64 p-0">
        <div className="border-border flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-medium">Show columns</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1 text-xs"
            onClick={view.showAll}
            disabled={hidden === 0}
          >
            <RotateCcwIcon className="size-3.5" aria-hidden />
            Reset
          </Button>
        </div>

        {/* Capped and scrolling: the status bands are generated from the
            vocabulary, so this list is as long as the client's process is and
            has no guaranteed height. */}
        <div className="max-h-[min(60vh,20rem)] overflow-y-auto p-1.5">
          {groups.map((group, index) => {
            const keys = group.columns.map((c) => c.key);
            const shownInGroup = keys.filter((key) => view.shows(key)).length;
            const allShown = shownInGroup === keys.length;
            const noneShown = shownInGroup === 0;

            return (
              <div key={group.label ?? `group-${index}`}>
                {group.label && (
                  <label className="hover:bg-accent flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-2 text-xs font-semibold tracking-wide uppercase">
                    {/*
                      TICKED MEANS "ALL OF THIS CATEGORY", and the count beside
                      it carries the in-between case.

                      The obvious shape here is a tri-state checkbox, and this
                      deliberately is not one: `ui/checkbox.tsx` renders its
                      Indicator unconditionally and styles only `data-checked`,
                      so Radix's `indeterminate` would draw a tick on an
                      unstyled box — a control that looks checked and reads as
                      unchecked. "3/9" says the same thing without lying, needs
                      no change to a shared primitive, and is readable rather
                      than merely visible.
                    */}
                    <Checkbox
                      checked={allShown}
                      onCheckedChange={() => view.setMany(keys, !allShown)}
                      aria-label={
                        allShown
                          ? `Hide every column in ${group.label}`
                          : `Show every column in ${group.label}`
                      }
                    />
                    <span className="min-w-0 flex-1 truncate py-2">
                      {group.label}
                    </span>
                    {!allShown && (
                      <span
                        className={cn(
                          "shrink-0 text-[11px] font-medium tabular-nums",
                          noneShown ? "text-muted-foreground/60" : "text-muted-foreground",
                        )}
                      >
                        {shownInGroup}/{keys.length}
                      </span>
                    )}
                  </label>
                )}

                <ul className={cn(group.label && "mb-1 ml-3")}>
                  {group.columns.map((column) => (
                    <li key={column.key}>
                      <label className="hover:bg-accent flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-2 text-sm">
                        <Checkbox
                          checked={view.shows(column.key)}
                          onCheckedChange={() => view.toggle(column.key)}
                        />
                        <span className="min-w-0 flex-1 truncate py-2">
                          {column.label}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        <p className="text-muted-foreground border-border border-t px-3 py-2 text-[11px]">
          Only changes what you see here. Downloads and other people&rsquo;s
          screens are unaffected.
        </p>
      </PopoverContent>
    </Popover>
  );
}
