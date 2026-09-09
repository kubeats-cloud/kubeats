import { z } from "zod";

/**
 * The materials library's shared contract.
 *
 * Imported by the upload form and by the server action, so the browser and the
 * server judge a file by the same rules. The CHECK constraints in migration
 * 0012 are the third layer, and the bucket's own file_size_limit and
 * allowed_mime_types are the fourth — that last one is what holds against a
 * direct call to the storage API, which never touches this file at all.
 */

/** Mirrors the materials_category_valid CHECK. */
export const MATERIAL_CATEGORIES = [
  "Poster",
  "Brochure",
  "Fee Structure",
  "Event Letter",
  "Announcement",
  "Other",
] as const;
export type MaterialCategory = (typeof MATERIAL_CATEGORIES)[number];

/**
 * Images a rep can preview on a phone, plus PDF.
 *
 * Deliberately narrow. Office documents were left out because a rep in the
 * field cannot reliably open one, and every format added here is a format the
 * list has to know how to represent.
 */
export const ACCEPTED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;
export type MaterialFileType = (typeof ACCEPTED_TYPES)[number];

/** What a native file input should offer, derived so the two cannot drift. */
export const FILE_INPUT_ACCEPT = ACCEPTED_TYPES.join(",");

/**
 * 5 MiB, matching materials_file_size_valid and the bucket's file_size_limit.
 *
 * Materials are NOT compressed on the way in, unlike visit photos: a poster or
 * a fee sheet has to stay print-quality, so the cap is the only thing standing
 * between the library and the 1 GB free storage tier.
 */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export function isAcceptedType(type: string): type is MaterialFileType {
  return (ACCEPTED_TYPES as readonly string[]).includes(type);
}

export function isPdf(type: string): boolean {
  return type === "application/pdf";
}

export function isImage(type: string): boolean {
  return isAcceptedType(type) && !isPdf(type);
}

/** "4.2 MB", "812 KB", "0 bytes" — for a list, not for accounting. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 bytes";
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The one sentence a person is told when their file is refused.
 *
 * Returned rather than thrown, and shared, so the browser's immediate refusal
 * and the server's second look use identical words for the same file.
 */
export function fileRejectionReason(file: {
  type: string;
  size: number;
}): string | null {
  if (!isAcceptedType(file.type)) {
    return "That file type is not supported. Upload a JPG, PNG, WebP or PDF.";
  }
  if (file.size <= 0) {
    return "That file appears to be empty.";
  }
  if (file.size > MAX_FILE_BYTES) {
    return `That file is ${formatFileSize(file.size)}. The limit is ${formatFileSize(MAX_FILE_BYTES)}.`;
  }
  return null;
}

/**
 * Turns a signed view URL into one that saves the file instead of displaying
 * it.
 *
 * A signed URL points at the Supabase storage origin, so `<a download>` alone
 * is ignored — the attribute only works same-origin, and the browser would
 * navigate to the PDF instead. Storage honours a `download` query parameter by
 * answering with Content-Disposition: attachment and this filename, which is
 * the only way to get a real save from a cross-origin link.
 *
 * The signature already carries a query string, so this appends; the `?` case
 * is handled anyway rather than assumed.
 */
export function asDownloadUrl(url: string, fileName: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}download=${encodeURIComponent(fileName)}`;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable();

/**
 * What the server action inserts. file_path, file_name, file_type and file_size
 * describe an object the browser has already uploaded — the action re-checks
 * them rather than trusting the form, because a forged submission could
 * otherwise record a row that lies about what it points at.
 */
export const materialSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Give this material a title.")
    .max(200, "That title is too long."),
  /**
   * Which campus this is for, or nothing for every campus.
   *
   * Empty is a real answer here, unlike the yes/no on the feedback form: a
   * brochure that is not campus-specific belongs to all five, which is exactly
   * what the library was before scoping. `materials.campus_id` is nullable for
   * that reason and the policy reads `campus_id is null or campus_id = mine`.
   */
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
  category: z.enum(MATERIAL_CATEGORIES, {
    message: "Choose a category.",
  }),
  description: optionalText(2000),
  file_path: z.string().trim().min(1, "Upload a file first.").max(400),
  file_name: z.string().trim().min(1).max(300),
  file_type: z.enum(ACCEPTED_TYPES, {
    message: "That file type is not supported. Upload a JPG, PNG, WebP or PDF.",
  }),
  file_size: z
    .number()
    .int()
    .positive("That file appears to be empty.")
    .max(MAX_FILE_BYTES, "That file is larger than the 5 MB limit."),
});

export type MaterialInput = z.infer<typeof materialSchema>;

/** Shared so the browser's check and the action's check read the form alike. */
export function materialFormDataToInput(formData: FormData) {
  const text = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value : "";
  };
  const size = Number(text("file_size"));

  return {
    title: text("title"),
    category: text("category"),
    campus_id: text("campus_id"),
    description: text("description"),
    file_path: text("file_path"),
    file_name: text("file_name"),
    file_type: text("file_type"),
    file_size: Number.isFinite(size) ? size : 0,
  };
}

/** Collapses zod issues into one message per field, for inline display. */
export function materialFieldErrors(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}
