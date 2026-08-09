import { NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth/requireAdmin';

export async function GET(request: Request) {
  const auth = requireMember(request);
  if (!auth.ok) return auth.response;

  return NextResponse.json({ message: 'Authorized' }, { status: 200 });
}