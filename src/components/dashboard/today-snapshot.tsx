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
    <div className="mb-4 grid grid-cols-3 gap-3">
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
      <p className={cn("text-2xl font-semibold tabular-nums", valueClassName)}>
        {value}
      </p>
      <p className="text-muted-foreground mt-0.5 text-xs">{label}</p>
    </>
  );

  if (href) {
    return (
      <Card className="gap-0 p-0">
        <Link
          href={href}
          className="hover:bg-accent flex min-h-16 flex-col justify-center rounded-lg px-3 py-3 text-center transition-colors"
        >
          {body}
        </Link>
      </Card>
    );
  }

  return (
    <Card className="min-h-16 justify-center gap-0 px-3 py-3 text-center">
      {body}
    </Card>
  );
}
