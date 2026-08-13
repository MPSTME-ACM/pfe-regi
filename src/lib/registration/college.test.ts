import { describe, it, expect } from 'vitest';
import { OTHER_COLLEGE, displayCollege } from './college';

/**
 * `displayCollege` decides what the Google Sheet's `College` cell says, which is
 * the column the committee actually reads. It is pure, so it is cheap to pin
 * down — and getting it wrong is silent: the sheet would just say "Other".
 */
describe('displayCollege', () => {
  it('returns a known college unchanged', () => {
    expect(displayCollege('NMIMS MPSTME', null)).toBe('NMIMS MPSTME');
  });

  it('resolves Other to the typed name', () => {
    expect(displayCollege(OTHER_COLLEGE, 'VJTI Mumbai')).toBe('VJTI Mumbai');
  });

  it('trims the typed name', () => {
    expect(displayCollege(OTHER_COLLEGE, '  VJTI Mumbai  ')).toBe('VJTI Mumbai');
  });

  it('falls back to Other when no name was captured', () => {
    // Rows created before the column existed. Showing the literal 'Other' is
    // honest; showing an empty cell would read as missing data.
    expect(displayCollege(OTHER_COLLEGE, null)).toBe(OTHER_COLLEGE);
    expect(displayCollege(OTHER_COLLEGE, '')).toBe(OTHER_COLLEGE);
    expect(displayCollege(OTHER_COLLEGE, '   ')).toBe(OTHER_COLLEGE);
  });

  it('ignores a stray name on a known college', () => {
    // The API strips this, but the sheet must not depend on that: a row written
    // before the guard existed would otherwise relabel a NMIMS student.
    expect(displayCollege('NMIMS MPSTME', 'Should Be Ignored')).toBe('NMIMS MPSTME');
  });

  it('leaves existing sheet rows unchanged, so a sync does not churn', () => {
    // Every row in production is a known college with a null other-name. If this
    // returned anything different the next sync would rewrite the whole sheet.
    expect(displayCollege('NMIMS MPSTME', null)).toBe('NMIMS MPSTME');
    expect(displayCollege('', null)).toBe('');
  });
});
