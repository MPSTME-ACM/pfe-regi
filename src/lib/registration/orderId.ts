import { randomBytes } from 'node:crypto';

/**
 * Order IDs are OPAQUE. They carry no meaning and must never be parsed.
 *
 * 2025 encoded the chosen domain in the final character, and api/webhook read it
 * back out with `order_id.slice(-1)` to fill in the confirmation email. That
 * broke silently the moment comped member orders gained an `-ACM` suffix: the
 * last character became 'M', the domain lookup missed, and every one of those
 * emails said "Welcome to the undefined track". With three SKUs and up to three
 * tracks per registration there is no character left to encode anyway.
 *
 * If you need to know what someone bought, SELECT the row.
 *
 * Alphabet excludes 0/O/1/I to stay legible when read aloud at a help desk.
 * 10 chars from a 32-symbol alphabet is ~50 bits — collisions are not a concern
 * at this scale, and `order_id` is UNIQUE so one would fail loudly rather than
 * overwrite anything.
 */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const LENGTH = 10;

export function generateOrderId(prefix = 'PFE'): string {
  const bytes = randomBytes(LENGTH);
  let out = '';
  for (let i = 0; i < LENGTH; i++) {
    // Modulo bias here is negligible: 256 % 32 === 0, so this is uniform.
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return `${prefix}-${out}`;
}
