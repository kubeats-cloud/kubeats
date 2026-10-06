/**
 * Plain module, deliberately not "use server".
 *
 * Every runtime export of a "use server" file is turned into a server-function
 * reference, so a const living there is handed to the client as something
 * callable — React then reports "Server Functions cannot be called during
 * initial render" and the form never mounts. Only async functions belong in the
 * actions file; shared shapes and defaults belong here.
 */
export interface InstituteFormState {
  error: string | null;
  /** Keyed by field name so the form can point at the offending input. */
  fieldErrors: Record<string, string>;
}

export const EMPTY_FORM_STATE: InstituteFormState = {
  error: null,
  fieldErrors: {},
};

/**
 * The counsellor panel's form state (B2).
 *
 * Here rather than in `institute-actions.ts` for the reason stated at the head
 * of this file, which is not a style preference: `EMPTY_COUNSELLOR_STATE` is a
 * CONST, and a const exported from a "use server" module is handed to the
 * client as a server-function reference. The panel would then fail to mount
 * with "Server Functions cannot be called during initial render", and
 * `use-server-exports.test.ts` is what catches it — it caught exactly this.
 */
export interface CounsellorState {
  error: string | null;
  fieldErrors: Record<string, string>;
  ok?: boolean;
}

export const EMPTY_COUNSELLOR_STATE: CounsellorState = {
  error: null,
  fieldErrors: {},
};
