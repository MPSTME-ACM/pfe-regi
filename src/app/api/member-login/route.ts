import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const auth = request.headers.get('authorization') || '';
  const expected = `Basic ${Buffer.from(`acm:${process.env.MEMBER_PASSWORD}`).toString('base64')}`;

  if (auth === expected) {
    return NextResponse.json({ message: 'Authorized' }, { status: 200 });
  } else {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }
}