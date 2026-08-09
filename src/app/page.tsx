import { getSettings } from '@/lib/settings';
import ClosedNotice from './_components/ClosedNotice';
import RegistrationForm from './_components/RegistrationForm';

// Settings are read per request. Without this Next would statically prerender
// the page at build time and the admin toggle would appear to do nothing until
// the next deploy — which is the exact problem this replaced.
export const dynamic = 'force-dynamic';

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

  // The charged amount still comes from ORDER_AMOUNT, unchanged from 2025. The
  // prices in `settings` are displayed in the admin panel but are not yet
  // authoritative — phase 2 introduces resolvePrice() and the 3-SKU model, and
  // that is the point at which the panel's numbers start driving the charge.
  const orderAmount = Number(process.env.ORDER_AMOUNT ?? '100');
  const priceLabel = `₹${Number.isFinite(orderAmount) ? orderAmount : 100}`;

  // Fresh literals rather than passing `settings.*` sub-objects straight through.
  // In `next dev` the whole settings row shows up in the RSC payload; a production
  // build does not include it (verified), so this is defensive rather than a fix
  // for a live leak. Worth keeping as the table grows: only what a prop names
  // should ever be able to reach the browser.
  return (
    <RegistrationForm
      eventConfig={{ ...settings.eventConfig }}
      fieldOptions={{ ...settings.fieldOptions }}
      priceLabel={priceLabel}
      cashfreeMode={process.env.CASHFREE_ENV === 'PRODUCTION' ? 'production' : 'sandbox'}
      merchantName={process.env.NEXT_PUBLIC_MERCHANT_NAME || 'ACM MPSTME'}
      merchantEmail={settings.eventConfig.contactEmail}
    />
  );
}
