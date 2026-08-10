import Link from 'next/link';
import ProgramHeader from '@/app/_components/ProgramHeader';
import PolicyLinks from '@/app/_components/PolicyLinks';

export default function ContactUsPage() {
  const dateRange = 'September 16th - 18th, 2025';

  return (
    <main className="min-h-screen text-white font-sans flex items-center justify-center p-4 sm:p-6 md:p-8">
      <div className="w-full max-w-3xl bg-black/30 backdrop-blur-md rounded-2xl border border-white/10 p-8 sm:p-10 md:p-12">
        <ProgramHeader dateRange={dateRange} />

        <div className="text-center mt-10 mb-8">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-accent-soft mb-4 leading-tight">
            Contact Us
          </h1>
        </div>

        <div className="max-w-prose mx-auto space-y-8 text-gray-300 leading-relaxed">
          <p>
            Have questions about the PFE Workshop or need assistance? We&apos;re here to help! Reach out to us through any of the channels below.
          </p>

          <div>
            <h2 className="text-2xl font-bold text-accent-soft mb-2">Email Support</h2>
            <p className="mb-2">For general inquiries, please email us at:</p>
            <Link href="mailto:pfe@mpst.me" className="hover:text-accent-soft transition-colors">
              pfe@mpst.me
            </Link>
          </div>

          <div>
            <h2 className="text-2xl font-bold text-accent-soft mb-2">Phone Support</h2>
            <p className="mb-2">For urgent matters, you can contact us at:</p>
            <Link href="tel:+919619458059" className="hover:text-accent-soft transition-colors">
              +91 9619458059
            </Link>
          </div>
        </div>

        <PolicyLinks note="We appreciate your interest in our workshop." />
      </div>
    </main>
  );
}
