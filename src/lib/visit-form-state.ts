/**
 * Plain module, deliberately not "use server" — every runtime export of an
 * actions file becomes a server-function reference, and React then tries to
 * call it during render.
 */
export interface FormState {
  error: string | null;
  fieldErrors: Record<string, string>;
  /** Set on success so a form can confirm without navigating away. */
  ok?: boolean;
}

export const EMPTY_STATE: FormState = { error: null, fieldErrors: {} };
