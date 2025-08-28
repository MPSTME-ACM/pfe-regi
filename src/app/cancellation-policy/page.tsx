import Link from 'next/link';

export default function CancellationPolicyPage() {
    return (
        <div className="min-h-screen bg-[#0d0d1a] text-white font-sans p-8 sm:p-12 md:p-16">
            <div className="max-w-4xl mx-auto">
                <h1 className="text-4xl font-extrabold text-[#e97bfc] mb-8">Cancellation & Refund Policy</h1>
                <div className="space-y-6 text-gray-300">
                    <h2 className="text-2xl font-bold text-[#f8c8fc]">General Policy</h2>
                    <p>Thank you for registering for the PFE - Programming For Everyone workshop. We appreciate your interest and participation.</p>

                    <h2 className="text-2xl font-bold text-[#f8c8fc] pt-4">No Refunds</h2>
                    <p>Please note that all registration fees are <b>non-refundable</b>. Once a payment is made, we cannot provide any refunds, cancellations, or transfers for any reason, including but not limited to, non-attendance, scheduling conflicts, or dissatisfaction with the workshop content.</p>
                    <p>This policy is in place to help us manage event logistics, resources, and commitments to our instructors and partners. We thank you for your understanding.</p>

                    <h2 className="text-2xl font-bold text-[#f8c8fc] pt-4">Event Cancellation by Organizer</h2>
                    <p>In the unlikely event that the workshop is canceled by the organizer, ACM MPSTME, a full refund will be issued to all registered participants. You will be notified via your registered email address if such a situation arises.</p>
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