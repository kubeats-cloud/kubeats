"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logError, toFriendlyMessage } from "@/lib/errors";
import { todayISO } from "@/lib/visits";
import { requireAdmin } from "@/lib/admin";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { assignVisitSchema } from "@/lib/validation/closing-report";
import { CHECK_FIELDS } from "@/lib/visit-form-state";
import type { FormState } from "@/lib/visit-form-state";
import {
  dailyPlanFormDataToInput,
  dailyPlanSchema,
  dailyPlanSummary,
  followUpSchema,
  planIdSchema,
  visitFieldErrors,
} from "@/lib/validation/visit";


async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/**
 * Postgres's duplicate-key code.
 *
 * Only reachable on a plan row while `daily_plans_unique_per_day` is still in
 * place — that is, between this code shipping and migration 0033 being applied.
 * After 0033 nothing on this table is unique on (member, date, institute_id)
 * and these branches become unreachable; they are kept because the deploy
 * window is real and a rep inside it deserves a sentence that fits it.
 */
const UNIQUE_VIOLATION = "23505";

/* ------------------------------------------------------------------ */
/* A. Daily plan                                                       */
/* ------------------------------------------------------------------ */

/**
 * Adds an institute to today's plan.
 *
 * AN INSERT, NOT AN UPSERT, AND THAT IS THE WHOLE FEATURE. This read
 * `.upsert(..., { onConflict: "member,date,institute_id" })` for as long as
 * `daily_plans_unique_per_day` existed, and re-planning an institute corrected
 * the purpose of the one row it was allowed to have. Migration 0033 drops that
 * constraint so a rep can visit one school twice in a day - a morning meeting
 * and an afternoon session - and each of those is its own plan row, its own
 * check-in and its own visit.
 *
 * TWO THINGS FOLLOW FROM THAT, and the second is easy to miss:
 *
 *   * `onConflict` names a real unique constraint. PostgREST answers 42P10 when
 *     it cannot find one, so leaving this an upsert would mean nothing could be
 *     planned at all the moment 0033 lands. This is the change that makes the
 *     deploy order code-first, migration-second.
 *   * correcting a purpose is no longer what re-adding does. A rep who picks
 *     the wrong purpose removes the entry and adds it again, which they could
 *     always do and which `removeFromDailyPlan` still allows for any row that
 *     has not been checked in.
 *
 * `meetings_actual` is still left out of the payload, so nothing here can
 * un-hold a visit that has already happened.
 */
export async function addToDailyPlan(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase, user } = await requireUser();
  if (!user) {
    return { error: "Your session has expired. Please sign in again.", fieldErrors: {} };
  }

  const parsed = dailyPlanSchema.safeParse(dailyPlanFormDataToInput(formData));
  if (!parsed.success) {
    const fieldErrors = visitFieldErrors(parsed.error);
    return { error: dailyPlanSummary(fieldErrors), fieldErrors };
  }

  /**
   * The purpose row is resolved SERVER-SIDE, not trusted from the form.
   *
   * The browser sends a label. What decides the visit's activity — and so which
   * weekly metric it feeds, and whether the meeting gate applies — is the
   * `purposes` row behind it, so the id is looked up here rather than posted.
   * A tampered form can name any label it likes; if no active purpose matches,
   * nothing is planned.
   *
   * `is_active` is part of the match: a retired purpose stays readable for the
   * plans that already reference it, and cannot be used for a new one.
   */
  const { data: purposeRow, error: purposeError } = await supabase
    .from("purposes")
    .select("id, label, requires_note")
    .eq("label", parsed.data.purpose)
    .eq("is_active", true)
    .maybeSingle();

  if (purposeError) {
    logError("plan:purpose-lookup", purposeError);
    return {
      error: toFriendlyMessage(purposeError, "We could not add that to today's plan."),
      fieldErrors: {},
    };
  }
  if (!purposeRow) {
    return {
      error: "That purpose is no longer available. Pick another one.",
      fieldErrors: {},
    };
  }

  // Re-checked against the ROW rather than the form's flag, for the same
  // reason the id is: a client that says "no note needed" must not be able to
  // decide that.
  if (purposeRow.requires_note && !parsed.data.purpose_note) {
    return {
      error: "Say what this visit is for.",
      fieldErrors: { purpose_note: "Say what this visit is for." },
    };
  }

  const today = todayISO();

  /*
   * ONE UNSTARTED ROW PER INSTITUTE AT A TIME.
   *
   * Several visits a day is the feature; two identical rows nobody has walked
   * into yet is a double tap. Before 0033 the unique constraint absorbed that
   * silently, and without something in its place the Dashboard would grow a
   * second "St Xavier's - Follow-up" every time the button was pressed twice on
   * a slow connection.
   *
   * SCOPED TO `checkin_at is null` deliberately. A row the rep has arrived at,
   * or finished, does not block a new one - that is exactly the second visit
   * the client asked for. What is refused is a duplicate of something not yet
   * begun, which is never what anybody means.
   *
   * A courtesy, not a boundary: there is no constraint behind it and two
   * requests racing can still both pass. The cost of that is a spare row the
   * rep can remove, which is why it is checked here rather than being another
   * index.
   */
  const { data: unstarted } = await supabase
    .from("daily_plans")
    .select("id")
    .eq("member", user.id)
    .eq("date", today)
    .eq("institute_id", parsed.data.institute_id)
    .is("checkin_at", null)
    .limit(1);

  if (unstarted && unstarted.length > 0) {
    return {
      error:
        "That institute is already on today's plan and you have not checked in yet. " +
        "Finish or remove that entry before adding it again.",
      fieldErrors: {},
    };
  }

  const { error } = await supabase.from("daily_plans").insert({
    member: user.id,
    date: today,
    institute_id: parsed.data.institute_id,
    purpose: purposeRow.label,
    purpose_id: purposeRow.id,
    // Only ever written when the purpose asks for one, so a note cannot ride
    // along on a purpose that has nothing to explain.
    purpose_note: purposeRow.requires_note ? parsed.data.purpose_note : null,
  });

  if (error) {
    logError("plan:add", error);
    /*
     * 23505 IS NOW A DEPLOY-ORDER SYMPTOM, not a user error.
     *
     * This code ships BEFORE 0033 is applied, so for that window the dropped
     * constraint is still standing and a genuine second visit is refused by it.
     * The rep gets a sentence that describes the state they are actually in
     * rather than "That already exists", which would send them looking for a
     * row that is allowed to be there.
     */
    if (error.code === UNIQUE_VIOLATION) {
      return {
        error:
          "That institute is already on today's plan. Visiting it twice in one day is not available yet.",
        fieldErrors: {},
      };
    }
    return {
      error: toFriendlyMessage(error, "We could not add that to today's plan."),
      fieldErrors: {},
    };
  }

  revalidatePath("/");
  revalidatePath("/log");
  return { error: null, fieldErrors: {}, ok: true };
}

/**
 * An admin putting a visit on someone else's plan.
 *
 * Deliberately the same row, the same table and the same meeting gate as a rep
 * planning their own day — an assignment is not a separate concept, it is a
 * plan entry someone else created. The only difference is assigned_by, which
 * the trigger in migration 0005 insists is the caller.
 *
 * Admin-only here for the sake of a sentence; the RLS policy and that trigger
 * are what actually stop a rep assigning work to anyone.
 */
export async function assignVisit(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const gate = await requireAdmin();
  if (!gate.ok) return { error: gate.error, fieldErrors: {} };

  const parsed = assignVisitSchema.safeParse({
    member: String(formData.get("member") ?? ""),
    institute_id: String(formData.get("institute_id") ?? ""),
    purpose: String(formData.get("purpose") ?? ""),
    date: String(formData.get("date") ?? ""),
  });
  if (!parsed.success) {
    return {
      error: CHECK_FIELDS,
      fieldErrors: visitFieldErrors(parsed.error),
    };
  }
  const input = parsed.data;

  if (input.date < todayISO()) {
    return { error: "You cannot assign a visit in the past.", fieldErrors: {} };
  }

  /**
   * An assignment carries the purpose's mapping too, and it MUST.
   *
   * The rep who receives this will check in and log it, and stage 3 derives the
   * visit's activity from `purpose_id` — so an assignment written with the
   * label alone would hand them a planned visit the app cannot turn into an
   * activity. Same lookup, same reasons, as the rep's own path above.
   */
  const { data: purposeRow, error: purposeError } = await gate.supabase
    .from("purposes")
    .select("id, label")
    .eq("label", input.purpose)
    .eq("is_active", true)
    .maybeSingle();

  if (purposeError) {
    logError("plan:assign-purpose-lookup", purposeError);
    return {
      error: toFriendlyMessage(purposeError, "We could not assign that visit."),
      fieldErrors: {},
    };
  }
  if (!purposeRow) {
    return {
      error: "That purpose is no longer available. Pick another one.",
      fieldErrors: {},
    };
  }

  /*
   * An insert, for the same reason addToDailyPlan is one: `onConflict` names a
   * constraint 0033 removes, and an admin assigning a second visit to the same
   * school on the same day is the feature working rather than a mistake to
   * absorb.
   *
   * NO UNSTARTED-DUPLICATE CHECK HERE, unlike the rep's own path. An admin
   * assigning the same institute twice is far more likely to mean it — two
   * errands at one school — and they are looking at the Assign screen rather
   * than tapping a button on a phone with no signal. The rep's check exists to
   * absorb a double tap; there is no double tap to absorb here.
   */
  const { error } = await gate.supabase.from("daily_plans").insert({
    member: input.member,
    date: input.date,
    institute_id: input.institute_id,
    purpose: purposeRow.label,
    purpose_id: purposeRow.id,
    assigned_by: gate.user.id,
  });

  if (error) {
    logError("plan:assign", error);
    if (error.code === "42501") {
      return { error: "Only an admin can assign a visit.", fieldErrors: {} };
    }
    // Only reachable before 0033 is applied — see UNIQUE_VIOLATION above.
    if (error.code === UNIQUE_VIOLATION) {
      return {
        error:
          "That rep already has that institute on that day's plan. Assigning a second visit to the same institute is not available yet.",
        fieldErrors: {},
      };
    }
    // FO023 — WIDENED BY 0028, and this message was stale until now. The guard
    // used to check the rep's CAMPUS; it checks OWNERSHIP, which implies the
    // campus. An institute on a rep's campus but owned by a colleague is now
    // refused, and being told "not in that rep's campus" would send an admin to
    // look at the campus, which is correct and not the problem.
    //
    // Both routes into this action are filtered — the Assign picker narrows to
    // the chosen rep's institutes, and Pending's shortcut assigns to the owner
    // by construction — so this is the backstop, reached mainly when an
    // institute is reassigned between the page rendering and the button being
    // pressed. The remedy is named because it is two taps away.
    if (error.code === "FO023") {
      return {
        error:
          "That institute belongs to another rep. Reassign it to this rep first, then assign the visit.",
        fieldErrors: {},
      };
    }
    // FO026 — the same ownership rule, enforced on the plan row itself. Reached
    // by the same race; worth its own sentence rather than falling through to
    // the generic message, which would say nothing an admin could act on.
    if (error.code === "FO026") {
      return {
        error:
          "That institute is not that rep's. Reassign it to them first, then assign the visit.",
        fieldErrors: {},
      };
    }
    return {
      error: toFriendlyMessage(error, "We could not assign that visit."),
      fieldErrors: {},
    };
  }

  revalidatePath("/");
  revalidatePath("/settings");
  return { error: null, fieldErrors: {}, ok: true };
}

/**
 * Start a follow-up visit at an institute that is still open.
 *
 * SEEDS A PLAN ROW AND HANDS OVER. It does not check in, does not log, and does
 * not track — it puts the institute on today's plan and sends the rep to the
 * Dashboard, which is where `CheckInButton` lives and where a visit in progress
 * is followed.
 *
 * That split is the whole reason this is allowed to exist. CLAUDE.md says the
 * Dashboard owns the daily-plan create-and-track flow, and that a second writer
 * in front of the `daily_plans` row Rule 2 checks is the thing screen ownership
 * exists to prevent. This writes the row and immediately gives the flow back,
 * so there is still exactly one screen where a visit is tracked. `assignVisit()`
 * above is a second writer under the same reasoning.
 *
 * It is NOT a parallel flow: from the redirect onwards this is the ordinary
 * check-in → log → report → auto-check-out chain, with the same photo, the same
 * presence guarantee and the same gate. Pending is only a new way in.
 *
 * REPS ONLY. An admin has no campus (`enforce_profile_campus`, FO021) and does
 * not do field visits, so a launch would put the visit on the ADMIN's own day.
 * Admin Pending is read-only (D10) and never renders the control that calls
 * this; the guard below is what makes that true rather than merely displayed.
 */
export async function startFollowUp(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase, user } = await requireUser();
  if (!user) {
    return { error: "Your session has expired. Please sign in again.", fieldErrors: {} };
  }

  const parsed = followUpSchema.safeParse({
    institute_id: String(formData.get("institute_id") ?? ""),
    purpose: String(formData.get("purpose") ?? ""),
    purpose_note: String(formData.get("purpose_note") ?? ""),
    requires_note: String(formData.get("requires_note") ?? "") === "yes",
  });
  if (!parsed.success) {
    const fieldErrors = visitFieldErrors(parsed.error);
    return { error: dailyPlanSummary(fieldErrors), fieldErrors };
  }

  if (isAdmin(await getCurrentUser())) {
    return {
      error: "Admins do not log visits. Assign this follow-up to a rep instead.",
      fieldErrors: {},
    };
  }

  /**
   * #7 — one open visit at a time, said before the tap rather than after.
   *
   * `daily_plans_one_open_visit` and FO013 refuse a second arrival anyway, but
   * that refusal would land after the rep had already been redirected and
   * pressed Check in. Naming the institute that is holding them is the
   * difference between a dead end and a sentence.
   */
  const today = todayISO();
  const { data: openElsewhere } = await supabase
    .from("daily_plans")
    .select("institute_id, institutes(name)")
    .eq("member", user.id)
    .not("checkin_at", "is", null)
    .is("checkout_at", null)
    .eq("checkout_missing", false)
    .limit(1)
    .maybeSingle();

  if (openElsewhere && openElsewhere.institute_id !== parsed.data.institute_id) {
    // PostgREST types a one-to-one embed as an array; the same narrowing
    // visits.ts does for the joined purpose row.
    const joined = openElsewhere.institutes as unknown;
    const holder = Array.isArray(joined) ? joined[0] : joined;
    const name = (holder as { name?: string } | null)?.name ?? "another institute";
    return {
      error: `You are still checked in at ${name}. Finish that visit first.`,
      fieldErrors: {},
    };
  }

  // Resolved server-side and never trusted from the form, for the same reason
  // addToDailyPlan does it: the purpose decides the activity, and therefore
  // which weekly metric this visit will feed.
  const { data: purposeRow, error: purposeError } = await supabase
    .from("purposes")
    .select("id, label, requires_note")
    .eq("label", parsed.data.purpose)
    .eq("is_active", true)
    .maybeSingle();

  if (purposeError) {
    logError("plan:follow-up-purpose", purposeError);
    return {
      error: toFriendlyMessage(purposeError, "We could not start that visit."),
      fieldErrors: {},
    };
  }
  if (!purposeRow) {
    return {
      error: "That purpose is no longer available. Pick another one.",
      fieldErrors: {},
    };
  }
  if (purposeRow.requires_note && !parsed.data.purpose_note) {
    return {
      error: "Say what this visit is for.",
      fieldErrors: { purpose_note: "Say what this visit is for." },
    };
  }

  /**
   * What is already on today's plan for this institute — which may now be
   * SEVERAL rows, and used to be at most one.
   *
   * `.maybeSingle()` stood here and would throw PGRST116 the moment 0033 let a
   * second row exist. That is the sharpest kind of break: not a wrong answer, a
   * thrown one, on the screen a rep reaches by tapping a follow-up.
   *
   * So it reads the LIST and asks a question about it. Newest first, because
   * the only row that can block anything is the most recent one.
   */
  const { data: existingRows, error: existingError } = await supabase
    .from("daily_plans")
    .select("id, checkin_at, checkout_at, checkout_missing")
    .eq("member", user.id)
    .eq("date", today)
    .eq("institute_id", parsed.data.institute_id)
    .order("created_at", { ascending: false });

  if (existingError) {
    logError("plan:follow-up-existing", existingError);
    return {
      error: toFriendlyMessage(existingError, "We could not start that visit."),
      fieldErrors: {},
    };
  }

  const rows = existingRows ?? [];

  /*
   * THE QUESTION IS "IS ONE STILL RUNNING", NOT "DOES ONE EXIST", and that is
   * the whole of what 0033 changes here.
   *
   * Before, any row for this institute today meant "already handled": if it had
   * an arrival its purpose was left alone, if it did not the upsert corrected
   * it. Neither is right once a day can hold several visits.
   *
   *   in progress      hand it back untouched. Overwriting the purpose of a
   *                    visit the rep is standing inside would change what it
   *                    counts as, mid-visit, from a screen they are not even
   *                    looking at. FO014 guards the DELETE path; nothing in the
   *                    database guards this one.
   *   not yet started  hand it back too. It is the entry they are about to
   *                    walk into, and a second identical row helps nobody.
   *   finished         INSERT A NEW ONE. This is the feature: a rep who held a
   *                    meeting at St Xavier's this morning and is now sent back
   *                    by Pending gets a fresh plan row, a fresh check-in and a
   *                    fresh visit, rather than being told they have already
   *                    been there today.
   */
  const live = rows.find(
    (row) =>
      row.checkin_at === null ||
      (row.checkout_at === null && row.checkout_missing !== true),
  );

  if (!live) {
    const { error } = await supabase.from("daily_plans").insert({
      member: user.id,
      date: today,
      institute_id: parsed.data.institute_id,
      purpose: purposeRow.label,
      purpose_id: purposeRow.id,
      purpose_note: purposeRow.requires_note ? parsed.data.purpose_note : null,
    });

    if (error) {
      logError("plan:follow-up", error);
      // Only reachable before 0033 is applied — the constraint still standing
      // is what refuses the second visit. Named, because "we could not start
      // that visit" would read as a fault rather than as a feature not yet on.
      if (error.code === UNIQUE_VIOLATION) {
        return {
          error:
            "You have already visited that institute today. Visiting it twice in one day is not available yet.",
          fieldErrors: {},
        };
      }
      return {
        error: toFriendlyMessage(error, "We could not start that visit."),
        fieldErrors: {},
      };
    }
  }

  revalidatePath("/");
  revalidatePath("/pending");
  // Back to the one screen that tracks a visit. The rep checks in from there.
  redirect("/?followup=1");
}

export async function removeFromDailyPlan(planId: string): Promise<FormState> {
  const { supabase, user } = await requireUser();
  if (!user) {
    return { error: "Your session has expired. Please sign in again.", fieldErrors: {} };
  }

  // An id is input like any other. RLS already scopes the delete to the
  // caller's own rows, but a malformed id should come back as a sentence rather
  // than as a Postgres syntax error.
  const parsed = planIdSchema.safeParse(planId);
  if (!parsed.success) {
    return { error: "That entry could not be identified.", fieldErrors: {} };
  }

  const { error } = await supabase
    .from("daily_plans")
    .delete()
    .eq("id", parsed.data)
    .is("meetings_actual", null) // a held visit stays on the record
    // ...and so does one the rep has already arrived at. Without this, "check
    // in, remove the entry, add it again, check in again" bought a second
    // arrival at the same institute on the same day — defeating #8 and walking
    // straight through FO011's write-once checkin_at, because a new ROW gets a
    // new timestamp honestly. guard_checkin_cycle_final (FO014) says the same
    // thing in the database, where a tampered request also has to hear it.
    .is("checkin_at", null);

  if (error) {
    logError("plan:remove", error);
    return {
      error: toFriendlyMessage(error, "We could not remove that entry."),
      fieldErrors: {},
    };
  }

  revalidatePath("/");
  revalidatePath("/log");
  return { error: null, fieldErrors: {}, ok: true };
}

/* ------------------------------------------------------------------ */
/* B–D. Logging a visit                                                */
/* ------------------------------------------------------------------ */

/*
 * createVisit() lived here — the single-step "log a visit" that redirected to
 * the closing report afterwards.
 *
 * Stage 3 replaced it with logAndFileVisit() in feedback-actions.ts, which logs
 * the visit AND files its short feedback AND checks the rep out from one
 * submit. Keeping this one alongside would have left a second way into
 * log_visit() that skipped the feedback and the check-out entirely — which is
 * exactly the dodge the forced chain exists to close.
 */
