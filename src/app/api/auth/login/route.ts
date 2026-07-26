import { NextResponse } from 'next/server';
import { checkPassword, createSessionToken, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth';
import { handle, readJson } from '@/lib/api';

export async function POST(request: Request) {
  return handle(async () => {
    const body = await readJson(request);
    if (!checkPassword(body.password)) {
      // Slow brute force down a little without keeping server-side state.
      await new Promise((resolve) => setTimeout(resolve, 600));
      return NextResponse.json({ error: '密碼錯誤' }, { status: 401 });
    }
    const { token, expiresAt } = createSessionToken();
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
    return response;
  });
}
