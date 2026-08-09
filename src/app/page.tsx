import { getSettings, formatPaise } from '@/lib/settings';
import { trackAvailability } from '@/lib/registration/capacity';
import ClosedNotice from './_components/ClosedNotice';
import RegistrationForm from './_components/RegistrationForm';
import type { TrackOption } from './_components/registrationTypes';

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

  // Fresh literals rather than passing `settings.*` sub-objects straight through.
  // In `next dev` the whole settings row shows up in the RSC payload; a production
  // build does not include it (verified), so this is defensive rather than a fix
  // for a live leak. Worth keeping as the table grows: only what a prop names
  // should ever be able to reach the browser.
  return (
    <RegistrationForm
      eventConfig={{ ...settings.eventConfig }}
      fieldOptions={{ ...settings.fieldOptions }}
      tracks={tracks}
      priceLabels={priceLabels}
      cashfreeMode={process.env.CASHFREE_ENV === 'PRODUCTION' ? 'production' : 'sandbox'}
      merchantName={process.env.NEXT_PUBLIC_MERCHANT_NAME || 'ACM MPSTME'}
      merchantEmail={settings.eventConfig.contactEmail}
    />
  );
}
