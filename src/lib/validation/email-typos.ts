/**
 * "Did you mean gmail.com?" — the check `z.email()` cannot make.
 *
 * WHY THIS EXISTS AT ALL. An admin created a rep as `…@gamil.con` and the app
 * took it, which read like missing validation and was not: `gamil.con` is a
 * perfectly well-formed address. It has a local part, an `@`, a domain with two
 * labels and a plausible TLD. Every format rule in the schema passes it, and so
 * would every stricter one — there is no regex that separates a real domain
 * from a misspelt one, because the difference is not in the shape.
 *
 * What it cost: a dead address means the rep can never reset their own
 * password, and anything the app sends them later fails silently. Nobody finds
 * out at the moment of the mistake, which is the moment it is free to fix.
 *
 * A WARNING, NEVER A BLOCK. This file's judgement is a guess about intent, and
 * a guess must not be able to refuse a correct address. Odd domains are real —
 * a school on its own vanity domain, a consultant on a country TLD — so the
 * form shows what it suspects, offers the correction as one tap, and lets the
 * admin go ahead unchanged if they know better. The schema is what refuses
 * things; this only ever asks.
 *
 * CLIENT-SIDE ON PURPOSE, and safe to be. A warning that can be bypassed by
 * anyone who wants to bypass it loses nothing by being bypassable, because
 * proceeding is a supported answer. The real guard is `newMemberSchema`, which
 * runs on the server in `createMember()` where a forged form cannot reach past
 * it. Keeping this pure — no React, no imports — is what lets the test suite
 * hold the table below honest.
 */

/**
 * Misspelt second-level domains, and what they were meant to be.
 *
 * Deliberately a TABLE rather than an edit-distance function. Levenshtein would
 * catch more typos and would also start "correcting" real domains that happen
 * to sit one letter from a provider — and a false suggestion on a correct
 * address trains an admin to dismiss the warning without reading it, which
 * costs more than the typos it would catch. Everything here is a string
 * somebody actually mistypes.
 */
const DOMAIN_TYPOS: Readonly<Record<string, string>> = {
  gamil: "gmail",
  gmial: "gmail",
  gmai: "gmail",
  gmal: "gmail",
  gnail: "gmail",
  gmaill: "gmail",
  yahooo: "yahoo",
  yaho: "yahoo",
  hotmial: "hotmail",
  hotmai: "hotmail",
  outlok: "outlook",
  outloook: "outlook",
};

/**
 * The providers whose TLD is worth second-guessing.
 *
 * `.co` is a real TLD and `acme.co` is a real company, so a bare "co → com"
 * rule would flag correct addresses all day. But `gmail.co` is not a mail
 * provider anybody has, so the TLD is only corrected once the second level is
 * known to be one of these — which is what makes the rule safe.
 */
const KNOWN_PROVIDERS: ReadonlySet<string> = new Set([
  "gmail",
  "yahoo",
  "hotmail",
  "outlook",
]);

/** Misspelt or truncated TLDs, applied ONLY under a known provider. */
const TLD_TYPOS: Readonly<Record<string, string>> = {
  con: "com",
  co: "com",
  cm: "com",
  cmo: "com",
  ocm: "com",
  comm: "com",
  cpm: "com",
  vom: "com",
};

/**
 * The corrected address, or null when there is nothing to suggest.
 *
 * Returns the WHOLE address rather than the domain so the caller has something
 * it can put straight into the field — the admin taps once instead of editing a
 * string by hand, which is the difference between a warning that gets acted on
 * and one that gets dismissed.
 *
 * Null for anything this cannot improve, which is nearly everything: an address
 * it cannot parse, a domain with a number of labels it does not reason about, a
 * correctly spelt provider, and every domain not in the tables above. Silence is
 * the common case and the right one.
 */
export function suggestEmailCorrection(raw: string): string | null {
  const email = raw.trim().toLowerCase();

  // One "@", with something either side. Anything else is the schema's problem,
  // not this file's — and guessing at a malformed address would mean suggesting
  // a correction the form is about to reject anyway.
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const labels = domain.split(".");

  /*
   * TWO LABELS ONLY, and this is the line that keeps `yahoo.co.uk` safe.
   *
   * Split on dots, that domain is ["yahoo", "co", "uk"] — three labels, so the
   * TLD rule below never sees its "co" and never turns a perfectly good British
   * address into `yahoo.com`. The same restraint spares every
   * `something.edu.in`, which is the shape this client's own university uses.
   */
  if (labels.length !== 2) return null;

  const [sld, tld] = labels;
  const fixedSld = DOMAIN_TYPOS[sld] ?? sld;

  // The TLD is only second-guessed once the second level is a provider we
  // recognise — see KNOWN_PROVIDERS. `acme.co` is left alone; `gmail.co` is not.
  const fixedTld = KNOWN_PROVIDERS.has(fixedSld) ? (TLD_TYPOS[tld] ?? tld) : tld;

  const fixed = `${fixedSld}.${fixedTld}`;
  if (fixed === domain) return null;

  return `${local}@${fixed}`;
}

/** Just the suggested domain, for a message that names it. */
export function suggestedDomainOf(suggestion: string): string {
  return suggestion.slice(suggestion.lastIndexOf("@") + 1);
}
