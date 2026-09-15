import { z } from "zod";

/**
 * The institute registry's shared contract.
 *
 * Imported by the form and by the server action, so the browser and the server
 * apply the same rules. The database constraints from 0001_init.sql are the
 * third layer and the one that actually cannot be bypassed — these two exist to
 * give a person a useful message before it gets that far.
 */

export const INSTITUTE_TYPES = ["school", "coaching", "consultant"] as const;
export type InstituteType = (typeof INSTITUTE_TYPES)[number];

export const TYPE_LABELS: Record<InstituteType, string> = {
  school: "School",
  coaching: "Coaching",
  consultant: "Consultant",
};

/** Rule 10: the same three streams for class 11 ticks and class 12 counts. */
export const STREAMS = ["science", "commerce", "humanities"] as const;
export type Stream = (typeof STREAMS)[number];

/**
 * Rule 9: these are the offered options, not the permitted set. A rep may add
 * any other board as free text, so the schema accepts any non-empty string.
 */
export const BOARD_OPTIONS = [
  "CBSE",
  "ICSE",
  "State Board",
  "IB",
  "IGCSE",
] as const;

/**
 * Every status is either OPEN — the institute still owes us something, or we
 * owe them — or CLOSED, meaning that loop is finished. Nothing is in between.
 */
export const STATUS_CATEGORIES = ["open", "closed"] as const;
export type StatusCategory = (typeof STATUS_CATEGORIES)[number];

/** The badge colours a status may take. Mirrors institute_statuses_tone_valid. */
export const STATUS_TONES = ["success", "warning", "danger", "neutral"] as const;
export type StatusTone = (typeof STATUS_TONES)[number];

/**
 * One status, as `public.institute_statuses` holds it.
 *
 * `tone` is a stored column and not a derivation, because colour tracks the
 * OUTCOME rather than the open/closed category — "First meeting done" is green
 * and still open. The `asks*` flags are the closed vocabulary of extra question
 * groups a status can turn on; the follow-up is deliberately not among them,
 * because it IS the category and `enforce_follow_up_when_open()` (FO016)
 * enforces it from the database.
 */
export interface StatusRow {
  status: string;
  category: StatusCategory;
  tone: StatusTone;
  sortOrder: number;
  isActive: boolean;
  asksExpectedDate: boolean;
  asksSessionDetail: boolean;
  asksHeadCount: boolean;
}

/** The vocabulary, in display order. Loaded from the database at read time. */
export type StatusCatalogue = readonly StatusRow[];

/**
 * THE NINE, AS A SEED AND A FALLBACK — no longer as the source of truth.
 *
 * This was `INSTITUTE_STATUS_CATALOGUE`, and it WAS the app's single source of
 * truth for the open/closed mapping. Migration 0026 ends that: the two CHECK
 * constraints became foreign keys to `public.institute_statuses`, so the
 * database states the vocabulary once and an admin can extend it. A constant in
 * here cannot know about a status added last week.
 *
 * So it keeps two jobs and loses the important one:
 *
 *   SEED      what a fresh database is created with. 0010 inserted exactly
 *             these nine with these categories; 0026 gave them these tones and
 *             flags, lifted from the hard-coded behaviour they replaced.
 *   FALLBACK  what the app renders with if the status read fails. Nine correct
 *             statuses beat an empty dropdown on a screen a rep is standing in
 *             front of.
 *
 * It must still agree with the database for these nine — the
 * `institute_status_category` suite in tests/integration/rules.test.ts checks
 * that — but it is no longer the whole list, and nothing may assume it is.
 */
export const SEED_STATUS_CATALOGUE: StatusCatalogue = [
  row("First meeting done", "open", "success"),
  row("Session scheduled", "open", "warning", { asksExpectedDate: true }),
  row("Session done", "closed", "success", {
    asksExpectedDate: true,
    asksSessionDetail: true,
    asksHeadCount: true,
  }),
  row("Campus visit scheduled", "open", "warning", { asksExpectedDate: true }),
  row("Campus visit done", "closed", "success", {
    asksExpectedDate: true,
    asksHeadCount: true,
  }),
  row("Pending for management approval", "open", "danger"),
  row("Invited principal for event", "open", "warning"),
  row("RSVP received", "closed", "success"),
  row("Will not come", "closed", "neutral"),
].map((entry, index) => ({ ...entry, sortOrder: index + 1 }));

function row(
  status: string,
  category: StatusCategory,
  tone: StatusTone,
  asks: Partial<
    Pick<StatusRow, "asksExpectedDate" | "asksSessionDetail" | "asksHeadCount">
  > = {},
): StatusRow {
  return {
    status,
    category,
    tone,
    sortOrder: 0,
    isActive: true,
    asksExpectedDate: false,
    asksSessionDetail: false,
    asksHeadCount: false,
    ...asks,
  };
}

/** The seeded status names. A seed, not the vocabulary — see above. */
export const SEED_STATUSES: readonly string[] = SEED_STATUS_CATALOGUE.map(
  (entry) => entry.status,
);

/**
 * Look one status up.
 *
 * Every question below goes through here, so there is one place that decides
 * what "unknown" means: null, for a status the catalogue does not have and for
 * no status at all. An unknown status is NOT closed — treating it as closed
 * would quietly finish a loop nobody finished.
 */
export function statusRow(
  catalogue: StatusCatalogue,
  status: string | null,
): StatusRow | null {
  if (status === null) return null;
  return catalogue.find((entry) => entry.status === status) ?? null;
}

/** The category of a status, or null for an unknown one and for no status. */
export function statusCategory(
  catalogue: StatusCatalogue,
  status: string | null,
): StatusCategory | null {
  return statusRow(catalogue, status)?.category ?? null;
}

export function isOpenStatus(
  catalogue: StatusCatalogue,
  status: string | null,
): boolean {
  return statusCategory(catalogue, status) === "open";
}

export function isClosedStatus(
  catalogue: StatusCatalogue,
  status: string | null,
): boolean {
  return statusCategory(catalogue, status) === "closed";
}

/**
 * The statuses a rep may CHOOSE, in one category.
 *
 * Retired statuses are filtered out here and nowhere else: they must stay
 * readable for every institute and visit that already carries one, and simply
 * stop being offered. Ordered by `sortOrder` then name, because 0026 drops the
 * UNIQUE on sort_order and ties have to resolve the same way every render.
 */
export function statusesInCategory(
  catalogue: StatusCatalogue,
  category: StatusCategory,
): readonly string[] {
  return catalogue
    .filter((entry) => entry.isActive && entry.category === category)
    .toSorted(
      (a, b) => a.sortOrder - b.sortOrder || a.status.localeCompare(b.status),
    )
    .map((entry) => entry.status);
}

/** Every status a rep may choose, both categories, in display order. */
export function selectableStatuses(catalogue: StatusCatalogue): readonly string[] {
  return STATUS_CATEGORIES.flatMap((category) =>
    statusesInCategory(catalogue, category),
  );
}

/** What a person is told each category means. */
export const CATEGORY_LABELS: Record<StatusCategory, string> = {
  open: "Open (still in play)",
  closed: "Closed (nothing further owed)",
};

/**
 * How an institute reads in a picker.
 *
 * A closed institute has always been plannable — there is no constraint, no
 * policy and no filter anywhere that stops it, and re-adding one is how a new
 * cycle of engagement starts. What was missing was any way to TELL, so the
 * closed ones now carry their status: "Horizon International School · Ahmedabad
 * — RSVP received (closed)".
 *
 * Only closed statuses are spelled out. Marking all nine would put a label on
 * every row of a long list and bury the one distinction that changes what the
 * rep is about to do.
 */
export function institutePickerLabel(
  catalogue: StatusCatalogue,
  institute: {
    name: string;
    city: string | null;
    status: string | null;
  },
): string {
  const place = institute.city ? ` · ${institute.city}` : "";
  return isClosedStatus(catalogue, institute.status)
    ? `${institute.name}${place} (closed: ${institute.status})`
    : `${institute.name}${place}`;
}

/**
 * The institute a rep is about to reopen, if that is what they are doing.
 *
 * Returns the selection only when its loop is already closed, which is the one
 * case a picker should say something about before the rep commits. Everything
 * else — no selection, an unknown id, an open status, no status yet — is an
 * ordinary plan entry and gets no commentary.
 *
 * A function rather than two lines inside the component so the decision can be
 * tested without a browser, and so the next screen that needs it asks the same
 * question the same way.
 */
export function reopeningInstitute<
  T extends { id: string; status: string | null },
>(
  catalogue: StatusCatalogue,
  institutes: readonly T[],
  selectedId: string,
): T | null {
  if (!selectedId) return null;
  const selected = institutes.find((institute) => institute.id === selectedId);
  return selected && isClosedStatus(catalogue, selected.status) ? selected : null;
}

/** Blank optional fields arrive from a form as "", which we store as null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable();

/** Ten digits exactly, or nothing. Matches the *_mobile_valid CHECKs. */
const optionalMobile = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .refine((v) => v === null || /^[0-9]{10}$/.test(v), {
    message: "Enter a 10-digit mobile number.",
  });

const optionalPincode = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .refine((v) => v === null || /^[0-9]{6}$/.test(v), {
    message: "A PIN code is 6 digits.",
  });

/**
 * The campus an ADMIN must name, and the one a REP never sees.
 *
 * `enforce_institute_campus()` (FO022, migration 0020b) defaults a new
 * institute to `my_campus()`, which is the registering rep's. An admin has no
 * campus — that is the whole shape of the role — so the default lands on null
 * and the trigger refuses the insert. Its own comment says what was always
 * meant to happen: "an admin must name one". The form simply never asked, so
 * every admin registration failed with a generic "please try again".
 *
 * Hence optional here rather than required: the schema is shared, and for a rep
 * the field is genuinely absent and the database fills it in. Who must supply
 * one is decided where the role is known — in the form and in the action.
 */
export const CAMPUS_REQUIRED = "Choose the campus this institute belongs to.";

export const instituteSchema = z.object({
  name: z.string().trim().min(1, "Enter the institute's name.").max(200),
  type: z.enum(INSTITUTE_TYPES),

  campus_id: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .refine(
      (v) =>
        v === null ||
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
      "Choose one of the listed campuses.",
    ),

  address: optionalText(500),
  pincode: optionalPincode,

  // Rule 11 makes area addable inline, so by the time we submit all three of
  // these are always present.
  state: z.string().trim().min(1, "Select a state."),
  city: z.string().trim().min(1, "Select a city."),
  area: z.string().trim().min(1, "Select or add an area."),

  boards: z
    .array(z.string().trim().min(1).max(60))
    .min(1, "Select at least one board.")
    .max(12),

  principal_name: optionalText(120),
  principal_mobile: optionalMobile,
  decision_maker_name: optionalText(120),
  decision_maker_designation: optionalText(120),
  decision_maker_mobile: optionalMobile,

  /** Ticks only — which streams exist. */
  class11: z.array(z.enum(STREAMS)).max(STREAMS.length),
  /**
   * Ticks plus an approximate head count per stream.
   *
   * `partialRecord`, not `record`. In Zod 4 a record with an enum key schema is
   * exhaustive — it demands an entry for every stream — so ticking only Science
   * failed with errors on the two streams the rep deliberately left off.
   */
  class12: z.partialRecord(
    z.enum(STREAMS),
    z.number().int().min(0).max(100000),
  ),
});

export type InstituteInput = z.infer<typeof instituteSchema>;

/** Total approximate class 12 students, used on cards and the detail screen. */
export function class12Total(class12: Record<string, number> | null): number {
  if (!class12) return 0;
  return Object.values(class12).reduce(
    (sum, n) => sum + (Number.isFinite(n) ? n : 0),
    0,
  );
}

/** How many distinct streams the institute runs across both years. */
export function streamCount(
  class11: string[] | null,
  class12: Record<string, number> | null,
): number {
  return new Set([...(class11 ?? []), ...Object.keys(class12 ?? {})]).size;
}

/**
 * FormData -> the shape `instituteSchema` expects.
 *
 * Shared deliberately: the browser runs this before submitting and the server
 * action runs it again on arrival, so both judge the same values by the same
 * rules. A non-numeric class 12 count becomes NaN here and is rejected by the
 * schema rather than needing its own special case.
 */
export function instituteFormDataToInput(formData: FormData) {
  const text = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value : "";
  };

  const class12: Record<string, number> = {};
  for (const stream of formData.getAll("class12").map(String)) {
    const raw = text(`class12_${stream}`).trim();
    class12[stream] = raw === "" ? 0 : Number(raw);
  }

  return {
    name: text("name"),
    type: text("type"),
    campus_id: text("campus_id"),
    address: text("address"),
    pincode: text("pincode"),
    state: text("state"),
    city: text("city"),
    area: text("area"),
    boards: formData.getAll("boards").map(String),
    principal_name: text("principal_name"),
    principal_mobile: text("principal_mobile"),
    decision_maker_name: text("decision_maker_name"),
    decision_maker_designation: text("decision_maker_designation"),
    decision_maker_mobile: text("decision_maker_mobile"),
    class11: formData
      .getAll("class11")
      .map(String)
      .filter((s): s is Stream => (STREAMS as readonly string[]).includes(s)),
    class12,
  };
}

/** Collapses zod issues into one message per field, for inline display. */
export function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}
