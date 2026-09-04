"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Building2Icon, ChevronRightIcon, SearchIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/states";
import { InstituteStatusBadge } from "@/components/institutes/status-badge";
import type { Institute } from "@/lib/institutes";
import {
  class12Total,
  streamCount,
  TYPE_LABELS,
  type InstituteType,
} from "@/lib/validation/institute";
import { cn } from "@/lib/utils";

const ALL = "__all__";

/**
 * Search and filtering run in the browser over the list the server already
 * sent. At a few hundred institutes that is a small payload and every keystroke
 * responds instantly — worth more here than server-side filtering, which would
 * put a network round trip between a rep and every character they type.
 *
 * Filter options are derived from the institutes actually present, so the
 * dropdowns never offer a state with nothing in it.
 */
export function InstitutesBrowser({ institutes }: { institutes: Institute[] }) {
  const [search, setSearch] = useState("");
  const [state, setState] = useState(ALL);
  const [city, setCity] = useState(ALL);
  const [type, setType] = useState(ALL);
  const [boards, setBoards] = useState<string[]>([]);

  const availableStates = useMemo(
    () => [...new Set(institutes.map((i) => i.state).filter(Boolean))].sort() as string[],
    [institutes],
  );

  const availableCities = useMemo(
    () =>
      [
        ...new Set(
          institutes
            .filter((i) => state === ALL || i.state === state)
            .map((i) => i.city)
            .filter(Boolean),
        ),
      ].sort() as string[],
    [institutes, state],
  );

  const availableBoards = useMemo(
    () => [...new Set(institutes.flatMap((i) => i.boards ?? []))].sort(),
    [institutes],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return institutes.filter((i) => {
      if (term) {
        const haystack = `${i.name} ${i.city ?? ""} ${i.area ?? ""}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      if (state !== ALL && i.state !== state) return false;
      if (city !== ALL && i.city !== city) return false;
      if (type !== ALL && i.type !== type) return false;
      if (boards.length > 0 && !(i.boards ?? []).some((b) => boards.includes(b)))
        return false;
      return true;
    });
  }, [institutes, search, state, city, type, boards]);

  function toggleBoard(board: string) {
    setBoards((current) =>
      current.includes(board)
        ? current.filter((b) => b !== board)
        : [...current, board],
    );
  }

  if (institutes.length === 0) {
    return (
      <EmptyState
        icon={Building2Icon}
        title="No institutes registered yet"
        description="An institute has to exist here before anything can be logged against it. Register the first one to get started."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative md:max-w-lg">
        <SearchIcon
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          aria-hidden
        />
        <Input
          className="h-11 pl-9"
          placeholder="Search by name, city or area"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search institutes"
        />
      </div>

      <div className="grid grid-cols-3 gap-2 md:max-w-2xl">
        <Select
          value={state}
          onValueChange={(v) => {
            setState(v);
            setCity(ALL);
          }}
        >
          <SelectTrigger className="h-11 w-full" aria-label="Filter by state">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All states</SelectItem>
            {availableStates.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={city} onValueChange={setCity}>
          <SelectTrigger className="h-11 w-full" aria-label="Filter by city">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All cities</SelectItem>
            {availableCities.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="h-11 w-full" aria-label="Filter by type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All types</SelectItem>
            {(Object.keys(TYPE_LABELS) as InstituteType[]).map((t) => (
              <SelectItem key={t} value={t}>
                {TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {availableBoards.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {availableBoards.map((board) => {
            const on = boards.includes(board);
            return (
              <button
                key={board}
                type="button"
                onClick={() => toggleBoard(board)}
                aria-pressed={on}
                className={cn(
                  "min-h-9 rounded-full border px-3 text-xs font-medium transition-colors",
                  on
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card hover:bg-accent",
                )}
              >
                {board}
              </button>
            );
          })}
        </div>
      )}

      <p className="text-muted-foreground text-xs">
        {filtered.length} of {institutes.length} institute
        {institutes.length === 1 ? "" : "s"}
      </p>

      {filtered.length === 0 ? (
        <EmptyState
          title="Nothing matches those filters"
          description="Try clearing the search or widening the filters."
        />
      ) : (
        <>
          {/* Phone: cards, one per row, thumb-sized. */}
          <ul className="space-y-3 md:hidden">
            {filtered.map((institute) => (
              <li key={institute.id}>
                <InstituteCard institute={institute} />
              </li>
            ))}
          </ul>

          {/* Desktop: the registry as a register — scannable down a column. */}
          <Card className="hidden gap-0 overflow-hidden p-0 shadow-xs md:block">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">
                  Registered institutes matching the current filters
                </caption>
                <thead>
                  <tr className="border-border bg-secondary/40 text-muted-foreground border-b text-left">
                    <th scope="col" className="px-5 py-2.5 text-xs font-medium">
                      Institute
                    </th>
                    <th scope="col" className="px-5 py-2.5 text-xs font-medium">
                      Location
                    </th>
                    <th scope="col" className="px-5 py-2.5 text-xs font-medium">
                      Status
                    </th>
                    <th scope="col" className="px-5 py-2.5 text-xs font-medium">
                      Key contact
                    </th>
                    <th
                      scope="col"
                      className="px-5 py-2.5 text-right text-xs font-medium"
                    >
                      Streams
                    </th>
                    <th
                      scope="col"
                      className="px-5 py-2.5 text-right text-xs font-medium"
                    >
                      Class 12
                    </th>
                    <th scope="col" className="w-10 px-2 py-2.5">
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((institute) => {
                    const streams = streamCount(institute.class11, institute.class12);
                    const students = class12Total(institute.class12);
                    return (
                      <tr
                        key={institute.id}
                        className="border-border hover:bg-accent/50 border-b transition-colors last:border-0"
                      >
                        <td className="px-5 py-3">
                          <Link
                            href={`/institutes/${institute.id}`}
                            className="focus-visible:ring-ring rounded-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
                          >
                            {institute.name}
                          </Link>
                          <p className="text-muted-foreground text-xs">
                            {TYPE_LABELS[institute.type]}
                          </p>
                        </td>
                        <td className="text-muted-foreground px-5 py-3">
                          {[institute.area, institute.city, institute.state]
                            .filter(Boolean)
                            .join(", ") || "—"}
                        </td>
                        <td className="px-5 py-3">
                          <InstituteStatusBadge status={institute.status} />
                        </td>
                        <td className="px-5 py-3">{keyContact(institute)}</td>
                        <td className="px-5 py-3 text-right tabular-nums">{streams}</td>
                        <td className="px-5 py-3 text-right tabular-nums">
                          ~{students}
                        </td>
                        <td className="px-2 py-3">
                          <Link
                            href={`/institutes/${institute.id}`}
                            tabIndex={-1}
                            aria-hidden
                            className="text-muted-foreground hover:text-foreground block"
                          >
                            <ChevronRightIcon className="size-4" aria-hidden />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function keyContact(institute: Institute): string {
  if (institute.decision_maker_name) {
    return institute.decision_maker_designation
      ? `${institute.decision_maker_name} (${institute.decision_maker_designation})`
      : institute.decision_maker_name;
  }
  return institute.principal_name ?? "—";
}

function InstituteCard({ institute }: { institute: Institute }) {
  const streams = streamCount(institute.class11, institute.class12);
  const students = class12Total(institute.class12);

  return (
    <Card className="hover:border-primary/40 gap-0 p-4 transition-colors">
      <Link
        href={`/institutes/${institute.id}`}
        className="focus-visible:ring-ring block rounded-md focus-visible:ring-2 focus-visible:outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-semibold">{institute.name}</p>
            <p className="text-muted-foreground truncate text-xs">
              {TYPE_LABELS[institute.type]}
              {institute.area ? ` · ${institute.area}` : ""}
              {institute.city ? `, ${institute.city}` : ""}
            </p>
          </div>
          <ChevronRightIcon
            className="text-muted-foreground mt-0.5 size-4 shrink-0"
            aria-hidden
          />
        </div>

        <div className="mt-3">
          <InstituteStatusBadge status={institute.status} />
        </div>

        <p className="text-muted-foreground mt-3 truncate text-xs">
          Key contact: <span className="text-foreground">{keyContact(institute)}</span>
        </p>

        <div className="mt-2 flex flex-wrap gap-2">
          <Badge variant="secondary">
            {streams} stream{streams === 1 ? "" : "s"}
          </Badge>
          <Badge variant="secondary">~{students} in class 12</Badge>
        </div>
      </Link>
    </Card>
  );
}
