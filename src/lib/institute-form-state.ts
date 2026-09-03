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
