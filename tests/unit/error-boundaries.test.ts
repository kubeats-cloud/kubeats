import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The three error boundaries, and the one Next requirement inside them.
 *
 * WHY THIS EXISTS. A boundary is the only file in the app whose value is
 * invisible until something has already gone wrong, which makes it the easiest
 * thing in the tree to delete, consolidate or "tidy" without anybody noticing.
 * Nothing renders it in development, no screen links to it, and removing one
 * breaks no test that was not written for it. The app shipped without a root
 * boundary at all for exactly that reason — the gap was found by a user meeting
 * Next's unstyled default page after logging in.
 *
 * THE THREE ARE NOT INTERCHANGEABLE, and that is the thing most likely to be
 * got wrong by someone reducing them to one:
 *
 *   (app)/error.tsx     the signed-in screens. Does NOT catch a throw in the
 *                       (app) LAYOUT's own JSX — that goes to the parent.
 *   app/error.tsx       the parent. /login, /verify, /privacy, and the (app)
 *                       layout's own failures.
 *   app/global-error.tsx the root layout itself. Nothing is left above it.
 *
 * WHAT CANNOT BE TESTED HERE is that they RENDER correctly — that needs a DOM,
 * which this project deliberately does not have (vitest.config.mts;
 * log-visit-form.test.ts explains why adding one is an architectural decision
 * rather than a side effect). So this asserts the properties that are checkable
 * from Node and that are the ones actually at risk: that each file is there,
 * that the global one meets Next's structural requirement, and that none of
 * them leaks an error message to a user.
 */

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), "utf8");

/**
 * The file with its comments taken out.
 *
 * NOT OPTIONAL HERE, and it was found the hard way: this file's first draft
 * asserted `<html>` against the raw source and PASSED against a global-error
 * deliberately broken to prove it would fail. The tags it matched were the ones
 * in the prose above the component, explaining that it renders its own
 * document. The check could not tell the requirement from the paragraph
 * describing it — the third time that trap has been hit in this repo, after
 * log-visit-form.test.ts and sign-out-guard.test.ts.
 *
 * Strings are left alone; nothing asserted here turns on one.
 */
const codeOnly = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const exists = (relative: string) =>
  existsSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)));

const APP = "src/app/(app)/error.tsx";
const ROOT = "src/app/error.tsx";
const GLOBAL = "src/app/global-error.tsx";

describe("every error boundary is still in place", () => {
  it.each([
    [APP, "the signed-in screens"],
    [ROOT, "/login, /verify, /privacy, and the (app) layout's own JSX"],
    [GLOBAL, "the root layout itself"],
  ])("%s covers %s", (file) => {
    expect(exists(file), `${file} is missing — that segment has no boundary`).toBe(
      true,
    );
  });

  it.each([APP, ROOT, GLOBAL])("%s is a client component", (file) => {
    // Next requires it, and a boundary that is not one does not compile as a
    // boundary at all — it becomes an ordinary module nothing ever renders.
    expect(read(file).startsWith('"use client";')).toBe(true);
  });
});

/**
 * The structural requirement, which is the whole reason this file was asked for.
 *
 * `global-error.tsx` REPLACES the root layout — the thing that has just thrown —
 * so there is no document shell left to render into. Without its own <html> and
 * <body> the page has no structure at all, which is a worse outcome than the one
 * being handled. It reads like boilerplate that a linter or a tidy-up would
 * happily remove, so it is pinned here.
 */
describe("global-error renders its own document", () => {
  const source = read(GLOBAL);

  it("renders <html>", () => {
    expect(codeOnly(source)).toMatch(/<html[\s>]/);
  });

  it("renders <body>", () => {
    expect(codeOnly(source)).toMatch(/<body[\s>]/);
  });

  it("imports globals.css itself", () => {
    // The root layout is normally what pulls this in, and the root layout is
    // precisely what is not running. Without it the tokens ErrorState is built
    // from do not exist and the branded screen degrades to unstyled black on
    // white — the exact failure this boundary was added to prevent.
    expect(source).toContain('import "./globals.css"');
  });

  it("is the only boundary that needs to, so the other two do not", () => {
    // Stated as an absence on purpose: copying the <html> wrapper into a
    // boundary that renders INSIDE the root layout would nest one document
    // inside another.
    for (const file of [APP, ROOT]) {
      expect(codeOnly(read(file)), file).not.toMatch(/<html[\s>]/);
    }
  });
});

/**
 * What a boundary is allowed to tell the person looking at it.
 *
 * Next strips server error messages in production anyway. These render the
 * generic sentence regardless, so the rule holds in development too and nobody
 * builds against a screen that says more than the real one will.
 */
describe("no boundary leaks an error to the user", () => {
  it.each([APP, ROOT, GLOBAL])("%s renders the generic message", (file) => {
    expect(read(file)).toContain("message={GENERIC_ERROR}");
  });

  it.each([APP, ROOT, GLOBAL])("%s never renders the error itself", (file) => {
    const source = read(file);
    // `error.message` appears in all three as a LOGGING fallback beside the
    // digest, which is fine and stays on the server. What must never appear is
    // it being interpolated into the markup.
    expect(source).not.toContain("{error.message}");
    expect(source).not.toContain("{error.stack}");
    expect(source).not.toContain("message={error");
  });

  it.each([APP, ROOT, GLOBAL])("%s logs the digest, so a report can be traced", (file) => {
    // The digest is the only handle tying what a user saw to a line in the
    // server log. Losing it makes every crash report unmatchable.
    expect(read(file)).toContain("error.digest");
    expect(read(file)).toContain("console.error(");
  });
});
