/**
 * The asterisk beside a required field's label.
 *
 * The form used to say what was required in prose — a line under each section
 * explaining why it was being asked and whether it mattered. The client asked
 * for that prose gone, which leaves the asterisk carrying the whole message, so
 * it is a component rather than a literal repeated at nine call sites.
 *
 * `aria-hidden`, because an asterisk is not a word. Screen readers learn the
 * same fact from `aria-required` on the input itself, which every required
 * field on this form sets; announcing "star" as well would be saying it twice
 * in a voice that cannot skim.
 */
export function RequiredMark() {
  return (
    <span aria-hidden className="text-danger">
      *
    </span>
  );
}
