import { NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/auth';
import { runReminders, shouldSendMonthlyInsight, type ReminderSlot } from '@/lib/reminders';
import { getInsight, insightToText } from '@/lib/insights';
import { addMonths, periodKey } from '@/lib/date';
import { DEFAULT_QUICK_REPLIES, lineConfigured, pushMessage, text } from '@/lib/line';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Called by Vercel Cron twice a day (see vercel.json). `slot=morning` sends the
 * day digest + todos, `slot=evening` previews tomorrow. Bill reminders fire in
 * both slots but de-duplicate per day.
 */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const slot: ReminderSlot = params.get('slot') === 'evening' ? 'evening' : 'morning';
  const dryRun = params.get('dryRun') === '1';
  const now = new Date();

  const run = await runReminders(slot, { now, dryRun });

  // On the 1st, push last month's analysis once.
  if (shouldSendMonthlyInsight(now, slot)) {
    const period = addMonths(periodKey(now), -1);
    const key = `insight:${period}`;
    try {
      const already = await prisma.reminderLog.findUnique({ where: { key } });
      if (already) {
        run.skipped.push(key);
      } else {
        const { insight, model } = await getInsight(period, { force: true, now });
        if (!dryRun) {
          if (lineConfigured()) {
            await pushMessage([
              text(
                `${insightToText(insight)}\n\n— 由 ${model} 分析`,
                DEFAULT_QUICK_REPLIES,
              ),
            ]);
            await prisma.reminderLog.create({ data: { key } });
          } else {
            run.errors.push('LINE 未設定，略過月報推播');
          }
        }
        run.pushed.push(key);
      }
    } catch (error) {
      run.errors.push(`monthly insight: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return NextResponse.json({ ok: run.errors.length === 0, ...run, dryRun });
}
