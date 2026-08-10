// ─────────────────────────────────────────────────────────────────────────────
// The public origin of this deployment, resolved at RUNTIME.
//
// This exists because of a build-time trap that is invisible in source review.
//
// Next inlines every `process.env.NEXT_PUBLIC_*` read at build time — including
// reads inside server-only route handlers. `next build` therefore froze whatever
// NEXT_PUBLIC_SITE_URL happened to be set to on the build machine straight into
// the server bundle:
//
//     await qrcode.toDataURL(`http://localhost:3000/verify?orderId=${orderId}`)
//                             ^^^^^^^^^^^^^^^^^^^^ a literal, in .next/server
//
// Setting NEXT_PUBLIC_SITE_URL in Coolify does NOT fix that. Runtime env cannot
// change a string that is already compiled in. And the Dockerfile declares no
// `ARG`, so a --build-arg would be dropped before `npm run build` ever sees it.
//
// SITE_URL carries no NEXT_PUBLIC_ prefix, so it is never inlined: it is read
// from the process on every call, which is what a deployment-specific value has
// to be. NEXT_PUBLIC_SITE_URL stays as a fallback purely so that a deployment
// whose build DID bake the correct origin keeps working until SITE_URL is set.
//
// Nothing on the client needs this — all four call sites are server-side.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Absolute origin, no trailing slash. E.g. `https://register.pfe.mpstmeacm.com`.
 *
 * @throws if neither variable holds an absolute http(s) URL.
 *
 * Throwing is the point. Every consumer interpolates this into a string, so a
 * missing value yields `undefined/verify?orderId=PFE-XXXX` — which generates a
 * perfectly valid QR code, sends a perfectly normal-looking email and sets
 * `emailSentAt`. Nothing fails, and the ticket is unscannable. A ₹0 comp is the
 * only path that surfaces it before a real student is holding the dead ticket.
 */
export function siteUrl(): string {
  // The second read is inlined — deliberately, and it is the ONLY place in the
  // codebase where an inlined origin is acceptable. It compiles to whatever the
  // build machine had, e.g. `process.env.SITE_URL || "http://localhost:3000"`,
  // which is exactly the old behaviour preserved as a fallback: an image whose
  // build already baked the correct origin keeps working, and one that baked
  // nothing gets `undefined` and throws below. SITE_URL always wins at runtime.
  const raw = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL;

  if (!raw) {
    throw new Error(
      'SITE_URL is not set. It is the public origin of this deployment ' +
        '(e.g. https://register.pfe.mpstmeacm.com) and ticket QR codes and the ' +
        'Cashfree return URL are built from it.',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`SITE_URL is not a valid absolute URL: ${JSON.stringify(raw)}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`SITE_URL must be http(s), got ${JSON.stringify(raw)}`);
  }

  // A trailing slash would produce `https://host//verify`. Harmless in a browser,
  // but the QR payload is compared as a string in support threads, so keep it exact.
  return parsed.origin;
}
