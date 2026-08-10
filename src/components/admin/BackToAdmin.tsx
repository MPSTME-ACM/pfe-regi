import Link from 'next/link';

/**
 * The way home from a staff tool.
 *
 * /admin links out to Stats and Sync, but those pages (and /verify) had no link
 * back — the only exit was the browser's back button, which is not a control
 * anyone should have to reach for inside an app. Shared rather than copied so
 * the three do not drift into three slightly different links.
 */
export default function BackToAdmin({ className = '' }: { className?: string }) {
  return (
    <Link
      href="/admin"
      className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-hairline bg-white/[0.04] px-3.5 text-sm text-gray-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-soft ${className}`}
    >
      <span aria-hidden>&larr;</span>
      Admin
    </Link>
  );
}
