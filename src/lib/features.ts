/**
 * Features that are built, shipped and currently TAKEN DOWN.
 *
 * ⚠ A FLAG HERE HIDES A SURFACE. IT NEVER REMOVES DATA, A COLUMN, A POLICY OR A
 * RULE. Everything a hidden feature wrote is still in Postgres, every trigger
 * that guarded it still fires, and every row a rep already created is still
 * readable by whatever else reads it. Turning one back on is changing `false`
 * to `true` here and nothing else — which is the whole reason this file exists
 * rather than the screens being edited back.
 *
 * WHY A CONSTANT AND NOT AN ENVIRONMENT VARIABLE. CLAUDE.md requires every
 * `process.env` read to live in `src/lib/env.ts`, and an env var would make the
 * app's behaviour depend on deployment configuration that is not in the repo —
 * so "is the daily plan on?" could be answered differently by two environments
 * and neither would say so in a diff. A constant is reviewable, greppable, and
 * changes in one commit.
 *
 * `NEXT_PUBLIC_*` would be worse again: inlined at build time, so flipping it
 * needs a rebuild anyway, with none of a constant's traceability.
 */

/**
 * Phase A's daily-plan surfaces — the dashboard's Meetings / Follow-up calls
 * split, the "Plan the morning" tick-list, and Log Visit's "Next action" pair.
 *
 * ⚠ OFF BECAUSE THE CLIENT IS HAVING IT REDONE, NOT BECAUSE IT IS BROKEN. The
 * schema, the rows and the rules stay exactly where they are:
 *
 *   follow_up_tasks      table, policies and FO031 all live (0038). Rows a rep
 *                        already raised are untouched and still closable — see
 *                        the note on Pending below.
 *   visits.next_action   column and its CHECK live (0038). Nothing writes it
 *                        while this is off, which is what the column being
 *                        NULLABLE was always for.
 *   close_visit()        still accepts `p_follow_up_kind` and friends (0039).
 *                        Every one is a DEFAULTED parameter, so a form that
 *                        stops asking simply passes null — the same withdrawal
 *                        CLAUDE.md describes for the closing report's retired
 *                        questions, and the reason logging still works with the
 *                        field gone.
 *   daily_plans          never belonged to Phase A at all. The plan itself, the
 *                        meeting gate, check-in/out and Rule 7 are untouched;
 *                        what goes is the SPLIT and the batch add, not the plan.
 *
 * ⚠ ONE SURFACE IS DELIBERATELY NOT BEHIND THIS FLAG: Pending's "Due today"
 * block. It is the only place a rep can CLOSE a follow-up they already owe, and
 * hiding it would strand every outstanding task — data that can be read and
 * never finished. With this flag off nothing creates new ones, so that list
 * drains on its own. Gate it too, by wrapping the `<FollowUpCalls>` in
 * `src/app/(app)/pending/page.tsx`, only once the client has decided what
 * happens to the tasks already open.
 *
 * E1's alert machinery is untouched and is not a Phase A surface: it is not
 * shipped to anybody yet, and `materialise_daily_alerts()` reading
 * `follow_up_tasks` is a cron job, not a screen.
 */
export const PHASE_A_DAILY_PLAN = false;
