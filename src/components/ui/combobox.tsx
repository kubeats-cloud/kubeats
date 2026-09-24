"use client";

import * as React from "react";
import { CheckIcon, ChevronsUpDownIcon, SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * A searchable single-select — the control a plain Select stops being at ~20
 * options and is actively unhelpful at 47.
 *
 * BUILT FROM WHAT IS ALREADY HERE. Popover (from the radix-ui package this app
 * already depends on), the existing Input, and a hand-written listbox. No
 * `cmdk`, which is what shadcn's Command wraps and which would be a new
 * package for behaviour that is about sixty lines.
 *
 * TWO PRESENTATIONS, ONE API. From `md` it is a popover under the trigger.
 * Below `md` it is a bottom sheet with 44px rows — a popover pinned to a
 * trigger halfway down a phone gets perhaps four visible options once the
 * keyboard opens, which is the situation this control exists to fix.
 *
 * The split is CSS (`md:hidden` / `hidden md:block`) rather than a media-query
 * hook on purpose: a hook reads the viewport on the client only, so the server
 * renders one branch and the client may immediately swap to the other, which is
 * a hydration mismatch on a control that is often the first thing tapped. Both
 * shells are rendered and one is display:none — and a display:none subtree is
 * not focusable, so keyboard and screen readers only ever reach the live one.
 * Each shell owns its own state and its own id namespace so the two cannot
 * collide.
 *
 * NO VIRTUALISATION. A substring filter over a few hundred rows is a `useMemo`
 * and a paint; windowing would be a dependency and a scroll-restoration bug in
 * exchange for nothing measurable. Revisit in the thousands.
 */

export interface ComboboxOption {
  value: string;
  label: string;
  /** A second line — a campus, a city. Searched along with the label. */
  hint?: string;
}

export interface ComboboxProps {
  options: ComboboxOption[];
  /** The currently selected value, or null. */
  value: string | null;
  onSelect: (value: string) => void;
  /** Shown on the trigger when nothing is selected. */
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  /** Accessible name for the trigger and the sheet. Required — it is a control. */
  label: string;
  className?: string;
  disabled?: boolean;
}

/** Case-insensitive substring over label and hint. */
function matches(option: ComboboxOption, term: string): boolean {
  if (!term) return true;
  const haystack = `${option.label} ${option.hint ?? ""}`.toLowerCase();
  return haystack.includes(term);
}

export function Combobox(props: ComboboxProps) {
  const id = React.useId();
  return (
    <>
      {/* Phone: a bottom sheet. */}
      <div className={cn("md:hidden", props.className)}>
        <ComboboxSheet {...props} idPrefix={`${id}-m`} />
      </div>
      {/* From md: a popover under the trigger. */}
      <div className={cn("hidden md:block", props.className)}>
        <ComboboxPopover {...props} idPrefix={`${id}-d`} />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Shared behaviour                                                    */
/* ------------------------------------------------------------------ */

function useComboboxState(options: ComboboxOption[], value: string | null) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [activeRaw, setActive] = React.useState(0);

  const term = query.trim().toLowerCase();
  const filtered = React.useMemo(
    () => options.filter((option) => matches(option, term)),
    [options, term],
  );

  /*
   * Typing narrows the list under the cursor, so the highlight has to come
   * back to something that exists — CLAMPED DURING RENDER rather than
   * corrected in an effect.
   *
   * The effect version stored an out-of-range index, rendered once with it,
   * then set state to fix it: a cascading render, and a frame in which
   * `aria-activedescendant` named an option that was not in the list. Deriving
   * it means the value is never wrong in the first place.
   *
   * Clamped rather than reset to zero, so a filter that removes rows BELOW the
   * highlight does not yank it away from the row being read.
   */
  const active = filtered.length === 0 ? 0 : Math.min(activeRaw, filtered.length - 1);

  /** Opening starts clean, and on the row that is already chosen. */
  const openAt = React.useCallback(() => {
    setQuery("");
    const index = options.findIndex((option) => option.value === value);
    setActive(index >= 0 ? index : 0);
    setOpen(true);
  }, [options, value]);

  return { open, setOpen, openAt, query, setQuery, active, setActive, filtered };
}

/** Arrow / Home / End / Enter / Escape, shared by both shells. */
function keyHandler({
  filtered,
  active,
  setActive,
  choose,
  close,
}: {
  filtered: ComboboxOption[];
  active: number;
  setActive: (next: number) => void;
  choose: (option: ComboboxOption) => void;
  close: () => void;
}) {
  return (event: React.KeyboardEvent) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (filtered.length > 0) setActive((active + 1) % filtered.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (filtered.length > 0)
          setActive((active - 1 + filtered.length) % filtered.length);
        break;
      case "Home":
        event.preventDefault();
        setActive(0);
        break;
      case "End":
        event.preventDefault();
        setActive(Math.max(filtered.length - 1, 0));
        break;
      case "Enter": {
        // Never submit a surrounding form by accident.
        event.preventDefault();
        const option = filtered[active];
        if (option) choose(option);
        break;
      }
      case "Escape":
        event.preventDefault();
        close();
        break;
      default:
        break;
    }
  };
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

/**
 * `...rest` IS LOAD-BEARING — it is how the trigger gets its onClick.
 *
 * Both shells mount this under `asChild`, which makes Radix clone it and pass
 * ITS props down: the click handler that opens the panel, the ref it measures
 * the trigger width with, and its own data-state. A component that names only
 * the props it cares about drops every one of them, and the result is a button
 * that looks perfect, carries the right ARIA, and does nothing at all when
 * clicked. That is exactly what shipped here until it was opened in a browser.
 *
 * Spread FIRST so the explicit attributes below win: Radix's Popover.Trigger
 * would otherwise label this `aria-haspopup="dialog"` and point aria-controls
 * at the popover element, when the thing being controlled is the listbox.
 * onClick and ref are not in that list, so they survive.
 */
function Trigger({
  listboxId,
  open,
  label,
  text,
  placeholder,
  disabled,
  className,
  ...rest
}: React.ComponentProps<"button"> & {
  listboxId: string;
  open: boolean;
  label: string;
  text: string | null;
  placeholder: string;
}) {
  return (
    <button
      {...rest}
      type="button"
      // A REAL combobox trigger: the role, the state and the relationship are
      // all on the element a screen reader lands on, not inferred from styling.
      role="combobox"
      aria-expanded={open}
      aria-controls={listboxId}
      aria-haspopup="listbox"
      aria-label={label}
      disabled={disabled}
      className={cn(
        "border-input bg-card flex h-11 w-full items-center justify-between gap-2 rounded-lg border px-3 text-sm transition-colors",
        "hover:bg-accent/50 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3 focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
    >
      <span className={cn("truncate", !text && "text-muted-foreground")}>
        {text ?? placeholder}
      </span>
      <ChevronsUpDownIcon
        className="text-muted-foreground size-4 shrink-0"
        aria-hidden
      />
    </button>
  );
}

function SearchBox({
  listboxId,
  activeId,
  query,
  setQuery,
  onKeyDown,
  placeholder,
  autoFocus,
}: {
  listboxId: string;
  activeId: string | undefined;
  query: string;
  setQuery: (next: string) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="relative">
      <SearchIcon
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
        aria-hidden
      />
      <Input
        // The input is where focus lives while the list is open, so this is
        // where aria-activedescendant has to be: it names the highlighted
        // option WITHOUT moving focus off the field being typed into.
        aria-controls={listboxId}
        aria-activedescendant={activeId}
        aria-autocomplete="list"
        autoFocus={autoFocus}
        className="h-11 pl-8"
        placeholder={placeholder}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}

function OptionList({
  listboxId,
  idPrefix,
  label,
  filtered,
  active,
  setActive,
  value,
  choose,
  emptyMessage,
  className,
}: {
  listboxId: string;
  idPrefix: string;
  label: string;
  filtered: ComboboxOption[];
  active: number;
  setActive: (next: number) => void;
  value: string | null;
  choose: (option: ComboboxOption) => void;
  emptyMessage: string;
  className?: string;
}) {
  const ref = React.useRef<HTMLUListElement>(null);

  // Keep the highlight on screen when it is moved by the keyboard. "nearest"
  // so a list already showing the row does not jump.
  React.useEffect(() => {
    const node = ref.current?.querySelector(`[data-index="${active}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (filtered.length === 0) {
    return (
      <>
        <p className="text-muted-foreground px-3 py-6 text-center text-sm">
          {emptyMessage}
        </p>
        {/* The listbox still has to EXIST, empty: the trigger's aria-controls
            points at it, and a dangling reference is worse than an empty list. */}
        <ul id={listboxId} role="listbox" aria-label={label} className="hidden" />
      </>
    );
  }

  return (
    <ul
      ref={ref}
      id={listboxId}
      role="listbox"
      aria-label={label}
      className={cn("overflow-y-auto", className)}
    >
      {filtered.map((option, index) => {
        const selected = option.value === value;
        return (
          <li
            key={option.value}
            id={`${idPrefix}-option-${index}`}
            data-index={index}
            role="option"
            aria-selected={selected}
            // Pointer down rather than click: click fires after the popover has
            // already begun closing on blur, which loses the selection.
            onPointerDown={(event) => {
              event.preventDefault();
              choose(option);
            }}
            onPointerMove={() => setActive(index)}
            className={cn(
              "flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm",
              index === active && "bg-accent",
            )}
          >
            <CheckIcon
              className={cn("size-4 shrink-0", !selected && "invisible")}
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{option.label}</span>
              {option.hint && (
                <span className="text-muted-foreground block truncate text-xs">
                  {option.hint}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Shells                                                              */
/* ------------------------------------------------------------------ */

interface ShellProps extends ComboboxProps {
  idPrefix: string;
}

function useShell({ options, value, onSelect, idPrefix }: ShellProps) {
  const state = useComboboxState(options, value);
  const listboxId = `${idPrefix}-listbox`;

  const choose = React.useCallback(
    (option: ComboboxOption) => {
      state.setOpen(false);
      onSelect(option.value);
    },
    [onSelect, state],
  );

  const onKeyDown = keyHandler({
    filtered: state.filtered,
    active: state.active,
    setActive: state.setActive,
    choose,
    close: () => state.setOpen(false),
  });

  const selected = options.find((option) => option.value === value) ?? null;
  const activeId =
    state.filtered.length > 0 ? `${idPrefix}-option-${state.active}` : undefined;

  return { ...state, listboxId, choose, onKeyDown, selected, activeId };
}

function ComboboxPopover(props: ShellProps) {
  const {
    placeholder = "Select…",
    searchPlaceholder = "Search…",
    emptyMessage = "Nothing matches that.",
    label,
    disabled,
    idPrefix,
    value,
  } = props;
  const shell = useShell(props);

  return (
    <Popover
      open={shell.open}
      onOpenChange={(next) => (next ? shell.openAt() : shell.setOpen(false))}
    >
      <PopoverTrigger asChild>
        <Trigger
          listboxId={shell.listboxId}
          open={shell.open}
          label={label}
          text={shell.selected?.label ?? null}
          placeholder={placeholder}
          disabled={disabled}
        />
      </PopoverTrigger>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) min-w-64 p-2"
        // Focus belongs in the search field, not on the first option.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <SearchBox
          listboxId={shell.listboxId}
          activeId={shell.activeId}
          query={shell.query}
          setQuery={shell.setQuery}
          onKeyDown={shell.onKeyDown}
          placeholder={searchPlaceholder}
          autoFocus
        />
        <div className="mt-1">
          <OptionList
            listboxId={shell.listboxId}
            idPrefix={idPrefix}
            label={label}
            filtered={shell.filtered}
            active={shell.active}
            setActive={shell.setActive}
            value={value}
            choose={shell.choose}
            emptyMessage={emptyMessage}
            className="max-h-72"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ComboboxSheet(props: ShellProps) {
  const {
    placeholder = "Select…",
    searchPlaceholder = "Search…",
    emptyMessage = "Nothing matches that.",
    label,
    disabled,
    idPrefix,
    value,
  } = props;
  const shell = useShell(props);

  return (
    <Sheet
      open={shell.open}
      onOpenChange={(next) => (next ? shell.openAt() : shell.setOpen(false))}
    >
      <SheetTrigger asChild>
        <Trigger
          listboxId={shell.listboxId}
          open={shell.open}
          label={label}
          text={shell.selected?.label ?? null}
          placeholder={placeholder}
          disabled={disabled}
        />
      </SheetTrigger>
      <SheetContent
        side="bottom"
        /*
         * `data-[side=bottom]:h-[80svh]`, NOT a bare `h-[80svh]`.
         *
         * SheetContent sets its own `data-[side=bottom]:h-auto`. tailwind-merge
         * treats a data-variant class and an unprefixed one as different
         * groups, so it keeps BOTH — and the variant then wins on specificity.
         * The sheet silently collapsed to content height: fine with three reps,
         * and with forty-seven it grows past the viewport instead of scrolling
         * inside a fixed panel, which is the whole reason this is a sheet.
         *
         * Matching the variant lets the merge actually replace it.
         * `svh` rather than `vh` so the mobile URL bar collapsing does not
         * change the panel's height under the reader's thumb.
         */
        className="data-[side=bottom]:h-[80svh] gap-0 rounded-t-xl"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <SheetHeader className="pb-2">
          <SheetTitle>{label}</SheetTitle>
          <SheetDescription className="sr-only">
            Type to filter, then choose one.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4">
          <SearchBox
            listboxId={shell.listboxId}
            activeId={shell.activeId}
            query={shell.query}
            setQuery={shell.setQuery}
            onKeyDown={shell.onKeyDown}
            placeholder={searchPlaceholder}
            autoFocus
          />
        </div>
        <div className="min-h-0 flex-1 px-2 pt-2 pb-4">
          <OptionList
            listboxId={shell.listboxId}
            idPrefix={idPrefix}
            label={label}
            filtered={shell.filtered}
            active={shell.active}
            setActive={shell.setActive}
            value={value}
            choose={shell.choose}
            emptyMessage={emptyMessage}
            className="h-full"
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
