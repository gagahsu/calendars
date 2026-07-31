import { NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/auth';
import { runEventReminders } from '@/lib/reminders';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Per-event reminders — the `remindMinutes` on an Event.
 *
 * Split out from /api/cron/reminders because it needs to run often. Vercel's
 * Hobby plan caps cron at once a day, so this is meant to be polled by an
 * external scheduler (cron-job.org and friends) every 5-15 minutes with
 * `?key=<CRON_SECRET>`. Until something polls it, `remindMinutes` does nothing.
 *
 * Cheap on purpose: one indexed query, and nothing at all to do most of the
 * time, so a tight polling interval stays comfortably inside the free tier.
 */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const dryRun = new URL(request.url).searchParams.get('dryRun') === '1';
  const run = await runEventReminders({ now: new Date(), dryRun });

  return NextResponse.json({ ok: run.errors.length === 0, ...run, dryRun });
}
