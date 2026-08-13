/**
 * The one string both the form and the API have to agree on.
 *
 * Deliberately dependency-free — no `@/lib/db`, no settings import. This is
 * imported by `RegistrationForm`, which is a client component, and anything
 * reaching the database from here would drag drizzle into the browser bundle.
 *
 * It is not read from `settings.fieldOptions.colleges` even though 'Other'
 * appears in that list. The list is admin-editable wording; this is a sentinel
 * that control flow branches on. If an admin renamed the option, a settings-fed
 * constant would silently stop matching and the "which college?" field would
 * never render again — with no error anywhere.
 */
export const OTHER_COLLEGE = 'Other';

/**
 * What to display for a registration's college.
 *
 * `college` holds the literal 'Other' for anyone outside the known list, with
 * the real name in `collegeOther`. Reports and the spreadsheet want the name;
 * the categorical split wants the raw column.
 */
export function displayCollege(
  college: string,
  collegeOther: string | null | undefined,
): string {
  const other = collegeOther?.trim();
  return college === OTHER_COLLEGE && other ? other : college;
}
