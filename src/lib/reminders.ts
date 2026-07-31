import { prisma, toNum } from './db';
import {
  addDays,
  dateKey,
  daysBetween,
  formatShortZh,
  startOfTaipeiDay,
  timeKey,
  toTaipeiParts,
} from './date';
import { billStatusText, syncAllStatements, upcomingBills } from './billing';
import { pushMessage, lineConfigured, text, DEFAULT_QUICK_REPLIES } from './line';

/**
 * The reminder job. Runs twice a day (see vercel.json) and pushes one digest
 * per topic. Every push is recorded in ReminderLog under a deterministic key so
 * a retry — or an extra manual run — never double-notifies.
 */

export type ReminderSlot = 'morning' | 'evening';

export type ReminderRun = {
  slot: ReminderSlot;
  pushed: string[];
  skipped: string[];
  errors: string[];
};

const money = (value: number) => `NT$${Math.round(value).toLocaleString('en-US')}`;

export async function runReminders(
  slot: ReminderSlot,
  { now = new Date(), dryRun = false }: { now?: Date; dryRun?: boolean } = {},
): Promise<ReminderRun> {
  const run: ReminderRun = { slot, pushed: [], skipped: [], errors: [] };

  // Keep future statements materialised so a bill is never missed because its
  // row did not exist yet.
  const cards = await prisma.card.findMany({ where: { active: true } });
  try {
    await syncAllStatements(cards, { now });
  } catch (error) {
    run.errors.push(`syncStatements: ${message(error)}`);
  }

  const jobs: Array<() => Promise<{ key: string; body: string } | null>> = [
    () => billReminder(now),
    () => dayDigest(now, slot),
    () => todoReminder(now, slot),
  ];

  for (const job of jobs) {
    try {
      const result = await job();
      if (!result) continue;
      const already = await prisma.reminderLog.findUnique({ where: { key: result.key } });
      if (already) {
        run.skipped.push(result.key);
        continue;
      }
      if (!dryRun) {
        if (!lineConfigured()) {
          run.errors.push('LINE 未設定，略過推播');
          continue;
        }
        await pushMessage([text(result.body, DEFAULT_QUICK_REPLIES)]);
        await prisma.reminderLog.create({ data: { key: result.key } });
      }
      run.pushed.push(result.key);
    } catch (error) {
      run.errors.push(message(error));
    }
  }

  // ReminderLog only exists for de-duplication; 90 days is plenty.
  await prisma.reminderLog
    .deleteMany({ where: { sentAt: { lt: addDays(now, -90) } } })
    .catch(() => undefined);

  return run;
}

/**
 * Credit-card deadlines — the main event. A card fires on each of its
 * `remindDaysBefore` offsets, and every day once overdue.
 */
async function billReminder(now: Date): Promise<{ key: string; body: string } | null> {
  const bills = await upcomingBills({ withinDays: 40, now });
  const due = bills.filter(
    (bill) => bill.overdue || bill.card.remindDaysBefore.includes(bill.daysLeft),
  );
  if (due.length === 0) return null;

  const lines = ['💳 信用卡繳費提醒', ''];
  let total = 0;
  for (const bill of due) {
    const amount = toNum(bill.statement.amount);
    if (amount) total += amount;
    const flag = bill.overdue ? '🔴 逾期' : bill.daysLeft === 0 ? '🔴 今天到期' : '🟠';
    lines.push(`${flag} ${bill.card.name}`);
    lines.push(`   ${amount ? money(amount) : '金額尚未登記'}｜${billStatusText(bill)}`);
    if (bill.card.autoPay) lines.push('   （設定為自動扣繳，請確認餘額足夠）');
  }
  if (total > 0) lines.push('', `合計 ${money(total)}`);
  lines.push('', '繳完請回覆：已繳 ' + due[0].card.name);

  // One key per day per set of cards, so changing amounts mid-day does not
  // trigger a second push.
  const key = `bill:${dateKey(now)}:${due.map((b) => b.statement.id).sort().join(',')}`;
  return { key, body: lines.join('\n') };
}

/** Morning: what is on today. Evening: what is on tomorrow. */
async function dayDigest(
  now: Date,
  slot: ReminderSlot,
): Promise<{ key: string; body: string } | null> {
  const target = slot === 'morning' ? startOfTaipeiDay(now) : addDays(startOfTaipeiDay(now), 1);
  const end = addDays(target, 1);

  const events = await prisma.event.findMany({
    where: { startsAt: { gte: target, lt: end }, category: { not: 'bill' } },
    orderBy: [{ allDay: 'desc' }, { startsAt: 'asc' }],
  });
  if (events.length === 0) return null;

  const heading = slot === 'morning' ? '☀️ 今天的行程' : '🌙 明天的行程';
  const lines = [`${heading}（${formatShortZh(target)}）`, ''];
  for (const event of events) {
    lines.push(`・${event.allDay ? '全天' : timeKey(event.startsAt)} ${event.title}`);
    if (event.location) lines.push(`   📍 ${event.location}`);
  }
  return { key: `day:${slot}:${dateKey(target)}`, body: lines.join('\n') };
}

/** Overdue and due-today todos, morning only, to avoid nagging twice. */
async function todoReminder(
  now: Date,
  slot: ReminderSlot,
): Promise<{ key: string; body: string } | null> {
  if (slot !== 'morning') return null;
  const endOfToday = addDays(startOfTaipeiDay(now), 1);
  const todos = await prisma.todo.findMany({
    where: { done: false, dueAt: { lt: endOfToday } },
    orderBy: [{ dueAt: 'asc' }, { priority: 'asc' }],
    take: 15,
  });
  if (todos.length === 0) return null;

  const lines = ['✅ 該處理的待辦', ''];
  for (const todo of todos) {
    const left = todo.dueAt ? daysBetween(now, todo.dueAt) : 0;
    const tag = left < 0 ? `逾期 ${Math.abs(left)} 天` : '今天到期';
    lines.push(`・${todo.title}（${tag}）`);
  }
  lines.push('', '完成請回覆：完成 1');
  return { key: `todo:${dateKey(now)}`, body: lines.join('\n') };
}

/**
 * On the 1st of the month, push last month's AI analysis. Called by the cron
 * route after `runReminders`, kept separate because it costs a model call.
 */
export function shouldSendMonthlyInsight(now: Date, slot: ReminderSlot): boolean {
  return slot === 'morning' && toTaipeiParts(now).day === 1;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
