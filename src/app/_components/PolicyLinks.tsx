import { Fragment } from 'react';
import Link from 'next/link';

// The policy footer, shared by the open state (RegistrationForm, a client
// component) and the closed state (ClosedNotice, a server component). Purely
// presentational — no hooks, no state — so it renders in either without
// needing its own "use client".
//
// Layout note: below `sm` the row wraps, so the bullet separators are hidden
// there. Bullets only make sense on a single line; once the row wraps they end
// up stranded at the end or start of a line. Each link is `whitespace-nowrap`
// so "Terms of Service" can never break mid-label, and 44px tall so it is a
// real tap target.

const POLICY_LINKS = [
  { href: '/terms-of-service', label: 'Terms of Service' },
  { href: '/cancellation-policy', label: 'Our Policies' },
  { href: '/about-us', label: 'About Us' },
  { href: '/contact-us', label: 'Contact Us' },
];

export default function PolicyLinks({ note }: { note: string }) {
  return (
    <div className="mt-10 text-center text-sm text-gray-500">
      <p className="text-balance">{note}</p>
      <nav
        aria-label="Policies"
        className="mt-2 flex flex-wrap items-center justify-center gap-x-4 sm:mt-1 sm:gap-x-3"
      >
        {POLICY_LINKS.map(({ href, label }, index) => (
          <Fragment key={href}>
            {index > 0 && (
              <span aria-hidden="true" className="hidden text-gray-600 sm:inline">
                &bull;
              </span>
            )}
            <Link
              href={href}
              className="inline-flex min-h-11 items-center rounded-sm px-1 whitespace-nowrap transition-colors hover:text-accent-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-soft sm:min-h-0"
            >
              {label}
            </Link>
          </Fragment>
        ))}
      </nav>
    </div>
  );
}
