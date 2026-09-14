/**
 * Reading a closing report that could have been filed by either form.
 *
 * Two fields are recorded in different places depending on which era filed the
 * report, and the view got this wrong in both directions at once: it read only
 * the retired long report's columns, so every report filed by the SHORT form —
 * which is every report the app has taken since 0019 — rendered "—" for the
 * note and "Nobody was recorded" for the person met, over data that was sitting
 * in the row the whole time.
 *
 * These are pure so the choice can be tested without rendering anything, and so
 * there is one answer to "where does this field live" rather than one per
 * component. Kept out of `closing-report.ts` because that module is
 * `server-only`; same split, and same reason, as `campus-display.ts`.
 */

/** Blank, whitespace and null all mean "not recorded". */
function present(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * What they said, from whichever column holds it.
 *
 * The short form's "What did they say?" is `visits.notes` (written by
 * `close_visit()`'s `p_notes`); the retired long report wrote
 * `discussion_summary`. A report has one or the other. `notes` wins where both
 * somehow exist, because only the current form can have written it.
 */
export function discussionOf(report: {
  notes: string | null;
  discussion_summary: string | null;
}): string | null {
  return present(report.notes) ?? present(report.discussion_summary);
}

/** One person met, as the short form records them. */
export interface MetPerson {
  name: string;
  phone: string | null;
}

/**
 * The single person the short form records, or null for a long-form report
 * that used the `visit_people` table instead.
 *
 * A phone with no name is dropped rather than shown as an anonymous number:
 * 0022 made the NAME the mandatory half precisely because a report that named
 * nobody was the thing worth preventing, and `visits_met_phone_valid` already
 * guarantees any number present is a real one.
 */
export function metPersonOf(report: {
  met_name: string | null;
  met_phone: string | null;
}): MetPerson | null {
  const name = present(report.met_name);
  if (!name) return null;
  return { name, phone: present(report.met_phone) };
}
