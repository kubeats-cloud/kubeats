"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";

/**
 * Switch to another rep without going back to /team first.
 *
 * THIS IS WHERE THE PICKER BELONGS, and it is a smaller thing than what it
 * replaced. /report carried a grid of ~47 name chips — every rep on screen at
 * once, above a report about one of them — which existed because there was no
 * other way for an admin to pick a person. There is now: /team lists the team
 * and each name opens their hub. So the picker stops being "choose a rep from
 * nothing" and becomes "I am reading this one, show me that one", which is a
 * combobox on the page you are already on.
 *
 * THE PERIOD AND THE WEEK TRAVEL WITH YOU. An admin comparing two reps over
 * the same month is doing exactly what this control is for, and dropping them
 * back to the default month on every switch would make the comparison
 * impossible to hold. The current search params are carried across verbatim —
 * only the member in the path changes.
 *
 * `router.push` inside a transition, so the trigger can say it is working
 * rather than looking dead while the next hub's queries run.
 */
export function RepSwitcher({
  reps,
  current,
  search,
}: {
  reps: ComboboxOption[];
  current: string;
  /** The hub's current query string, without the leading "?". */
  search: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="w-full md:w-72">
      <Combobox
        label="Switch to another rep"
        options={reps}
        value={current}
        placeholder="Switch rep…"
        searchPlaceholder="Search by name"
        emptyMessage="No rep by that name."
        disabled={pending}
        onSelect={(value) => {
          // Selecting the person already on screen is a no-op, not a reload.
          if (value === current) return;
          const suffix = search ? `?${search}` : "";
          startTransition(() => router.push(`/team/${value}${suffix}`));
        }}
      />
    </div>
  );
}
