import Link from "next/link";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Today in three numbers, above the plan itself.
 *
 * The tiles carry the counts so the plan card below can get on with being a
 * list — the same figures in both places would only invite them to disagree.
 * Open loops is deliberately not week-scoped: a session left open a fortnight
 * ago is the one that needs chasing today.
 */
export function TodaySnapshot({
  planned,
  held,
  openLoops,
}: {
  planned: number;
  held: number;
  openLoops: number;
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
    <div className="mb-5 grid grid-cols-3 gap-3 md:mb-6 md:max-w-2xl">
      <Tile label="Planned" value={planned} />
      <Tile label="Held" value={held} valueClassName={heldTone} />
      <Tile
        label="Open loops"
        value={openLoops}
        valueClassName={openLoops > 0 ? "text-warning" : "text-muted-foreground"}
        href="/pending"
      />
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
