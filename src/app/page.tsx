import { getSettings, formatPaise } from '@/lib/settings';
import { trackAvailability } from '@/lib/registration/capacity';
import ClosedNotice from './_components/ClosedNotice';
import RegistrationForm from './_components/RegistrationForm';
import type { TrackOption } from './_components/registrationTypes';
import { findReferrer, referralCookieCode } from '@/lib/registration/referral';

// Settings are read per request. Without this Next would statically prerender
// the page at build time and the admin toggle would appear to do nothing until
// the next deploy — which is the exact problem this replaced.
export const dynamic = 'force-dynamic';

/**
 * Availability for the form's track selects.
 *
 * Never throws, for the same reason `getSettings()` never does: a DB blip on the
 * render path must not 500 the whole page. An empty list degrades to a form
 * whose selects are empty, and the client refresh from /api/domain-count then
 * fills them in on its own.
 */
async function safeTrackAvailability(): Promise<TrackOption[]> {
  try {
    return await trackAvailability();
  } catch (error) {
    console.error('[page] track availability read failed:', error);
    return [];
  }
}

/**
 * The referrer name held in the cookie, or null.
 *
 * Never throws, for the same reason `safeTrackAvailability` does not: this is
 * decoration on the render path, and a DB blip must not take the form down to
 * avoid printing one line of text.
 */
async function safeReferredBy(): Promise<string | null> {
  try {
    const code = await referralCookieCode();
    if (!code) return null;
    return (await findReferrer(code))?.name ?? null;
  } catch (error) {
    console.error('[page] referrer read failed:', error);
    return null;
  }
}

export default async function Home() {
  const settings = await getSettings();

  if (!settings.registrationOpen) {
    return (
      <ClosedNotice
        title={settings.closedTitle}
        body={settings.closedBody}
        eventConfig={settings.eventConfig}
      />
    );
  }

  // Phase 2 landed: api/create-order runs resolvePrice() over these same three
  // settings columns, so the labels below are the amounts that will actually be
  // charged rather than the old ORDER_AMOUNT env var. Formatted here so the
  // client component never has to import `@/lib/settings` — that module reaches
  // `@/lib/db` and would drag drizzle into the browser bundle.
  const priceLabels = {
    capstone: formatPaise(settings.priceCapstone),
    single: formatPaise(settings.priceSingle),
    bundle: formatPaise(settings.priceBundle),
  };

  const tracks = await safeTrackAvailability();

  // Who the /r/<CODE> cookie credits, if anyone. Resolved here so the form can
  // say so out loud — an attribution the buyer cannot see is one they cannot
  // correct. Read-only on purpose: the cookie is what checkout actually uses,
  // and an editable copy of it would let the two disagree.
  const referredBy = await safeReferredBy();

  // Fresh literals rather than passing `settings.*` sub-objects straight through.
  // In `next dev` the whole settings row shows up in the RSC payload; a production
  // build does not include it (verified), so this is defensive rather than a fix
  // for a live leak. Worth keeping as the table grows: only what a prop names
  // should ever be able to reach the browser.
  return (
    <RegistrationForm
      eventConfig={{ ...settings.eventConfig }}
      fieldOptions={{ ...settings.fieldOptions }}
      fieldLabels={{ ...settings.fieldLabels }}
      referredBy={referredBy}
      tracks={tracks}
      priceLabels={priceLabels}
      cashfreeMode={process.env.CASHFREE_ENV === 'PRODUCTION' ? 'production' : 'sandbox'}
      merchantName={process.env.NEXT_PUBLIC_MERCHANT_NAME || 'ACM MPSTME'}
      merchantEmail={settings.eventConfig.contactEmail}
    />
  );
}
