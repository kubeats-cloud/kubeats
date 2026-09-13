/**
 * What a form says when something is still missing.
 *
 * WHY IT IS QUIET
 *
 * Every form used to answer a failed submit with the same thing: a filled
 * `bg-danger-subtle` block at `text-sm`, and under it a bulleted list of every
 * field error. On a phone that is a red panel most of a thumb high, and a rep
 * who forgot one dropdown got the same alarm as a rep who broke something. The
 * volume was wrong for what had actually happened, which is that a form is not
 * finished yet.
 *
 * So this is a thin rule and small text instead of a filled panel. It still
 * says exactly what to fix, field by field, because a calmer notice that has
 * stopped being specific is worse than a loud one. Only the alarm goes; the
 * information stays.
 *
 * `role="alert"` STAYS. It is what makes a screen reader announce the thing at
 * all, and it has nothing to do with how loud the colours are.
 *
 * ONE COMPONENT, because there were eight copies of that block and they had
 * already drifted: some listed the field errors, some dropped them on the
 * floor, and the two that listed them labelled the fields differently. A form
 * that silently swallows an error on a field it has no inline slot for is the
 * bug this shape was built to fix in the first place, so it is worth having
 * exactly one of.
 */

/**
 * The wording a form uses when the answer is "not quite finished".
 *
 * Defined in visit-form-state.ts and re-exported here. The direction matters:
 * the server actions need these too, and a "use server" module must not import
 * a component file.
 */
export { CHECK_FIELD, CHECK_FIELDS, CHECK_NUMBERS } from "@/lib/visit-form-state";

/** "student_response" reads as "student response" when nothing better is known. */
const deUnderscore = (key: string) => key.replace(/_/g, " ");

export function FormNotice({
  message,
  fieldErrors,
  labelFor = deUnderscore,
}: {
  message: string;
  /** Every field error, including ones with no inline slot on the form. */
  fieldErrors?: Record<string, string>;
  /**
   * How to name a field to a person. Passed in rather than imported, so a form
   * that has no use for the closing report's label table does not pull it into
   * its bundle.
   */
  labelFor?: (key: string) => string;
}) {
  const entries = Object.entries(fieldErrors ?? {});

  return (
    <div role="alert" className="border-danger space-y-1 border-l-2 py-0.5 pl-3">
      <p className="text-sm">{message}</p>
      {entries.length > 0 && (
        <ul className="text-muted-foreground space-y-0.5 text-xs">
          {entries.map(([field, detail]) => (
            <li key={field}>
              <span className="text-foreground">{labelFor(field)}</span>: {detail}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
