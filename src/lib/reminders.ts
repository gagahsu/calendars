import { prisma, toNum } from './db';
import {
  addDays,
  dateKey,
  daysBetween,
  eventWhen,
  formatShortZh,
  startOfTaipeiDay,
  toTaipeiParts,
} from './date';
import { billStatusText, refreshStatementEvent, syncAllStatements, upcomingBills } from './billing';
import { billActionMessage } from './agenda';
import { pushMessage, lineConfigured, text, DEFAULT_QUICK_REPLIES, type LineMessage } from './line';

/**
 * The reminder job. Runs twice a day (see vercel.json) and pushes one digest
 * per topic. Every push is recorded in ReminderLog under a deterministic key so
 * a retry — or an extra manual run — never double-notifies.
 */

export type ReminderSlot = 'morning' | 'evening';

/**
 * One notification. `extra` rides along in the same push — the bill reminder
 * uses it to attach the tappable cards behind its text summary.
 */
type ReminderMessage = { key: string; body: string; extra?: LineMessage[] };

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

  const jobs: Array<() => Promise<ReminderMessage | null>> = [
    // Ahead of billReminder: anything settled here should not also be
    // announced as overdue in the same push.
    () => autoPaySettlement(now, dryRun),
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
        await pushMessage([text(result.body, DEFAULT_QUICK_REPLIES), ...(result.extra ?? [])]);
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
 * Cards set to autoPay settle themselves the day after the deadline.
 *
 * The bank has already taken the money; leaving the statement unpaid meant the
 * reminder announced it as overdue every single day until someone tapped a
 * button, which is how a notification stops being read. The push that reports
 * this carries the same 未繳費 button as any other bill card, so a failed
 * direct debit is one tap to put back.
 */
async function autoPaySettlement(now: Date, dryRun: boolean): Promise<ReminderMessage | null> {
  // dueAt is midnight Taipei on the deadline, so this is everything whose day
  // has fully passed.
  const settled = await prisma.statement.findMany({
    where: {
      paid: false,
      dueAt: { lt: startOfTaipeiDay(now) },
      card: { autoPay: true, active: true },
    },
    include: { card: true },
    orderBy: { dueAt: 'asc' },
  });
  if (settled.length === 0) return null;

  if (!dryRun) {
    await prisma.$transaction(
      settled.map((statement) =>
        prisma.statement.update({
          where: { id: statement.id },
          data: { paid: true, paidAt: now, paidAmount: statement.amount },
        }),
      ),
    );
    for (const statement of settled) {
      await refreshStatementEvent(statement.id).catch(() => undefined);
    }
  }

  const lines = ['🏦 自動扣繳已完成', ''];
  let total = 0;
  for (const statement of settled) {
    const amount = toNum(statement.amount);
    if (amount) total += amount;
    lines.push(`・${statement.card.name} ${statement.period}｜${amount ? money(amount) : '金額未登記'}`);
  }
  if (total > 0) lines.push('', `合計 ${money(total)}`);
  lines.push('', '已自動標記為已繳。若扣款失敗，點卡片上的「未繳費」改回來。');

  // Keyed on the statements themselves: this can only ever fire once each.
  const key = `autopay:${settled.map((s) => s.id).sort().join(',')}`;
  const cards = billActionMessage(
    settled.map((statement) => ({
      statement,
      card: statement.card,
      daysLeft: daysBetween(now, statement.dueAt),
      overdue: true,
    })),
  );
  return { key, body: lines.join('\n'), extra: cards ? [cards] : undefined };
}

/**
 * How many days before a deadline an unregistered amount is chased up. A
 * payment reminder that cannot say how much to pay is barely a reminder, and
 * three days is enough time to go and look the number up.
 */
const AMOUNT_PROMPT_DAYS = 3;

/**
 * Credit-card deadlines — the main event. A card fires on each of its
 * `remindDaysBefore` offsets, every day once overdue, and once at
 * `AMOUNT_PROMPT_DAYS` out if its amount is still blank.
 */
async function billReminder(now: Date): Promise<ReminderMessage | null> {
  const bills = await upcomingBills({ withinDays: 40, now });
  const due = bills.filter(
    (bill) =>
      bill.overdue ||
      bill.card.remindDaysBefore.includes(bill.daysLeft) ||
      // Folded into this reminder rather than sent as its own message: cards
      // whose remindDaysBefore already contains 3 would otherwise produce two
      // notifications on the same morning saying much the same thing.
      (bill.daysLeft === AMOUNT_PROMPT_DAYS && toNum(bill.statement.amount) === null),
  );
  if (due.length === 0) return null;

  const lines = ['💳 信用卡繳費提醒', ''];
  let total = 0;
  let missing = 0;
  for (const bill of due) {
    const amount = toNum(bill.statement.amount);
    if (amount) total += amount;
    else missing += 1;
    const flag = bill.overdue ? '🔴 逾期' : bill.daysLeft === 0 ? '🔴 今天到期' : '🟠';
    lines.push(`${flag} ${bill.card.name}`);
    lines.push(`   ${amount ? money(amount) : '⚠️ 金額尚未登記'}｜${billStatusText(bill)}`);
    if (bill.card.autoPay) lines.push('   （設定為自動扣繳，請確認餘額足夠）');
  }
  if (total > 0) lines.push('', `合計 ${money(total)}`);
  lines.push(
    '',
    missing > 0
      ? `👇 有 ${missing} 張還沒登記金額，點卡片上的「輸入金額」補上`
      : '👇 繳完直接點卡片上的按鈕',
  );

  // One key per day per set of cards, so changing amounts mid-day does not
  // trigger a second push.
  const key = `bill:${dateKey(now)}:${due.map((b) => b.statement.id).sort().join(',')}`;
  const cards = billActionMessage(due);
  return { key, body: lines.join('\n'), extra: cards ? [cards] : undefined };
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
    lines.push(`・${eventWhen(event)} ${event.title}`);
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
 * Fire the per-event and per-todo reminders that have come due, for
 * /api/cron/events (the `remindMinutes` on an Event or a Todo).
 *
 * Deliberately not written as a "did this fall inside the last N minutes"
 * window: an external poller can be late, drop a beat, or be reconfigured, and
 * a window would silently swallow the reminder every time that happened. This
 * asks "is it past time and has the event not started yet", so a late poll
 * still delivers, and the ReminderLog key keeps it to once.
 *
 * The consequence is that a reminder can arrive later than requested. The text
 * reports the real time remaining rather than the configured offset, so it
 * never claims to be 30 minutes ahead when it is 8.
 */
export async function runEventReminders(
  { now = new Date(), dryRun = false }: { now?: Date; dryRun?: boolean } = {},
): Promise<ReminderRun & { checked: number }> {
  const run: ReminderRun & { checked: number } = {
    slot: 'morning',
    pushed: [],
    skipped: [],
    errors: [],
    checked: 0,
  };

  // The furthest ahead any reminder can be asked for, so the query stays small.
  const horizon = addDays(now, 31);
  const events = await prisma.event.findMany({
    where: { startsAt: { gt: now, lte: horizon }, category: { not: 'bill' } },
    orderBy: { startsAt: 'asc' },
  });
  run.checked += events.length;

  for (const event of events) {
    for (const minutes of event.remindMinutes) {
      const fireAt = new Date(event.startsAt.getTime() - minutes * 60_000);
      if (fireAt > now) continue;
      await fireItemReminder(`event:${event.id}:${minutes}`, eventReminderText(event, now), dryRun, run);
    }
  }

  // Same due-and-not-fired check as events, keyed on the todo instead of a
  // fixed morning digest slot, so "remind me 2 hours before" means what it says.
  const todos = await prisma.todo.findMany({
    where: { done: false, dueAt: { gt: now, lte: horizon } },
    orderBy: { dueAt: 'asc' },
  });
  run.checked += todos.length;

  for (const todo of todos) {
    if (!todo.dueAt) continue;
    for (const minutes of todo.remindMinutes) {
      const fireAt = new Date(todo.dueAt.getTime() - minutes * 60_000);
      if (fireAt > now) continue;
      await fireItemReminder(`todo:${todo.id}:${minutes}`, todoReminderText(todo, now), dryRun, run);
    }
  }

  return run;
}

/** Shared send-once-and-record logic for the per-event and per-todo reminders above. */
async function fireItemReminder(
  key: string,
  body: string,
  dryRun: boolean,
  run: ReminderRun,
): Promise<void> {
  try {
    const already = await prisma.reminderLog.findUnique({ where: { key } });
    if (already) {
      run.skipped.push(key);
      return;
    }
    if (!dryRun) {
      if (!lineConfigured()) {
        run.errors.push('LINE 未設定，略過推播');
        return;
      }
      await pushMessage([text(body, DEFAULT_QUICK_REPLIES)]);
      await prisma.reminderLog.create({ data: { key } });
    }
    run.pushed.push(key);
  } catch (error) {
    run.errors.push(`${key}: ${message(error)}`);
  }
}

function eventReminderText(
  event: { title: string; startsAt: Date; allDay: boolean; location: string | null },
  now: Date,
): string {
  const left = Math.max(0, Math.round((event.startsAt.getTime() - now.getTime()) / 60_000));
  const when = left >= 60 ? `${Math.floor(left / 60)} 小時 ${left % 60} 分鐘後` : `${left} 分鐘後`;

  const lines = [`🔔 ${when}：${event.title}`, '', `🕐 ${formatShortZh(event.startsAt, !event.allDay)}`];
  if (event.location) lines.push(`📍 ${event.location}`);
  return lines.join('\n');
}

function todoReminderText(todo: { title: string; dueAt: Date | null }, now: Date): string {
  const left = todo.dueAt ? Math.max(0, Math.round((todo.dueAt.getTime() - now.getTime()) / 60_000)) : 0;
  const when = left >= 60 ? `${Math.floor(left / 60)} 小時 ${left % 60} 分鐘後` : `${left} 分鐘後`;
  return [`🔔 ${when}到期：${todo.title}`, '', `🕐 ${todo.dueAt ? formatShortZh(todo.dueAt, true) : ''}`].join(
    '\n',
  );
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
