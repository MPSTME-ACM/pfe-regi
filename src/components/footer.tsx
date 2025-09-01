export default function OrganizerInfo() {
  const merchantName =
    process.env.NEXT_PUBLIC_MERCHANT_NAME || "Merchant Name Not Set";

  return (
    <p className="text-gray-300 mt-6">
      This event is organized by ACM MPSTME under the legal name of{" "}
      <strong>{merchantName}</strong>. For any queries, please contact us at{" "}
      <a
        href="mailto:cashfree@jkartik.in"
        className="text-[#7bbeeb] hover:text-[#e97bfc]"
      >
        cashfree@jkartik.in
      </a>
      .
    </p>
  );
}
