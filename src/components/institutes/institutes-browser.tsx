"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import type { StatusCatalogue } from "@/lib/validation/institute";
import type { Institute } from "@/lib/institutes";
import {
  class12Total,
  streamCount,
  TYPE_LABELS,
  type InstituteType,
} from "@/lib/validation/institute";
import { cn } from "@/lib/utils";

const ALL = "__all__";
/** Its own sentinel, because "no owner" is a real filter and not the absence of one. */
const UNASSIGNED = "__unassigned__";
/**
 * "No status yet" — `institutes.status IS NULL`.
 *
 * Null is its own state and not the absence of a filter: an institute
 * registered and never reached is neither open nor closed, and it is often the
 * most interesting row on the screen. It needs a sentinel for the same reason
 * UNASSIGNED does — a Radix Select cannot hold an empty string as a value.
 */
const NO_STATUS = "__none__";

/** The filters this screen understands, as URL parameters. */
export interface InstituteFilters {
  q?: string;
  status?: string;
  owner?: string;
  state?: string;
  city?: string;
  area?: string;
  type?: string;
}

/**
 * Search and filtering run in the browser over the list the server already
 * sent. At a few hundred institutes that is a small payload and every keystroke
 * responds instantly — worth more here than server-side filtering, which would
 * put a network round trip between a rep and every character they type.
 *
 * Filter options are derived from the institutes actually present, so the
 * dropdowns never offer a state with nothing in it. STATUS IS THE EXCEPTION and
 * is offered from the whole vocabulary — see the control for why.
 *
 * THE FILTERS ARE IN THE URL, so a filtered registry is a link. That is what
 * makes "click 3 scheduled, open those three institutes" possible from
 * anywhere else in the admin portal: a count elsewhere becomes an href here.
 * State is SEEDED from the URL once and then MIRRORED back to it.
 *
 * MIRRORED, NOT DRIVEN. The filtering itself still runs over the array in
 * memory — the URL is an output, not an input, after the first render. That is
 * what keeps the instant-response property above: were the URL the source of
 * truth, every keystroke would be a server round trip and this component would
 * be the thing its own opening paragraph says it deliberately is not.
 */
export function InstitutesBrowser({
  institutes,
  catalogue,
  showOwner = false,
  initial = {},
}: {
  institutes: Institute[];
  /** The status vocabulary, loaded by the page that renders this. */
  catalogue: StatusCatalogue;
  /**
   * ADMIN-ONLY. Shows who registered each institute, and lets the list be
   * filtered down to one rep.
   *
   * Off for a rep and deliberately so: once rep-owned institutes ship a rep
   * sees only their own, so an owner line would say the same name on every row
   * and a filter would have one option. It would be noise standing in for
   * information.
   */
  showOwner?: boolean;
  /**
   * The filters as they arrived in the URL. SEED ONLY — read on the first
   * render and never again, which is what lets typing stay instant.
   */
  initial?: InstituteFilters;
}) {
  const router = useRouter();

  const [search, setSearch] = useState(initial.q ?? "");
  const [status, setStatus] = useState(initial.status ?? ALL);
  const [state, setState] = useState(initial.state ?? ALL);
  const [city, setCity] = useState(initial.city ?? ALL);
  const [area, setArea] = useState(initial.area ?? ALL);
  const [type, setType] = useState(initial.type ?? ALL);
  const [boards, setBoards] = useState<string[]>([]);
  /*
   * OWNER IS IGNORED FOR A REP, even when it is in the URL.
   *
   * The control is admin-only, so a rep given an `?owner=` link would hold a
   * filter they can neither see nor clear — a registry that looks empty for no
   * stated reason. RLS already limits them to their own institutes, so the
   * parameter is redundant for them rather than dangerous: dropping it costs
   * nothing and removes a dead end.
   */
  const [owner, setOwner] = useState(showOwner ? (initial.owner ?? ALL) : ALL);

  /*
   * THE URL IS WRITTEN FROM STATE, never read back after the seed.
   *
   * Two mechanisms, deliberately, and the split is about cost:
   *
   *   router.replace          the discrete controls. `replace` and not `push`
   *                           so a filter session leaves ONE history entry and
   *                           Back returns where the reader came from rather
   *                           than walking them out through six dropdowns.
   *
   *   history.replaceState    the SEARCH BOX only. `router.replace` re-runs the
   *                           server component, so mirroring a text field that
   *                           way would put `listInstitutes()` behind every
   *                           character typed — exactly the round trip the
   *                           opening comment says this component exists to
   *                           avoid. `replaceState` updates the address bar and
   *                           nothing else, which is all the URL is for here.
   *
   * Both are replace-shaped, so neither floods history.
   */
  /*
   * Plain closures rather than memoised callbacks with a ref behind them.
   *
   * They are only ever called from event handlers, where the render that
   * created them is the current one — so closing over the state values
   * directly is both correct and the whole of it. The first attempt kept a
   * ref of "the filters as they stand" and assigned it during render, which
   * is a write to a ref in render: React may discard or re-run that render,
   * and the lint rule that caught it is right to.
   */
  function buildQuery(next: InstituteFilters) {
    const params = new URLSearchParams();
    const put = (key: string, value: string | undefined) => {
      if (value && value !== ALL) params.set(key, value);
    };
    put("q", next.q?.trim());
    put("status", next.status);
    put("state", next.state);
    put("city", next.city);
    put("area", next.area);
    put("type", next.type);
    // Never written for a rep: they have no control to clear it with.
    if (showOwner) put("owner", next.owner);
    const query = params.toString();
    return query ? `/institutes?${query}` : "/institutes";
  }

  /** The patch, applied over the filters as they stand in THIS render. */
  function mirror(patch: InstituteFilters, viaRouter: boolean) {
    const url = buildQuery({
      q: search,
      status,
      state,
      city,
      area,
      type,
      owner,
      ...patch,
    });
    if (viaRouter) router.replace(url, { scroll: false });
    else window.history.replaceState(null, "", url);
  }

  /** A discrete control changed: set it, and put it in the URL. */
  function pick(
    key: keyof InstituteFilters,
    value: string,
    set: (v: string) => void,
    also?: InstituteFilters,
  ) {
    set(value);
    mirror({ [key]: value, ...also }, true);
  }

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

  const availableAreas = useMemo(
    () =>
      [
        ...new Set(
          institutes
            .filter((i) => state === ALL || i.state === state)
            .filter((i) => city === ALL || i.city === city)
            .map((i) => i.area)
            .filter(Boolean),
        ),
      ].sort() as string[],
    [institutes, state, city],
  );

  const availableBoards = useMemo(
    () => [...new Set(institutes.flatMap((i) => i.boards ?? []))].sort(),
    [institutes],
  );

  /**
   * The owners present in the list, plus "Unassigned" when any row has none.
   *
   * Built from the rows rather than from the team, so it offers exactly the
   * people who actually hold something — an admin looking for "everything
   * Sumit registered" is not helped by a list of reps who registered nothing.
   *
   * UNASSIGNED IS AN OPTION, and it is the one that earns this control its
   * place. D-A means transferring a rep orphans their whole pipeline at once,
   * and `registered_by` is `on delete set null`, so removing a departed rep
   * does the same. Without a way to select them, finding those rows means
   * scrolling the registry looking for red badges.
   */
  const ownerOptions = useMemo(() => {
    const named = new Map<string, string>();
    let anyUnassigned = false;
    for (const institute of institutes) {
      if (!institute.registered_by) {
        anyUnassigned = true;
        continue;
      }
      named.set(institute.registered_by, institute.ownerName ?? "Unnamed rep");
    }
    return {
      reps: [...named.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      anyUnassigned,
    };
  }, [institutes]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return institutes.filter((i) => {
      if (term) {
        const haystack = `${i.name} ${i.city ?? ""} ${i.area ?? ""}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      if (state !== ALL && i.state !== state) return false;
      if (city !== ALL && i.city !== city) return false;
      if (area !== ALL && i.area !== area) return false;
      if (type !== ALL && i.type !== type) return false;
      // NO_STATUS is `status IS NULL`, which is a real answer and not "any".
      if (status === NO_STATUS && i.status !== null) return false;
      if (status !== ALL && status !== NO_STATUS && i.status !== status)
        return false;
      if (boards.length > 0 && !(i.boards ?? []).some((b) => boards.includes(b)))
        return false;
      if (owner === UNASSIGNED && i.registered_by) return false;
      if (owner !== ALL && owner !== UNASSIGNED && i.registered_by !== owner)
        return false;
      return true;
    });
  }, [institutes, search, status, state, city, area, type, boards, owner]);

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
          onChange={(e) => {
            setSearch(e.target.value);
            // replaceState, not router.replace — see the note where `mirror`
            // is defined. A text field must not refetch the registry per key.
            mirror({ q: e.target.value }, false);
          }}
          aria-label="Search institutes"
        />
      </div>

      <div className="grid grid-cols-2 gap-2 md:max-w-4xl md:grid-cols-3">
        <Select
          value={state}
          onValueChange={(v) => {
            // Narrowing the state invalidates the city and the area under it.
            setCity(ALL);
            setArea(ALL);
            pick("state", v, setState, { city: ALL, area: ALL });
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

        <Select
          value={city}
          onValueChange={(v) => {
            setArea(ALL);
            pick("city", v, setCity, { area: ALL });
          }}
        >
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

        {/* Area, the third rung of the location tree. It had no control at all
            and was only reachable through the free-text search, which is not
            something another screen can link to. */}
        <Select value={area} onValueChange={(v) => pick("area", v, setArea)}>
          <SelectTrigger className="h-11 w-full" aria-label="Filter by area">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All areas</SelectItem>
            {availableAreas.map((a) => (
              <SelectItem key={a} value={a}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={type} onValueChange={(v) => pick("type", v, setType)}>
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

        {/*
          STATUS — the control this screen never had, and the one the whole
          drill-down depends on: "3 scheduled" elsewhere becomes a link here.

          OFFERED FROM THE WHOLE VOCABULARY, not from the statuses present,
          which is the one place this screen departs from its own "never offer
          an option with nothing behind it" rule. A deep link may name a status
          no institute currently holds — that is a real and useful answer
          ("none any more") — and a control that silently dropped the value it
          was given would show "All statuses" over an empty list, which reads
          as a bug rather than as a result.

          Retired statuses are included for the same reason /review includes
          them: retiring is this app's only removal path, so old institutes go
          on pointing at them and filtering by one is exactly how they are
          found. Marked, so nobody wonders why it is offered.
        */}
        <Select value={status} onValueChange={(v) => pick("status", v, setStatus)}>
          <SelectTrigger className="h-11 w-full" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            <SelectItem value={NO_STATUS}>No status yet</SelectItem>
            {catalogue.map((entry) => (
              <SelectItem key={entry.status} value={entry.status}>
                {entry.isActive ? entry.status : `${entry.status} (retired)`}
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

      {showOwner && (ownerOptions.reps.length > 0 || ownerOptions.anyUnassigned) && (
        <div className="md:max-w-xs">
          <Select value={owner} onValueChange={(v) => pick("owner", v, setOwner)}>
            <SelectTrigger className="h-11 w-full" aria-label="Filter by owner">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All reps</SelectItem>
              {ownerOptions.reps.map((rep) => (
                <SelectItem key={rep.id} value={rep.id}>
                  {rep.name}
                </SelectItem>
              ))}
              {ownerOptions.anyUnassigned && (
                <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
              )}
            </SelectContent>
          </Select>
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
                <InstituteCard
                  institute={institute}
                  catalogue={catalogue}
                  showOwner={showOwner}
                />
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
                    {showOwner && (
                      <th scope="col" className="px-5 py-2.5 text-xs font-medium">
                        Registered by
                      </th>
                    )}
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
                          <InstituteStatusBadge status={institute.status} catalogue={catalogue} />
                        </td>
                        <td className="px-5 py-3">{keyContact(institute)}</td>
                        {showOwner && (
                          <td className="px-5 py-3">
                            {institute.registered_by ? (
                              <span className="text-muted-foreground">
                                {institute.ownerName ?? "Unnamed rep"}
                              </span>
                            ) : (
                              <Badge variant="danger">Unassigned</Badge>
                            )}
                          </td>
                        )}
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

function InstituteCard({
  institute,
  catalogue,
  showOwner,
}: {
  institute: Institute;
  catalogue: StatusCatalogue;
  showOwner: boolean;
}) {
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

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <InstituteStatusBadge status={institute.status} catalogue={catalogue} />
          {showOwner &&
            (institute.registered_by ? (
              <span className="text-muted-foreground text-xs">
                {institute.ownerName ?? "Unnamed rep"}
              </span>
            ) : (
              /* Loud, because nothing else on any screen says an institute has
                 fallen out of every rep's sight. See reassign-owner.tsx. */
              <Badge variant="danger">Unassigned</Badge>
            ))}
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
