import { describe, expect, it } from "vitest";
import {
  suggestEmailCorrection,
  suggestedDomainOf,
} from "@/lib/validation/email-typos";
import { newMemberSchema } from "@/lib/validation/admin";

/**
 * The two halves of the email fix, and the line between them.
 *
 * A rep was created on `…@gamil.con` and the app took it. The instinct is that
 * validation was missing; it was not. `z.email()` refuses everything malformed
 * and always did — the first block below pins that, so nobody "fixes" it again
 * by loosening or duplicating it. What no schema can refuse is a well-formed
 * address pointing at a domain nobody owns, which is the second block.
 *
 * The suggester's danger is the OPPOSITE of the schema's: a schema that is too
 * loose lets a typo through once, while a suggester that is too eager cries
 * wolf on correct addresses until admins stop reading it. So the "leaves alone"
 * cases below matter more than the "catches" ones, and outnumber them.
 */

describe("the schema still refuses malformed addresses", () => {
  const parse = (email: string) =>
    newMemberSchema.safeParse({
      name: "A Rep",
      email,
      password: "a-long-enough-password",
      role: "rep",
      campus_id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    }).success;

  it("rejects the shapes that are not addresses at all", () => {
    for (const bad of [
      "no-at-sign",
      "a@b", // no dot in the domain
      "a@b.c", // one-character TLD
      "a b@example.com", // space
      "a@.com",
      "a@b..com",
      "a@-b.com",
      "a@example.com.",
      "root@localhost",
      "a@@b.com",
      ".a@b.com",
      "a.@b.com",
      "",
    ]) {
      expect(parse(bad), bad).toBe(false);
    }
  });

  it("accepts the ordinary ones, including the university's own shape", () => {
    for (const good of [
      "sumit@gmail.com",
      "a@b.co",
      "shubham.p@karnavatiuniversity.edu.in",
      "first.last+tag@sub.domain.example.org",
    ]) {
      expect(parse(good), good).toBe(true);
    }
  });

  /*
   * THE CASE THAT STARTED THIS, asserted as a PASS rather than a failure.
   *
   * It has to stay accepted by the schema: the suggester warns about it, and a
   * warning the schema has already refused is a warning nobody ever sees. This
   * test is what stops someone "fixing" the original bug in the wrong layer.
   */
  it("still accepts a well-formed address with a misspelt domain", () => {
    expect(parse("sumit700466@gamil.con")).toBe(true);
  });

  it("refuses an absurdly long address", () => {
    expect(parse(`${"a".repeat(250)}@example.com`)).toBe(false);
  });
});

describe("the typo suggester catches what the schema cannot", () => {
  it("corrects the address that caused this", () => {
    expect(suggestEmailCorrection("sumit700466@gamil.con")).toBe(
      "sumit700466@gmail.com",
    );
  });

  it("covers the misspellings the client named", () => {
    const cases: Array<[string, string]> = [
      ["a@gamil.com", "a@gmail.com"],
      ["a@gmial.com", "a@gmail.com"],
      ["a@gmai.com", "a@gmail.com"],
      ["a@gmail.con", "a@gmail.com"],
      ["a@gmail.co", "a@gmail.com"],
      ["a@yahooo.com", "a@yahoo.com"],
      ["a@yaho.com", "a@yahoo.com"],
      ["a@hotmial.com", "a@hotmail.com"],
      ["a@hotmai.com", "a@hotmail.com"],
      ["a@outlok.com", "a@outlook.com"],
    ];
    for (const [typed, meant] of cases) {
      expect(suggestEmailCorrection(typed), typed).toBe(meant);
    }
  });

  it("normalises case and whitespace on the way", () => {
    expect(suggestEmailCorrection("  Sumit@GAMIL.CON  ")).toBe(
      "sumit@gmail.com",
    );
  });

  it("names the domain for the message", () => {
    expect(suggestedDomainOf("sumit@gmail.com")).toBe("gmail.com");
  });
});

describe("the typo suggester leaves correct addresses alone", () => {
  it("says nothing about a correctly spelt provider", () => {
    for (const good of [
      "a@gmail.com",
      "a@yahoo.com",
      "a@hotmail.com",
      "a@outlook.com",
    ]) {
      expect(suggestEmailCorrection(good), good).toBeNull();
    }
  });

  /*
   * The rule that earns the "two labels only" guard. `.co` is a real TLD, and
   * both of these are real addresses — one of them is this client's own domain
   * shape. Correcting either would be worse than the typo it was meant to catch.
   */
  it("does not touch a multi-label domain", () => {
    for (const good of [
      "a@yahoo.co.uk",
      "a@gmail.co.uk",
      "shubham.p@karnavatiuniversity.edu.in",
      "a@company.co.in",
    ]) {
      expect(suggestEmailCorrection(good), good).toBeNull();
    }
  });

  it("does not correct a .co that is nobody's typo", () => {
    // `acme.co` is a company; only a KNOWN provider's TLD is second-guessed.
    for (const good of ["a@acme.co", "a@monzo.co", "a@unknown.con"]) {
      expect(suggestEmailCorrection(good), good).toBeNull();
    }
  });

  it("says nothing about an address it cannot parse", () => {
    for (const junk of ["", "no-at", "@example.com", "a@", "   "]) {
      expect(suggestEmailCorrection(junk), junk).toBeNull();
    }
  });

  it("never suggests a change that is not one", () => {
    // Belt and braces on the identity case: a suggestion equal to the input
    // would render as "Did you mean gmail.com?" under gmail.com.
    for (const address of ["a@gmail.com", "a@example.org", "a@b.co"]) {
      const suggestion = suggestEmailCorrection(address);
      expect(suggestion === address, address).toBe(false);
    }
  });
});
