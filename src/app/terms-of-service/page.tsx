import OrganizerInfo from "@/components/footer";
import Link from "next/link";

export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans p-8 sm:p-12 md:p-16">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-extrabold text-primary mb-8">
          Terms of Service
        </h1>
        <div className="space-y-6 text-muted-foreground">
          <p>
            Welcome to the PFE - Programming For Everyone workshop hosted by ACM
            MPSTME. By registering for this event, you agree to comply with and
            be bound by the following terms and conditions of use. Please review
            the following terms carefully.
          </p>

          <h2 className="text-2xl font-bold  pt-4">
            1. Registration and Payment
          </h2>
          <p>
            All registrations must be completed via the official registration
            form. The ticket price of ₹99 is non-negotiable and must be paid in
            full to confirm your participation. All payments are processed
            through our secure payment gateway, Cashfree Payments.
          </p>

          <h2 className="text-2xl font-bold  pt-4">2. Code of Conduct</h2>
          <p>
            All attendees are expected to conduct themselves in a professional
            and respectful manner. Harassment, discrimination, or any disruptive
            behavior will not be tolerated and may result in immediate removal
            from the workshop without a refund.
          </p>

          <h2 className="text-2xl font-bold  pt-4">3. Content and Materials</h2>
          <p>
            All workshop materials, including notes and code, are provided for
            personal educational use only. Redistribution or commercial use of
            these materials without explicit permission from ACM MPSTME is
            strictly prohibited.
          </p>

          <h2 className="text-2xl font-bold  pt-4">4. Liability</h2>
          <p>
            ACM MPSTME is not responsible for any loss, injury, or damage to
            personal property. By attending, you agree to release ACM MPSTME
            from any and all claims and liabilities.
          </p>
          <OrganizerInfo></OrganizerInfo>
        </div>
        <div className="mt-12">
          <Link href="/" className="text-primary hover: transition-colors">
            &larr; Back to Registration
          </Link>
        </div>
      </div>
    </div>
  );
}
