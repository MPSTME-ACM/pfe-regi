import OrganizerInfo from "@/components/footer";
import Link from "next/link";

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans p-8 sm:p-12 md:p-16">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-extrabold text-primary mb-8">
          Privacy Policy
        </h1>
        <div className="space-y-6 text-muted-foreground">
          <p>
            This Privacy Policy explains how we collect, use, and protect your
            personal information when you register or make payments through our
            website.
          </p>

          <h2 className="text-2xl font-bold text-primary pt-4">
            1. Information We Collect
          </h2>
          <p>
            We collect personal details such as your name, email, and payment
            information in order to process registrations securely.
          </p>

          <h2 className="text-2xl font-bold text-primary pt-4">
            2. Use of Information
          </h2>
          <p>
            Your information will only be used for event registration,
            communication, and payment processing through Cashfree Payments.
          </p>

          <h2 className="text-2xl font-bold text-primary pt-4">
            3. Data Security
          </h2>
          <p>
            We take appropriate measures to safeguard your data. All payments
            are processed via Cashfree, a secure and PCI-DSS compliant payment
            gateway.
          </p>

          <h2 className="text-2xl font-bold text-primary pt-4">4. Contact</h2>
          <OrganizerInfo></OrganizerInfo>
        </div>
        <div className="mt-12">
          <Link
            href="/"
            className="text-primary hover:text-primary/80 transition-colors"
          >
            &larr; Back to Registration
          </Link>
        </div>
      </div>
    </div>
  );
}
