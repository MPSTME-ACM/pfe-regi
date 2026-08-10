import ProgramHeader from '@/app/_components/ProgramHeader';
import PolicyLinks from '@/app/_components/PolicyLinks';
import BackToRegistration from '@/app/_components/BackToRegistration';
import { getSettings } from '@/lib/settings';

// See about-us: force-dynamic or the build bakes the fallback date.
export const dynamic = 'force-dynamic';

export default async function CancellationPolicyPage() {
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
            Our Policies
          </h1>
        </div>

        <div className="max-w-prose mx-auto space-y-6 text-gray-300 leading-relaxed">
          <div>
            <h2 className="text-2xl font-bold text-accent-soft mb-2">Cancellation & Refund Policy</h2>
            <p>Please note that all registration fees for the PFE Workshop are <strong>non-refundable</strong>. Once a payment is made, we cannot provide any refunds or cancellations for any reason. This policy helps us manage event logistics and commitments effectively. We thank you for your understanding.</p>
          </div>

          <div>
            <h2 className="text-2xl font-bold text-accent-soft mb-2">Privacy Policy</h2>
            <p>We respect and are committed to protecting your privacy. We will not sell, publish, or rent your personal data to any third party without your consent. By using our site, you agree to the terms of this policy.</p>

            <h3 className="text-xl font-semibold text-accent-soft mt-4 mb-2">Information We Collect</h3>
            <p>We collect personal information such as your name, email, and contact details to process your registration and provide you with the best possible service. You acknowledge that you are disclosing this information voluntarily. We use appropriate physical and electronic procedures to safeguard the information we collect.</p>

            <h3 className="text-xl font-semibold text-accent-soft mt-4 mb-2">Cookies</h3>
            <p>Our site uses &quot;cookies&quot; – small files placed on your hard drive – to analyze web traffic, measure promotional effectiveness, and promote trust and safety. These are primarily &quot;session cookies&quot; that are automatically deleted when you close your browser. We do not control the use of cookies by third parties.</p>

            <h3 className="text-xl font-semibold text-accent-soft mt-4 mb-2">Third-Party Links</h3>
            <p>This privacy policy does not apply to sites maintained by other companies or organizations to which we may link. We are not responsible for any personal information you submit to third parties via our website.</p>
          </div>
        </div>

        <PolicyLinks note="We appreciate your interest in our workshop." />
      </div>
    </main>
  );
}