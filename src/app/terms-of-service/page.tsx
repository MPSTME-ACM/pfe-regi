import ProgramHeader from '@/app/_components/ProgramHeader';
import PolicyLinks from '@/app/_components/PolicyLinks';
import BackToRegistration from '@/app/_components/BackToRegistration';
import { getSettings } from '@/lib/settings';

// See about-us: force-dynamic or the build bakes the fallback date.
export const dynamic = 'force-dynamic';

export default async function TermsOfServicePage() {
  const { eventConfig } = await getSettings();

  return (
    <main className="min-h-screen text-white font-sans flex flex-col items-center justify-center p-4 sm:p-6 md:p-8">
      <div className="mb-4 w-full max-w-3xl">
        <BackToRegistration />
      </div>
      <div className="w-full max-w-3xl bg-black/30 backdrop-blur-md rounded-2xl border border-white/10 p-8 sm:p-10 md:p-12">
        <ProgramHeader dateRange={eventConfig.dateRange} />

        <div className="text-center mt-10 mb-8">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-accent-soft mb-4 leading-tight">
            Terms of Service
          </h1>
        </div>

        <div className="max-w-prose mx-auto space-y-6 text-gray-300 leading-relaxed">
          <p>Welcome to the PFE - Programming For Everyone workshop hosted by ACM MPSTME. By registering for this event, you agree to comply with and be bound by the following terms and conditions of use. Please review the following terms carefully.</p>

          <div>
            <h2 className="text-2xl font-bold text-accent-soft mb-2">1. Registration and Payment</h2>
            <p>All registrations must be completed via the official registration form. The ticket price of ₹100 is non-negotiable and must be paid in full to confirm your participation. All payments are processed through our secure payment gateway, Cashfree Payments.</p>
          </div>

          <div>
            <h2 className="text-2xl font-bold text-accent-soft mb-2">2. Code of Conduct</h2>
            <p>All attendees are expected to conduct themselves in a professional and respectful manner. Harassment, discrimination, or any disruptive behavior will not be tolerated and may result in immediate removal from the workshop without a refund.</p>
          </div>

          <div>
            <h2 className="text-2xl font-bold text-accent-soft mb-2">3. Content and Materials</h2>
            <p>All workshop materials, including notes and code, are provided for personal educational use only. Redistribution or commercial use of these materials without explicit permission from ACM MPSTME is strictly prohibited.</p>
          </div>

          <div>
            <h2 className="text-2xl font-bold text-accent-soft mb-2">4. Liability</h2>
            <p>ACM MPSTME is not responsible for any loss, injury, or damage to personal property. By attending, you agree to release ACM MPSTME from any and all claims and liabilities.</p>
          </div>

          <div>
            <h2 className="text-2xl font-bold text-accent-soft mb-2">5. Shipping and Delivery</h2>
            {/* Dates and venue come from settings so this paragraph cannot drift
                from the header above it, or from the confirmation email. The
                WhatsApp group's creation date was previously a fixed calendar
                date; it is relative now, because nothing in settings records it
                and an invented date in a policy is worse than no date. */}
            <p>The PFE Workshop will be conducted <strong>offline</strong> at <strong>{eventConfig.venue}</strong> on <strong>{eventConfig.dateRange}</strong>. As this is an in-person event, there are <strong>no physical products</strong> being shipped. The exact classroom venue and event logistics will be communicated through a dedicated WhatsApp group, created in the days before the program begins. There are no shipping or delivery charges applicable.</p>
          </div>
        </div>

        <PolicyLinks note="We appreciate your interest in our workshop." />
      </div>
    </main>
  );
}