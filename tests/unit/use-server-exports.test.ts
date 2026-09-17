import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A "use server" file may export async functions, and nothing else.
 *
 * WHAT THIS COSTS WHEN IT IS BROKEN — and it has now been broken twice.
 *
 * Next registers every RUNTIME export of a "use server" module as a server
 * function reference. The build says so out loud: `server-reference-manifest.json`
 * listed `exportedName: "SIGN_OUT_READY"` beside the real actions. So a client
 * component importing that constant did not receive `{ blockedBy: null }`; it
 * received a callable reference to a server function, and handing that to
 * `useActionState` as the initial state threw during render.
 *
 * It threw on EVERY AUTHENTICATED PAGE, because the importer was the sign-out
 * button and the sign-out button is in the top bar, which is part of the `(app)`
 * layout. And it surfaced as Next's GLOBAL error page rather than this app's own
 * ErrorState, because an error raised inside a layout's own JSX is not caught by
 * that segment's `error.tsx` — it goes past it to the root, where the only
 * boundary left is the global one. Users could log in and never reach a screen.
 * `wrangler tail` showed nothing, and `/api/health` stayed `{"ok":true}` because
 * its anonymous branch renders no layout and touches no database.
 *
 * WHY A TEST AND NOT A COMMENT. There already was a comment — `admin-form-state.ts`
 * has carried this warning since Phase 4, when the same mistake cost an
 * afternoon. It did not stop the mistake being made again in `auth-actions.ts`,
 * and the sweep that followed found a THIRD instance sitting in `mfa-actions.ts`
 * that nobody had hit yet, on two screens nobody had reached. A rule this
 * expensive and this invisible needs something that fails, not something that
 * explains.
 *
 * WHAT IS ALLOWED. `export async function` — the actions themselves. Types and
 * interfaces are erased before any of this happens and are harmless, but they
 * are kept out anyway so a state shape and its empty value cannot drift into
 * different files.
 */

const ROOT = fileURLToPath(new URL("../../src", import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

/** Every module that opens with the "use server" directive. */
const serverActionModules = walk(ROOT).filter((file) => {
  const source = readFileSync(file, "utf8");
  return /^\s*["']use server["'];/.test(source);
});

const rel = (file: string) => file.slice(ROOT.length + 1);

describe("every 'use server' module exports only async functions", () => {
  it("finds the action modules at all, so a green run means something", () => {
    // A refactor that moved or renamed them would otherwise leave this suite
    // passing over an empty list.
    expect(serverActionModules.length).toBeGreaterThan(5);
    expect(serverActionModules.map(rel)).toContain("lib/auth-actions.ts");
    expect(serverActionModules.map(rel)).toContain("lib/mfa-actions.ts");
  });

  it.each(serverActionModules.map(rel))("%s exports no runtime value", (file) => {
    const source = readFileSync(`${ROOT}/${file}`, "utf8");

    const offenders = source
      .split("\n")
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => /^export\b/.test(line))
      // `export async function` is the only runtime export allowed. Types are
      // erased before Next ever sees them.
      .filter(([, line]) => !/^export async function /.test(line))
      .filter(([, line]) => !/^export (interface|type) /.test(line))
      .map(([n, line]) => `${file}:${n}  ${line.trim()}`);

    expect(
      offenders,
      "a constant here becomes a server function reference — see sign-out-state.ts",
    ).toEqual([]);
  });
});

/**
 * The two constants this rule was learned on, pinned where they belong.
 *
 * Named explicitly rather than left to the sweep above, because the sweep only
 * proves they are not in the wrong place — these prove they are still in the
 * right one, and still exported, so a "tidy-up" that folded them back cannot
 * pass by deleting them instead.
 */
describe("the state constants live in plain modules", () => {
  it.each([
    ["lib/sign-out-state.ts", "SIGN_OUT_READY"],
    ["lib/mfa-state.ts", "EMPTY_MFA_STATE"],
    ["lib/admin-form-state.ts", "EMPTY_ADMIN_STATE"],
    ["lib/visit-form-state.ts", "EMPTY_STATE"],
  ])("%s holds %s and is not a 'use server' file", (file, name) => {
    const source = readFileSync(`${ROOT}/${file}`, "utf8");
    expect(source).toContain(`export const ${name}`);
    expect(source).not.toMatch(/^\s*["']use server["'];/);
  });
});
