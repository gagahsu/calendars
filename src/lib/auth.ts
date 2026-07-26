import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

/**
 * Single-user auth: one password from the environment, and a signed cookie
 * holding nothing but an expiry. There is no user table and no session store.
 */
export const SESSION_COOKIE = 'cal_session';
const SESSION_TTL_DAYS = 30;

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 16) {
    throw new Error('SESSION_SECRET is missing or too short (need 16+ chars)');
  }
  return value;
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** `<expiresAtMs>.<nonce>.<hmac>` */
export function createSessionToken(): { token: string; expiresAt: Date } {
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60_000);
  const payload = `${expiresAt.getTime()}.${randomBytes(8).toString('base64url')}`;
  return { token: `${payload}.${sign(payload)}`, expiresAt };
}

export function verifySessionToken(token: string | undefined): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [expiresAt, nonce, mac] = parts;
  if (!safeEqual(mac, sign(`${expiresAt}.${nonce}`))) return false;
  const expiry = Number(expiresAt);
  return Number.isFinite(expiry) && expiry > Date.now();
}

export function checkPassword(input: unknown): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) throw new Error('APP_PASSWORD is not set');
  if (typeof input !== 'string' || input.length === 0) return false;
  // Hash both sides first so the comparison length never leaks the password length.
  return safeEqual(sign(`pw:${input}`), sign(`pw:${expected}`));
}

/** For server components. */
export async function isAuthenticated(): Promise<boolean> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}

/**
 * For route handlers. Returns a 401 response when unauthenticated, `null` when
 * the caller may proceed.
 */
export async function requireAuth(): Promise<NextResponse | null> {
  if (await isAuthenticated()) return null;
  return NextResponse.json({ error: '未登入' }, { status: 401 });
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    expires: expiresAt,
  };
}

/**
 * Cron endpoints are called by Vercel with `Authorization: Bearer <CRON_SECRET>`.
 * Also accepts `?key=` so you can wire up an external pinger.
 */
export function isCronAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = request.headers.get('authorization') ?? '';
  if (header.startsWith('Bearer ') && safeEqual(header.slice(7), expected)) return true;
  const key = new URL(request.url).searchParams.get('key');
  return !!key && safeEqual(key, expected);
}
