import Link from "next/link";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Today in three numbers, above the plan itself.
 *
 * The tiles carry the counts so the plan card below can get on with being a
 * list — the same figures in both places would only invite them to disagree.
 *
 * THERE WERE THREE. "Open loops" counted visits still at "Set" and not closed,
 * and it is gone (decision D7). Pending means something wider now — every
 * institute whose current status is OPEN — so the tile would have sat here
 * counting a different thing under the same word, one tap away from the screen
 * that disagreed with it. Two "open" numbers that do not match is how a team
 * stops trusting both.
 */
export function TodaySnapshot({
  planned,
  held,
}: {
  planned: number;
  held: number;
}) {
  const heldTone =
    planned === 0
      ? "text-muted-foreground"
      : held === planned
        ? "text-success"
        : held > 0
          ? "text-warning"
          : "text-danger";

  return (
    <div className="mb-5 grid grid-cols-2 gap-3 md:mb-6 md:max-w-md">
      <Tile label="Planned" value={planned} />
      <Tile label="Held" value={held} valueClassName={heldTone} />
    </div>
  );
}

function Tile({
  label,
  value,
  valueClassName,
  href,
}: {
  label: string;
  value: number;
  valueClassName?: string;
  href?: string;
}) {
  const body = (
    <>
      <p
        className={cn(
          "text-[26px] leading-none font-semibold tracking-tight tabular-nums md:text-3xl",
          valueClassName,
        )}
      >
        {value}
      </p>
      <p className="text-muted-foreground mt-2 text-[11px] font-medium tracking-wide">
        {label}
      </p>
    </>
  );

  if (href) {
    return (
      <Card className="gap-0 p-0">
        <Link
          href={href}
          className="hover:bg-accent flex min-h-[76px] flex-col justify-center rounded-xl px-3 py-4 text-center transition-colors"
        >
          {body}
        </Link>
      </Card>
    );
  }

  return (
    <Card className="min-h-[76px] justify-center gap-0 px-3 py-4 text-center">
      {body}
    </Card>
  );
}
