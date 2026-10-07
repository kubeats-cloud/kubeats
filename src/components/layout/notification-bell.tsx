"use client";

import Link from "next/link";
import { BellIcon } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { describeAlert } from "@/lib/alert-kinds";
import type { NotificationItem } from "@/lib/notification-kinds";
import { cn } from "@/lib/utils";

/**
 * The notification bell.
 *
 * ⚠ A CLIENT COMPONENT FOR THE DROPDOWN AND NOTHING ELSE. Every item is
 * computed on the server by `notifications.ts` and handed down as a prop - this
 * file holds no fetch, no effect and no timer, so there is no second place
 * where "what is due" could be decided and disagree with the first. It opens a
 * popover and renders what it was given.
 *
 * ⚠ IT RENDERS `describeAlert()`, which is why that copy lives in
 * `alert-kinds.ts` rather than beside the query. The dashboard banner renders
 * the same function over the same five kinds, so a condition reads identically
 * wherever a rep meets it - the split that file's header describes exists for
 * exactly this import.
 *
 * ⚠ NOTHING HERE IS DISMISSIBLE, and that is the difference between this and
 * the banner. The banner reads `alert_events` and `alert-actions.ts` stamps
 * `seen_at` on a row. A bell item is not a row and has no `seen_at` to stamp:
 * it is a live reading of what is still owed, so the only way to clear a line
 * is to do the work. A dismiss control would have to either write a row this
 * bell does not read - doing nothing, visibly - or hide a thing that is still
 * true.
 */
export function NotificationBell({ items }: { items: NotificationItem[] }) {
  const count = items.length;

  return (
    <Popover>
      <PopoverTrigger
        className="text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:ring-ring relative flex size-11 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
        aria-label={
          count === 0
            ? "Notifications"
            : `Notifications, ${count} ${count === 1 ? "item" : "items"} needing attention`
        }
      >
        <BellIcon className="size-5" aria-hidden />

        {/*
          HIDDEN AT ZERO, as asked. `count > 0 &&` rather than a CSS rule: an
          empty badge still occupies its ring and reads as a dot, which on a
          bell means "something is waiting" - the opposite of what no items
          means.

          The number is NOT announced here. The trigger's aria-label above
          already carries it as a sentence, and a bare "3" read out between the
          label and the icon is noise to a screen reader.
        */}
        {count > 0 && (
          <span
            aria-hidden
            className="bg-danger text-danger-foreground absolute top-1.5 right-1.5 flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-4 font-semibold tabular-nums"
          >
            {count > 9 ? "9+" : count}
          </span>
        )}
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-border border-b px-3 py-2">
          <p className="text-sm font-medium">Needs attention</p>
          <p className="text-muted-foreground text-xs">
            {count === 0
              ? "Nothing right now."
              : "What is still open, as of this page load."}
          </p>
        </div>

        {count === 0 ? (
          <p className="text-muted-foreground px-3 py-6 text-center text-sm">
            You are all caught up.
          </p>
        ) : (
          <ul className="max-h-80 overflow-y-auto">
            {items.map((item) => {
              const { title, detail, tone } = describeAlert({
                id: item.id,
                kind: item.kind,
                forDate: "",
                count: item.count,
                weekStart: item.weekStart,
                seenAt: null,
              });

              return (
                <li key={item.id} className="border-border border-b last:border-0">
                  <Link
                    href={item.href}
                    className="hover:bg-secondary/60 focus-visible:bg-secondary/60 block px-3 py-2.5 transition-colors focus-visible:outline-none"
                  >
                    <div className="flex items-start gap-2">
                      <span
                        aria-hidden
                        className={cn(
                          "mt-1.5 size-2 shrink-0 rounded-full",
                          tone === "danger" ? "bg-danger" : "bg-warning",
                        )}
                      />
                      <div className="min-w-0">
                        {/*
                          A TEAM LEAD'S LINE NAMES THE REP, a rep's does not.
                          "Rep X: 2 follow-ups were missed" is the shape the
                          brief asks for, and prefixing a rep's own item with
                          their own name would read as somebody else's.
                        */}
                        <p className="text-sm leading-snug font-medium">
                          {item.memberName ? `${item.memberName}: ` : ""}
                          {title}
                        </p>
                        <p className="text-muted-foreground mt-0.5 text-xs leading-snug">
                          {detail}
                        </p>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
