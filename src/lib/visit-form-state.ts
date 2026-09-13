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

/**
 * What a form says when it is not finished yet.
 *
 * Said the same way everywhere, and said calmly. Twelve copies of "Please
 * check the highlighted fields." had accumulated across the actions and the
 * client-side pre-checks, which is twelve chances for one of them to end up
 * sterner than the rest. FormNotice renders these; nothing else should word
 * this moment for itself.
 */
export const CHECK_FIELDS = "A few details still need filling in.";
export const CHECK_FIELD = "One detail still needs filling in.";
export const CHECK_NUMBERS = "A couple of the numbers need another look.";
