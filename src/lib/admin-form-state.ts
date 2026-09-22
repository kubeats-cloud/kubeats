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

/**
 * The outcome of a member deletion.
 *
 * `removed` is what the RPC counted as it went, not what the form promised
 * beforehand — an admin who has just destroyed somebody's history deserves to
 * be told what actually went, and a count taken before the delete would be a
 * guess dressed as a receipt. Kept separate from `MemberState` so the create
 * form and the delete dialog cannot render each other's result.
 */
export interface DeleteMemberState extends AdminState {
  deleted?: {
    name: string;
    /** Rows removed, by table. Straight from the RPC's return value. */
    removed: Record<string, number>;
    /** Photographs taken out of the private bucket. */
    photos: number;
  };
}

export const EMPTY_DELETE_MEMBER_STATE: DeleteMemberState = {
  error: null,
  fieldErrors: {},
};
