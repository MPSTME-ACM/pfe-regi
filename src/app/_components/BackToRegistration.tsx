import Link from 'next/link';

/**
 * The way back to the form from an info page.
 *
 * The four info pages (About Us, Contact Us, Terms, Policies) all render
 * `PolicyLinks`, which links sideways to each OTHER info page but never home.
 * Someone who opened Terms mid-registration could only get back with the
 * browser's back button — and on the payment step that is the one control you
 * least want a buyer reaching for.
 *
 * Placed above the card rather than in the footer: a policy page is long, and a
 * way out that requires scrolling past the whole document is not a way out.
 *
 * Shared rather than copied into four files, for the same reason as
 * `components/admin/BackToAdmin` — four copies become four different links.
 */
export default function BackToRegistration({ className = '' }: { className?: string }) {
  return (
    <Link
      href="/"
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3.5 text-sm text-gray-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-soft ${className}`}
    >
      <span aria-hidden>&larr;</span>
      Back to registration
    </Link>
  );
}
