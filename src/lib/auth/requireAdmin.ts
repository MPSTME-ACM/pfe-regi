import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

// This module replaces five hand-rolled copies of HTTP Basic auth validation.

type AuthResult = { ok: true } | { ok: false; response: NextResponse };

/**
 * Check HTTP Basic authentication against expected username and password.
 * Returns { ok: true } on success, or { ok: false; response } on failure.
 */
function checkBasic(
  request: Request,
  expectedUser: string,
  expectedPassword: string
): AuthResult {
  // Missing header
  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, message: 'Authorization required' },
        { status: 401 }
      ),
    };
  }

  // Malformed header or decode error
  let encodedCreds: string;
  let decodedCreds: string;
  try {
    const parts = authHeader.split(' ');
    if (parts.length !== 2) {
      throw new Error('Invalid format');
    }
    encodedCreds = parts[1];
    decodedCreds = Buffer.from(encodedCreds, 'base64').toString('utf-8');
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, message: 'Malformed authorization header' },
        { status: 400 }
      ),
    };
  }

  // Missing colon separator
  const colonIndex = decodedCreds.indexOf(':');
  if (colonIndex === -1) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, message: 'Malformed authorization header' },
        { status: 400 }
      ),
    };
  }

  const username = decodedCreds.substring(0, colonIndex);
  const password = decodedCreds.substring(colonIndex + 1);

  // Fail closed: if expected password is empty or undefined, always reject
  if (!expectedPassword) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, message: 'Invalid credentials' },
        { status: 401 }
      ),
    };
  }

  // Username mismatch
  if (username !== expectedUser) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, message: 'Invalid credentials' },
        { status: 401 }
      ),
    };
  }

  // Compare passwords with a timing-safe comparison when the BYTE lengths match.
  // Guarding on string length is not enough: 'aé' and 'ab' are both 2 UTF-16 code
  // units but 3 and 2 bytes, and timingSafeEqual throws RangeError on unequal
  // buffer lengths — which would turn a wrong password into a 500.
  const given = Buffer.from(password, 'utf-8');
  const expected = Buffer.from(expectedPassword, 'utf-8');
  const passwordMatch = given.length === expected.length && timingSafeEqual(given, expected);

  if (!passwordMatch) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, message: 'Invalid credentials' },
        { status: 401 }
      ),
    };
  }

  return { ok: true };
}

/**
 * Validate admin HTTP Basic authentication.
 * Expected credentials: username 'admin', password from ADMIN_PASSWORD env var.
 */
export function requireAdmin(request: Request): AuthResult {
  return checkBasic(request, 'admin', process.env.ADMIN_PASSWORD || '');
}

/**
 * Validate member HTTP Basic authentication.
 * Expected credentials: username 'acm', password from MEMBER_PASSWORD env var.
 */
export function requireMember(request: Request): AuthResult {
  return checkBasic(request, 'acm', process.env.MEMBER_PASSWORD || '');
}
