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

/** Rule 4: the six fixed values, mirroring the institutes_status_valid CHECK. */
export const INSTITUTE_STATUSES = [
  "First meeting done",
  "Session scheduled",
  "Session done",
  "Campus visit scheduled",
  "Campus visit done",
  "Pending for management approval",
] as const;
export type InstituteStatus = (typeof INSTITUTE_STATUSES)[number];

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

export const instituteSchema = z.object({
  name: z.string().trim().min(1, "Enter the institute's name.").max(200),
  type: z.enum(INSTITUTE_TYPES),

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
  /** Ticks plus an approximate head count per stream. */
  class12: z.record(z.enum(STREAMS), z.number().int().min(0).max(100000)),
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
