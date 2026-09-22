import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DATABASE_BEHIND, GENERIC_ERROR, toFriendlyMessage } from "@/lib/errors";
import {
  confirmationMatches,
  deleteMemberSchema,
} from "@/lib/validation/admin";

/**
 * The Settings crash, and why it took a re-test to find.
 *
 * THREE THINGS WERE WRONG AT ONCE and each hid the next.
 *
 * (1) THE DATABASE WAS BEHIND THE BUILD. Every mutation on this screen names a
 *     column added by migration 0024, 0025 or 0026. Against a database that has
 *     not had them applied, PostgREST answers PGRST204 ("could not find the
 *     column in the schema cache") on a write and Postgres answers 42703
 *     ("column does not exist") on a read. Neither code was mapped, so both
 *     came out as the caller's generic fallback — "We could not add that
 *     purpose." — which is exactly what a network blip looks like. The one
 *     failure that can only mean "apply a migration" was the one failure that
 *     said nothing about itself.
 *
 * (2) TWO OF THE FOUR MUTATIONS THREW THEIR ANSWER AWAY. setStatusActive and
 *     setPurposeActive return an AdminState; both click handlers awaited it and
 *     dropped it. So the refusal in (1) was not merely generic, it was
 *     invisible: the badge did not move and nothing appeared. A button that
 *     does nothing is indistinguishable from a tap that did not register.
 *
 * (3) AND THE TWO ADD FORMS CLEARED THEMSELVES MID-SUBMIT. Their onSubmit
 *     cleared controlled state on the SUCCESS path without preventDefault, so
 *     React flushed a re-render that emptied the hidden inputs it was about to
 *     build FormData from — and, in the purposes panel, unmounted the lifecycle
 *     <Select> that `activity` conditionally renders, inside the dispatch that
 *     Select was part of.
 *
 * WHAT IS CHECKABLE FROM NODE. (1) is a pure function and is tested properly
 * below. (2) and (3) live in components, and this project has no DOM test
 * environment on purpose — vitest.config.mts documents the split and
 * log-visit-form.test.ts explains why adding one is an architectural decision
 * rather than a side effect of a bug fix. So those are read at source level,
 * which is what log-visit-form.test.ts already does for the same class of bug.
 */

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), "utf8");

const PURPOSES = "src/components/settings/purposes-panel.tsx";
const STATUSES = "src/components/settings/statuses-panel.tsx";
const TEAM = "src/components/settings/team-panel.tsx";
const ACTIONS = "src/lib/admin-actions.ts";
const MIGRATION = "supabase/migrations/0032_delete_member.sql";

/* ------------------------------------------------------------------ */
/* (1) a database behind its app says so                               */
/* ------------------------------------------------------------------ */

describe("a schema that is behind the build names itself", () => {
  /**
   * The two codes, and the shapes they actually arrive in.
   *
   * Taken from a live probe rather than invented: these are verbatim what a
   * database at migration 0022 answered to the four Settings mutations.
   */
  const WRITE_AGAINST_OLD_SCHEMA = {
    code: "PGRST204",
    message: "Could not find the 'activity' column of 'purposes' in the schema cache",
  };
  const READ_AGAINST_OLD_SCHEMA = {
    code: "42703",
    message: "column institute_statuses.tone does not exist",
  };

  it("maps a missing column on a WRITE to the migration message", () => {
    expect(toFriendlyMessage(WRITE_AGAINST_OLD_SCHEMA)).toBe(DATABASE_BEHIND);
  });

  it("maps a missing column on a READ to the same message", () => {
    expect(toFriendlyMessage(READ_AGAINST_OLD_SCHEMA)).toBe(DATABASE_BEHIND);
  });

  it("beats the caller's own fallback, which is the whole point", () => {
    // This is the regression. Every one of these actions passes a fallback, and
    // a fallback is the right answer for an unknown failure — but not for this
    // one, where the fallback actively misdirects.
    expect(toFriendlyMessage(WRITE_AGAINST_OLD_SCHEMA, "We could not add that purpose.")).toBe(
      DATABASE_BEHIND,
    );
    expect(toFriendlyMessage(READ_AGAINST_OLD_SCHEMA, "We could not load the statuses.")).toBe(
      DATABASE_BEHIND,
    );
  });

  it("tells the reader not to retry, because retrying cannot work", () => {
    // The wording is load-bearing. "Please try again in a moment" sent a real
    // re-test round the loop repeatedly before anyone looked at the schema.
    expect(DATABASE_BEHIND).toMatch(/not help/i);
    expect(DATABASE_BEHIND).not.toMatch(/try again/i);
    expect(DATABASE_BEHIND).not.toBe(GENERIC_ERROR);
  });

  it("leaks no column, table or SQL into the sentence", () => {
    // The code and the message stay in the server log where logError puts them.
    for (const fragment of ["purposes", "institute_statuses", "activity", "tone", "schema cache"]) {
      expect(DATABASE_BEHIND).not.toContain(fragment);
    }
  });

  it("still lets an ordinary failure have its own wording", () => {
    // A duplicate is a duplicate whatever the schema version, and a caller's
    // fallback must still win for anything unrecognised.
    expect(toFriendlyMessage({ code: "23505" })).toBe("That already exists.");
    expect(toFriendlyMessage({ code: "XX000" }, "We could not add that purpose.")).toBe(
      "We could not add that purpose.",
    );
  });
});

/* ------------------------------------------------------------------ */
/* (2) retire and restore answer for themselves                        */
/* ------------------------------------------------------------------ */

describe("every Settings mutation reports what happened", () => {
  const PANELS: [string, string][] = [
    [PURPOSES, "setPurposeActive"],
    [STATUSES, "setStatusActive"],
  ];

  /** Formatting is not the subject here, so it is taken out of the question. */
  const flat = (file: string) => read(file).replace(/\s+/g, " ");

  it.each(PANELS)("%s keeps what %s returned", (file, action) => {
    // The bug in one line: `await setStatusActive(...)` with the result
    // discarded. The state has to be captured, or a refusal cannot be shown.
    expect(flat(file)).toContain(`setRetireState( await ${action}(`);
    // ...and it has to reach the screen, not just a variable.
    const source = read(file);
    expect(source).toContain("retireState?.error");
    expect(source).toContain("retireState?.ok");
  });

  it.each(PANELS)("%s never awaits %s for its side effect alone", (file, action) => {
    // A bare `await setStatusActive(...)` as a statement inside the transition
    // body is the shape that was wrong. If it comes back, so does a button that
    // silently does nothing.
    expect(flat(file)).not.toContain(`{ await ${action}(`);
  });
});

/* ------------------------------------------------------------------ */
/* (3) neither add form clears itself mid-submit                       */
/* ------------------------------------------------------------------ */

/**
 * The invariant, stated as an ORDER rather than as an absence.
 *
 * Clearing the form after a successful add is wanted behaviour and always was.
 * What must never happen is clearing it *before* the FormData that carries it
 * has been read. So this asserts the sequence — capture, dispatch, then clear —
 * which is the thing that makes the clearing safe.
 */
describe("the add forms read the form before they empty it", () => {
  const FORMS: [string, string[]][] = [
    [PURPOSES, ["setLabel(\"\")", "setActivity(\"\")", "setLifecycle(\"\")"]],
    [STATUSES, ["setLabel(\"\")", "setCategory(\"\")", "setTone(\"\")"]],
  ];

  it.each(FORMS)("%s dispatches its own action", (file) => {
    const source = read(file as string);
    expect(source).toContain("event.preventDefault()");
    expect(source).toContain("new FormData(event.currentTarget)");
    expect(source).toContain("formAction(formData)");
  });

  it.each(FORMS)("%s captures, dispatches, and only then clears", (file, setters) => {
    const source = read(file as string);
    const capture = source.indexOf("new FormData(event.currentTarget)");
    const dispatch = source.indexOf("formAction(formData)");
    expect(capture, "the form is read").toBeGreaterThan(-1);
    expect(dispatch, "and dispatched").toBeGreaterThan(capture);

    for (const setter of setters as string[]) {
      const cleared = source.lastIndexOf(setter);
      expect(cleared, `${setter} is present`).toBeGreaterThan(-1);
      // THE WHOLE REGRESSION. Every clearing setter must come after the
      // snapshot, or it empties a hidden input on its way to the server.
      expect(cleared, `${setter} runs after the FormData snapshot`).toBeGreaterThan(
        capture,
      );
    }
  });

  it("the purposes panel no longer unmounts a Select inside its own submit", () => {
    const source = read(PURPOSES);
    // `activity` decides whether the lifecycle <Select> is rendered at all, so
    // clearing it tears that Select down. Safe only once the dispatch is ours
    // and the snapshot is already taken — which the ordering test above proves.
    expect(source).toContain("needsLifecycle && (");
    const capture = source.indexOf("new FormData(event.currentTarget)");
    expect(source.lastIndexOf('setActivity("")')).toBeGreaterThan(capture);
  });
});

/* ------------------------------------------------------------------ */
/* (4) deleting a member — the guards, and where each one lives        */
/* ------------------------------------------------------------------ */

/**
 * The one TRUE delete on the Settings screen, and the only irreversible thing
 * an admin can do in the app.
 *
 * Everything else here is retired: a status keeps what a past visit said, a
 * purpose keeps a weekly metric earnable. A member who has left is neither, and
 * the client asked for the account and its data to be gone. So the interesting
 * question is not "does it delete" — that needs a database, and the integration
 * suite asks it — but "can it be reached by accident", which is four guards and
 * is checkable from Node.
 *
 * WHAT IS CHECKED WHERE. The confirmation rule is a pure function and is tested
 * properly. The guards live in a "use server" module and the dialog in a client
 * component, and this project has no DOM test environment on purpose
 * (vitest.config.mts documents the split), so those are read at source level —
 * the same thing log-visit-form.test.ts and section (2) above already do.
 */

describe("the typed-name confirmation", () => {
  it("accepts the name exactly", () => {
    expect(confirmationMatches("Asha Menon", "Asha Menon")).toBe(true);
  });

  it("forgives case and surrounding space, because it is not a typing test", () => {
    // The point of typing a name is to make the admin LOOK at which member they
    // are about to delete. A trailing space is not the mistake this guards.
    expect(confirmationMatches("  asha menon  ", "Asha Menon")).toBe(true);
  });

  it("refuses a different name, a partial one, and an empty box", () => {
    expect(confirmationMatches("Asha", "Asha Menon")).toBe(false);
    expect(confirmationMatches("Asha Menonn", "Asha Menon")).toBe(false);
    expect(confirmationMatches("", "Asha Menon")).toBe(false);
    expect(confirmationMatches("   ", "Asha Menon")).toBe(false);
  });

  it("refuses everything when the member has no name at all", () => {
    // profiles.name is nullable, so the action reads "" for an unnamed member.
    // Matching "" against "" would make the confirmation box a formality — an
    // empty press would delete somebody. It must fail closed.
    expect(confirmationMatches("", "")).toBe(false);
    expect(confirmationMatches("anything", "")).toBe(false);
  });

  it("does not collapse inner spaces or strip punctuation", () => {
    // Anything cleverer than trim-and-fold starts accepting a name that is not
    // the name, which is the opposite of what a confirmation is for.
    expect(confirmationMatches("Asha  Menon", "Asha Menon")).toBe(false);
    expect(confirmationMatches("AshaMenon", "Asha Menon")).toBe(false);
  });
});

describe("the delete schema insists something was typed", () => {
  const id = "11111111-2222-4333-8444-555555555555";

  it("takes a uuid and a non-empty confirmation", () => {
    const parsed = deleteMemberSchema.safeParse({
      member: id,
      confirm_name: "Asha Menon",
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses an empty confirmation before the action is ever reached", () => {
    const parsed = deleteMemberSchema.safeParse({ member: id, confirm_name: "  " });
    expect(parsed.success).toBe(false);
  });

  it("refuses an id that is not a uuid", () => {
    const parsed = deleteMemberSchema.safeParse({
      member: "not-an-id",
      confirm_name: "Asha Menon",
    });
    expect(parsed.success).toBe(false);
  });

  it("carries no name to compare against, which is the point", () => {
    // A schema that validated the name against one posted beside it would be
    // comparing a tampered pair to itself. The action reads profiles.name and
    // compares against THAT; this only insists the box was filled in.
    const shape = Object.keys(
      deleteMemberSchema.parse({ member: id, confirm_name: "x" }),
    );
    expect(shape.sort()).toEqual(["confirm_name", "member"]);
  });
});

describe("all four guards stand in the server action", () => {
  const source = read(ACTIONS);
  const flat = source.replace(/\s+/g, " ");

  it("is admin-only, like every other action in the file", () => {
    const start = source.indexOf("export async function deleteMember");
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, start + 800);
    expect(body).toContain("await requireAdmin()");
  });

  it("refuses an admin deleting themselves", () => {
    expect(flat).toContain("if (member === gate.user.id)");
  });

  it("refuses the last remaining admin", () => {
    expect(flat).toContain('.eq("role", "admin")');
    expect(flat).toContain("(count ?? 0) <= 1");
  });

  it("compares the typed name against the DATABASE value, never a posted one", () => {
    // THE REGRESSION TO PREVENT. A form that posts both the id and the name it
    // should match is a form a tampered request answers for itself. The name
    // has to be read back.
    expect(flat).toContain('.from("profiles")');
    expect(flat).toContain('const actualName = target.name ?? ""');
    expect(flat).toContain("confirmationMatches(confirm_name, actualName)");
    // ...and never against anything that arrived in the FormData.
    expect(flat).not.toContain("confirmationMatches(confirm_name, textOf(");
  });

  it("names the institutes when a colleague's work is in the way", () => {
    expect(flat).toContain('.eq("registered_by", member)');
    expect(flat).toContain('.neq("member", member)');
    expect(flat).toContain("Reassign");
  });

  it("refuses an unnamed member with the remedy, not an impossible instruction", () => {
    // confirmationMatches fails closed on an empty target, so without this the
    // refusal would read `Type "" exactly to confirm` for ever — a button that
    // can never succeed, which is the failure the Settings panels were already
    // fixed for once.
    expect(flat).toContain('if (actualName.trim() === "")');
    expect(flat).toContain("has no name recorded");
    // ...and the trigger is disabled for those rows, so it is not reached by an
    // ordinary tap at all.
    expect(read(TEAM)).toContain("member.isUnnamed");
  });
});

describe("the teardown runs in the one order the foreign keys allow", () => {
  const source = read(ACTIONS);
  const rpcAt = source.indexOf('"delete_member"');

  it("reads the photo paths before the rows that hold them are deleted", () => {
    const photos = source.indexOf('.select("photo_url")');
    expect(photos).toBeGreaterThan(-1);
    expect(rpcAt).toBeGreaterThan(photos);
  });

  it("empties the bucket after the rows and before the auth user", () => {
    // Storage is not transactional and cannot join the RPC. After the rows, so
    // a teardown that rolls back has not already destroyed the photographs of
    // visits that still exist; before the auth user, so the id naming the
    // folder still means something if this half fails.
    const storage = source.indexOf('.from("visit-photos")');
    const authDelete = source.indexOf("db.auth.admin.deleteUser(member)");
    expect(rpcAt).toBeGreaterThan(-1);
    expect(storage).toBeGreaterThan(rpcAt);
    expect(authDelete).toBeGreaterThan(storage);
  });

  it("builds the service-role client before anything is destroyed", () => {
    // It throws when the key is missing. Discovering that after the rows had
    // gone would leave an account that can still sign in with no data behind it.
    const client = source.indexOf("db = createAdminClient()");
    expect(client).toBeGreaterThan(-1);
    expect(rpcAt).toBeGreaterThan(client);
  });

  it("never deletes materials — the library is shared", () => {
    const start = source.indexOf("export async function deleteMember");
    const end = source.indexOf("export async function flushPhotos");
    const body = source.slice(start, end);
    expect(body).not.toContain('from("materials")');
  });

  it("leaks no database text to the screen", () => {
    // FO027's own message is never passed through. The wording lives in
    // errors.ts and in the action, like every other refusal in this app.
    const start = source.indexOf("export async function deleteMember");
    const end = source.indexOf("export async function flushPhotos");
    const body = source.slice(start, end);
    expect(body).not.toContain("rpcError.message");
  });
});

describe("FO027 has a sentence that leaks nothing", () => {
  it("is mapped by code", () => {
    expect(toFriendlyMessage({ code: "FO027" })).toBe(
      "That member could not be deleted. Nothing was changed.",
    );
  });

  it("beats the generic fallback", () => {
    expect(toFriendlyMessage({ code: "FO027" })).not.toBe(GENERIC_ERROR);
  });

  it("carries no table, column, id or SQL", () => {
    const message = toFriendlyMessage({ code: "FO027" });
    for (const fragment of ["institutes", "registered_by", "delete_member", "uuid"]) {
      expect(message).not.toContain(fragment);
    }
  });
});

describe("the dialog cannot be opened for the two members it must never delete", () => {
  const source = read(TEAM);

  it("disables the trigger for the viewer's own row", () => {
    expect(source).toContain("member.isSelf");
    expect(source).toContain("You cannot delete your own account");
  });

  it("disables it for the sole admin", () => {
    expect(source).toContain("member.isLastAdmin");
    expect(source).toContain("The only admin account cannot be deleted");
  });

  it("disables the confirm button on the same rule the server applies", () => {
    // Imported rather than re-implemented, so the browser and the server cannot
    // disagree about what counts as a match.
    expect(source).toContain("confirmationMatches(typedName, confirming.name)");
    expect(source).toContain("disabled={!confirmed || deletePending}");
  });

  it("keeps the dialog outside the list, so the receipt survives the row", () => {
    // A useActionState owned by the row would unmount with it on success and
    // take the receipt with it — the admin would watch the row vanish and never
    // learn what was removed.
    const list = source.indexOf("{members.map(");
    const dialog = source.indexOf("<Dialog");
    expect(list).toBeGreaterThan(-1);
    expect(dialog).toBeGreaterThan(list);
  });

  it("does not show a finished delete's receipt when the dialog reopens", () => {
    // useActionState has no reset, so `deleteState.deleted` outlives the dialog.
    // Reading "did THIS dialog submit" is what keeps the receipt attached to the
    // right member.
    expect(source).toContain(
      "const receipt = submitted ? deleteState.deleted : undefined",
    );
    expect(source).toContain("setSubmitted(false)");
  });
});

describe("migration 0032 is shaped the way a definer function has to be", () => {
  const sql = read(MIGRATION);

  it("checks is_admin() before it does anything else", () => {
    const check = sql.indexOf("if not public.is_admin() then");
    const firstDelete = sql.indexOf("delete from public.visit_people");
    expect(check).toBeGreaterThan(-1);
    expect(firstDelete).toBeGreaterThan(check);
  });

  it("pins search_path and is definer", () => {
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
  });

  it("is revoked from public and anon and granted to authenticated", () => {
    expect(sql).toContain(
      "revoke all on function public.delete_member(uuid) from public;",
    );
    expect(sql).toContain(
      "revoke all on function public.delete_member(uuid) from anon;",
    );
    expect(sql).toContain(
      "grant execute on function public.delete_member(uuid) to authenticated;",
    );
  });

  it("raises FO027 for every case it refuses", () => {
    expect(sql).toContain("FO027");
    expect(sql).toContain("You cannot delete your own account.");
    expect(sql).toContain("That is the only admin account.");
  });

  it("deletes visits and plans before the institutes that restrict them", () => {
    const visits = sql.indexOf("delete from public.visits where member = p_member;");
    const plans = sql.indexOf(
      "delete from public.daily_plans where member = p_member;",
    );
    const institutes = sql.indexOf(
      "delete from public.institutes where registered_by = p_member;",
    );
    const profile = sql.indexOf("delete from public.profiles where id = p_member;");
    expect(visits).toBeGreaterThan(-1);
    expect(plans).toBeGreaterThan(-1);
    expect(institutes).toBeGreaterThan(visits);
    expect(institutes).toBeGreaterThan(plans);
    // The profile goes last, before the auth user the action deletes afterwards.
    expect(profile).toBeGreaterThan(institutes);
  });

  it("guards the weekly_targets archive, which may exist under either name", () => {
    // 0013 renamed rather than dropped, so which one is present depends on how
    // far a given database has been migrated. scripts/tables.mjs lists both for
    // the same reason.
    expect(sql).toContain("to_regclass('public.weekly_targets')");
    expect(sql).toContain("to_regclass('public.weekly_targets_pre_0013')");
  });

  it("never touches materials, auth.users or storage", () => {
    expect(sql).not.toContain("delete from public.materials");
    expect(sql).not.toContain("delete from auth.users");
    expect(sql).not.toContain("delete from storage.objects");
  });

  it("asserts what it installed", () => {
    expect(sql).toContain("0032 did not apply cleanly");
    expect(sql).toContain("is not SECURITY DEFINER");
    expect(sql).toContain("does not check is_admin()");
    expect(sql).toContain("does not raise FO027");
  });
});
