import Link from "next/link";
export default function ContactUsPage() {
    return (
        <div className="min-h-screen bg-[#0d0d1a] text-white font-sans p-8 sm:p-12 md:p-16">
            <div className="max-w-4xl mx-auto">
                <h1 className="text-4xl font-extrabold text-[#e97bfc] mb-8">Contact Us</h1>
                <div className="space-y-8 text-gray-300 bg-black/30 p-8 rounded-lg border border-white/10">
                    <p>
                        Have questions about the PFE Workshop or need assistance? We're here to help! Reach out to us through any of the channels below.
                    </p>
                    
                    <div>
                        <h2 className="text-2xl font-bold text-[#f8c8fc]">Email Support</h2>
                        <p>For general inquiries, please email us at:</p>
                        <Link href="mailto:[YOUR_EMAIL_HERE]" className="text-[#7bbeeb] hover:text-[#e97bfc] transition-colors text-lg">
                            mail@parthg.me
                        </Link>
                    </div>

                    <div>
                        <h2 className="text-2xl font-bold text-[#f8c8fc]">Phone Support</h2>
                        <p>For urgent matters, you can contact us at:</p>
                        <Link href="tel:[YOUR_PHONE_NUMBER_HERE]" className="text-[#7bbeeb] hover:text-[#e97bfc] transition-colors text-lg">
                            +91 9619458059
                        </Link>
                    </div>
                </div>

                <div className="mt-12">
                    <Link href="/" className="text-[#7bbeeb] hover:text-[#e97bfc] transition-colors">
                        &larr; Back to Registration
                    </Link>
                </div>
            </div>
        </div>
    );
}