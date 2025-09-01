import Link from "next/link";
import OrganizerInfo from "@/components/footer";

export default function CancellationPolicyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans p-8 sm:p-12 md:p-16">
      <div className="max-w-4xl mx-auto">
        <div className="space-y-6 text-muted-foreground">
          {/* Cancellation & Refund Section */}
          <h2 className="text-3xl font-bold text-primary pt-4">
            Cancellation & Refund Policy
          </h2>
          <p>
            Please note that all registration fees for the PFE Workshop are{" "}
            <strong>non-refundable</strong>. Once a payment is made, we cannot
            provide any refunds or cancellations for any reason. This policy
            helps us manage event logistics and commitments effectively. We
            thank you for your understanding.
          </p>

          {/* Privacy Policy Section */}
          <h2 className="text-3xl font-bold text-primary pt-8">
            Privacy Policy
          </h2>
          <p>
            We respect and are committed to protecting your privacy. We will not
            sell, publish, or rent your personal data to any third party without
            your consent. By using our site, you agree to the terms of this
            policy.
          </p>

          <h3 className="text-xl font-semibold text-primary pt-4">
            Information We Collect
          </h3>
          <p>
            We collect personal information such as your name, email, and
            contact details to process your registration and provide you with
            the best possible service. You acknowledge that you are disclosing
            this information voluntarily. We use appropriate physical and
            electronic procedures to safeguard the information we collect.
          </p>

          <h3 className="text-xl font-semibold text-primary pt-4">Cookies</h3>
          <p>
            Our site uses &quot;cookies&quot; – small files placed on your hard
            drive – to analyze web traffic, measure promotional effectiveness,
            and promote trust and safety. These are primarily &quot;session
            cookies&quot; that are automatically deleted when you close your
            browser. We do not control the use of cookies by third parties.
          </p>

          <h3 className="text-xl font-semibold text-primary pt-4">
            Third-Party Links
          </h3>
          <p>
            This privacy policy does not apply to sites maintained by other
            companies or organizations to which we may link. We are not
            responsible for any personal information you submit to third parties
            via our website.
          </p>

          <OrganizerInfo />
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
