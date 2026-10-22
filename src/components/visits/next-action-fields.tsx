"use client";

import { PhoneIcon, UsersRoundIcon } from "lucide-react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * What happens next: a call, a meeting, or nothing (A3).
 *
 * ONE COMPONENT, TWO FORMS. Log Visit asks it at the end of a visit, and the
 * recovery form asks it again for a report that never went through. A second
 * copy would be free to drift — one form asking for a note the other does not,
 * or offering a different default day — and the two would then disagree about
 * what a follow-up is.
 *
 * "NOTHING" IS A REAL ANSWER and is the default. Not every visit leaves
 * something owed: an institute that said no is finished, and a required field
 * here would make a rep invent an errand to get past it. `visits.next_action`
 * is nullable for the same reason (0038), and every visit logged before this
 * existed carries null.
 *
 * TOMORROW IS PRE-FILLED rather than today. A follow-up settled at the end of a
 * visit is, by default, the next working day's business — and the date comes
 * from `defaultFollowUpDue()`, which is `todayISO()` + 1 and therefore the
 * Asia/Kolkata day, never the browser's. `close_visit()` falls back to
 * `app_today() + 1` for a caller that sends none, so the two agree by
 * construction.
 *
 * WHAT THIS IS NOT: Rule 5's follow-up date. That one lives on the visit, is
 * demanded by an OPEN status, and answers "when is this institute next owed
 * attention". This answers "what will I do, and when". They are usually the
 * same day and are different questions, so they get different fields —
 * conflating them would make one of the two unanswerable.
 */
export interface NextActionValue {
  kind: "" | "call" | "meeting";
  due: string;
  note: string;
}

export function NextActionFields({
  value,
  onChange,
  fieldErrors,
  defaultDue,
}: {
  value: NextActionValue;
  onChange: (patch: Partial<NextActionValue>) => void;
  fieldErrors: Record<string, string>;
  /** `defaultFollowUpDue()` — tomorrow, in the app's own timezone. */
  defaultDue: string;
}) {
  const choose = (kind: NextActionValue["kind"]) => {
    // Picking an action fills the date if it is empty; clearing the action
    // clears the date with it, so the pair rule in the schema cannot be hit by
    // a leftover value the rep cannot see.
    if (kind === "") onChange({ kind: "", due: "", note: "" });
    else onChange({ kind, due: value.due || defaultDue });
  };

  const options = [
    { key: "call" as const, label: "Call", Icon: PhoneIcon },
    { key: "meeting" as const, label: "Meeting", Icon: UsersRoundIcon },
  ];

  return (
    <div className="space-y-2">
      {/* Posted as hidden inputs rather than as the controls themselves: the
          buttons below are a segmented control, and a <button> carries no
          value into FormData. */}
      <input type="hidden" name="next_action" value={value.kind} />
      <input type="hidden" name="follow_up_due" value={value.kind ? defaultDue : ""} />

      <Label>Next Action</Label>

      <div className="flex flex-wrap gap-2">
        {options.map(({ key, label, Icon }) => {
          const on = value.kind === key;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={on}
              onClick={() => choose(on ? "" : key)}
              className={cn(
                "focus-visible:ring-ring inline-flex min-h-11 items-center gap-2 rounded-md border px-4 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
                on
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card hover:bg-accent",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </button>
          );
        })}
      </div>

      {fieldErrors.next_action && (
        <p className="text-danger text-xs">{fieldErrors.next_action}</p>
      )}

    </div>
  );
}
