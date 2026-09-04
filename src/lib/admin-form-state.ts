/**
 * Form state shapes for the admin screens.
 *
 * A plain module, NOT "use server". Every runtime export of a "use server" file
 * becomes a server-function reference, so a constant exported from one is
 * called rather than read and the form never mounts — the bug that cost an
 * afternoon in Phase 4.
 */

export interface AdminState {
  error: string | null;
  fieldErrors: Record<string, string>;
  ok?: boolean;
  /** Shown after a successful action, e.g. "Added Ranchi to Jharkhand." */
  message?: string;
}

export const EMPTY_ADMIN_STATE: AdminState = { error: null, fieldErrors: {} };

export interface FlushState extends AdminState {
  /** How many photos the cutoff matches, filled in by the count step. */
  count?: number;
  /** The cutoff the count was taken for, so the confirm step cannot drift. */
  cutoff?: string;
  /** How many were actually deleted, filled in by the delete step. */
  deleted?: number;
}

export const EMPTY_FLUSH_STATE: FlushState = { error: null, fieldErrors: {} };

export interface MemberState extends AdminState {
  /** The account just created, so the admin can hand the details over once. */
  created?: { name: string; email: string; role: string };
}

export const EMPTY_MEMBER_STATE: MemberState = { error: null, fieldErrors: {} };
