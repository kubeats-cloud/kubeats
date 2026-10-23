import Link from "next/link";
import { Card } from "@/components/ui/card";

/**
 * Admin #4 / Rep #6's summary cards — a number and the client's exact label,
 * each one a link to "the complete list" behind it (`/pending/follow-ups`).
 *
 * NO ICON, NO HINT, NO SUBLINE — the client's text names a count and a label
 * only. `Stat` on the Overview carries more because that screen's own design
 * asked for it; this one does not.
 */
function FollowUpCard({
  value,
  label,
  href,
}: {
  value: number;
  label: string;
  href: string;
}) {
  return (
    <Link prefetch={false} href={href} className="block min-h-11">
      <Card className="h-full gap-0 p-4 transition-colors hover:bg-muted/40">
        <p className="text-[26px] leading-none font-semibold tracking-tight tabular-nums">
          {value}
        </p>
        <p className="text-muted-foreground mt-2 text-[11px] font-medium tracking-wide">
          {label}
        </p>
      </Card>
    </Link>
  );
}

/** Admin #4 — three cards, in the order the client listed them. */
export function AdminFollowUpCards({
  counts,
}: {
  counts: { owned: number; missed: number; closed: number };
}) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3">
      <FollowUpCard
        value={counts.owned}
        label="Total Follow-ups Owned"
        href="/pending/follow-ups?status=owned"
      />
      <FollowUpCard
        value={counts.missed}
        label="Total Follow-ups Missed"
        href="/pending/follow-ups?status=missed"
      />
      <FollowUpCard
        value={counts.closed}
        label="Total Follow-ups Closed"
        href="/pending/follow-ups?status=closed"
      />
    </div>
  );
}

/** Rep #6 — two cards, Owned and Missed only. */
export function RepFollowUpCards({
  counts,
}: {
  counts: { owned: number; missed: number };
}) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-3">
      <FollowUpCard
        value={counts.owned}
        label="Total Number of Follow-ups Owned"
        href="/pending/follow-ups?status=owned"
      />
      <FollowUpCard
        value={counts.missed}
        label="Total Number of Follow-ups Missed"
        href="/pending/follow-ups?status=missed"
      />
    </div>
  );
}
