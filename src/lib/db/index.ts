import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

/**
 * SSL was previously hardcoded to `{ rejectUnauthorized: false }` for every
 * connection. Managed providers (Neon, and whatever Coolify points at) need
 * that, but it also made it impossible to connect to a plain local Postgres —
 * the server rejects the SSL handshake outright, so nobody could run this
 * against a real database on their own machine.
 *
 * Remote hosts behave exactly as before. Local hosts, and any URL that opts out
 * with `?sslmode=disable`, skip SSL.
 */
function sslConfig(connectionString: string | undefined) {
  if (!connectionString) return false;
  if (/[?&]sslmode=disable\b/.test(connectionString)) return false;

  try {
    const host = new URL(connectionString).hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') {
      return false;
    }
  } catch {
    // Unparseable URL — fall through and keep the permissive remote default
    // rather than failing to connect to production over a parsing detail.
  }

  return { rejectUnauthorized: false };
}

const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString,
  ssl: sslConfig(connectionString),
});

export const db = drizzle(pool, { schema });
