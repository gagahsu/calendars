import type { Card, Statement } from '@prisma/client';
import { prisma } from './db';
import {
  addMonths,
  daysInMonth,
  fromTaipei,
  parsePeriodKey,
  periodKey,
  toTaipeiParts,
  daysBetween,
  formatShortZh,
} from './date';

/**
 * A card says "statement closes on the 15th, payment due on the 5th of the
 * next month". Because months are 28-31 days long, a `dueDay` of 31 has to be
 * pulled back to the last day of a short month.
 */
export function clampDay(year: number, month: number, day: number): number {
  return Math.min(Math.max(day, 1), daysInMonth(year, month));
}

export type CardBillingRules = Pick<Card, 'statementDay' | 'dueDay' | 'dueNextMonth'>;

/** The statement closing instant (00:00 Taipei) for a `YYYY-MM` period. */
export function statementCloseDate(card: CardBillingRules, period: string): Date {
  const parsed = parsePeriodKey(period);
  if (!parsed) throw new Error(`invalid period: ${period}`);
  const day = clampDay(parsed.year, parsed.month, card.statementDay);
  return fromTaipei(parsed.year, parsed.month, day, 0, 0);
}

/** The payment deadline (00:00 Taipei) for the statement that closed in `period`. */
export function dueDateFor(card: CardBillingRules, period: string): Date {
  const parsed = parsePeriodKey(period);
  if (!parsed) throw new Error(`invalid period: ${period}`);
  const target = card.dueNextMonth ? addMonths(period, 1) : period;
  const t = parsePeriodKey(target)!;
  const day = clampDay(t.year, t.month, card.dueDay);
  return fromTaipei(t.year, t.month, day, 0, 0);
}

/**
 * The period of the statement that is currently "open" — i.e. spending today
 * lands on this statement.
 */
export function openPeriodFor(card: CardBillingRules, now: Date = new Date()): string {
  const p = toTaipeiParts(now);
  const close = clampDay(p.year, p.month, card.statementDay);
  // Past this month's closing day, today's spend belongs to next month's bill.
  return p.day > close ? addMonths(periodKey(now), 1) : periodKey(now);
}

/**
 * Create (or refresh) the Statement rows for a card covering `monthsBack`
 * previous periods through `monthsAhead` future periods, and mirror each due
 * date onto the calendar as a `bill` event.
 *
 * Idempotent: safe to call on every card write and from the cron job.
 */
export async function syncStatements(
  card: Card,
  {
    monthsBack = 2,
    monthsAhead = 3,
    now = new Date(),
  }: { monthsBack?: number; monthsAhead?: number; now?: Date } = {},
): Promise<void> {
  const current = openPeriodFor(card, now);
  const periods: string[] = [];
  for (let i = -monthsBack; i <= monthsAhead; i += 1) periods.push(addMonths(current, i));

  for (const period of periods) {
    const dueAt = dueDateFor(card, period);
    const existing = await prisma.statement.findUnique({
      where: { cardId_period: { cardId: card.id, period } },
      include: { event: true },
    });

    if (existing) {
      // Card rules may have changed (e.g. the user fixed the due day).
      if (existing.dueAt.getTime() !== dueAt.getTime()) {
        await prisma.statement.update({ where: { id: existing.id }, data: { dueAt } });
      }
      if (existing.eventId) {
        await prisma.event.update({
          where: { id: existing.eventId },
          data: {
            startsAt: dueAt,
            title: billEventTitle(card, existing.amount, existing.paid),
            category: 'bill',
          },
        });
      } else {
        const event = await createBillEvent(card, dueAt, existing.amount, existing.paid);
        await prisma.statement.update({
          where: { id: existing.id },
          data: { eventId: event.id },
        });
      }
      continue;
    }

    // A row we are only now creating for a deadline that already passed is
    // history we know nothing about — treat it as settled rather than nagging
    // the user about payments they never told us were late.
    const settled = dueAt.getTime() < startOfToday(now).getTime();
    const event = await createBillEvent(card, dueAt, null, settled);
    await prisma.statement.create({
      data: {
        cardId: card.id,
        period,
        dueAt,
        eventId: event.id,
        paid: settled,
        paidAt: settled ? new Date() : null,
      },
    });
  }
}

export function billEventTitle(card: Pick<Card, 'name'>, amount: unknown, paid: boolean): string {
  const value = amount === null || amount === undefined ? null : Number(amount.toString());
  const money = value ? ` NT$${Math.round(value).toLocaleString('en-US')}` : '';
  return paid ? `✅ ${card.name} 已繳${money}` : `${card.name} 繳費${money}`;
}

async function createBillEvent(card: Card, dueAt: Date, amount: unknown, paid: boolean) {
  return prisma.event.create({
    data: {
      title: billEventTitle(card, amount, paid),
      startsAt: dueAt,
      allDay: true,
      category: 'bill',
      note: card.last4 ? `卡號末四碼 ${card.last4}` : null,
    },
  });
}

/** Remove the mirrored calendar events belonging to a card's statements. */
export async function deleteCardEvents(cardId: string): Promise<void> {
  const statements = await prisma.statement.findMany({
    where: { cardId, NOT: { eventId: null } },
    select: { eventId: true },
  });
  const eventIds = statements.map((s) => s.eventId!).filter(Boolean);
  if (eventIds.length > 0) {
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  }
}

/** Re-render the mirrored calendar event after a statement's amount/paid changes. */
export async function refreshStatementEvent(statementId: string): Promise<void> {
  const statement = await prisma.statement.findUnique({
    where: { id: statementId },
    include: { card: true },
  });
  if (!statement?.eventId) return;
  await prisma.event.update({
    where: { id: statement.eventId },
    data: {
      title: billEventTitle(statement.card, statement.amount, statement.paid),
      startsAt: statement.dueAt,
    },
  });
}

/**
 * Resolve a loosely-typed card name from LINE ("國泰", "cube") to a card.
 * Exact match wins, then prefix, then substring; ambiguous hints return null.
 */
export async function findCardByHint(hint: string): Promise<Card | null> {
  const needle = hint.trim().toLowerCase();
  if (!needle) return null;
  const cards = await prisma.card.findMany({ where: { active: true } });
  if (cards.length === 0) return null;

  const exact = cards.filter((card) => card.name.toLowerCase() === needle);
  if (exact.length === 1) return exact[0];

  const prefixed = cards.filter((card) => card.name.toLowerCase().startsWith(needle));
  if (prefixed.length === 1) return prefixed[0];

  const contained = cards.filter(
    (card) =>
      card.name.toLowerCase().includes(needle) ||
      needle.includes(card.name.toLowerCase()) ||
      (card.issuer ?? '').toLowerCase().includes(needle) ||
      (card.last4 ?? '') === needle,
  );
  return contained.length === 1 ? contained[0] : null;
}

/**
 * The statement a bare "帳單 國泰 3200" should apply to: the closest unpaid
 * deadline, falling back to the most recently closed period.
 */
export async function targetStatementFor(
  cardId: string,
  now: Date = new Date(),
): Promise<Statement | null> {
  const unpaid = await prisma.statement.findFirst({
    where: { cardId, paid: false, dueAt: { gte: startOfToday(now) } },
    orderBy: { dueAt: 'asc' },
  });
  if (unpaid) return unpaid;
  return prisma.statement.findFirst({
    where: { cardId, paid: false },
    orderBy: { dueAt: 'desc' },
  });
}

function startOfToday(now: Date): Date {
  const p = toTaipeiParts(now);
  return fromTaipei(p.year, p.month, p.day, 0, 0);
}

export type UpcomingBill = {
  statement: Statement;
  card: Card;
  daysLeft: number;
  overdue: boolean;
};

/**
 * Unpaid statements ordered by urgency: anything overdue first, then the next
 * `withinDays` of deadlines.
 */
export async function upcomingBills(
  { withinDays = 45, now = new Date() }: { withinDays?: number; now?: Date } = {},
): Promise<UpcomingBill[]> {
  const horizon = new Date(now.getTime() + withinDays * 24 * 60 * 60_000);
  const statements = await prisma.statement.findMany({
    where: { paid: false, dueAt: { lte: horizon }, card: { active: true } },
    include: { card: true },
    orderBy: { dueAt: 'asc' },
  });

  return statements.map((statement) => {
    const daysLeft = daysBetween(now, statement.dueAt);
    return { statement, card: statement.card, daysLeft, overdue: daysLeft < 0 };
  });
}

/** Human-readable urgency line, reused by the web UI and the LINE bot. */
export function billStatusText(bill: UpcomingBill): string {
  const when = formatShortZh(bill.statement.dueAt);
  if (bill.overdue) return `${when} 已逾期 ${Math.abs(bill.daysLeft)} 天`;
  if (bill.daysLeft === 0) return `${when} 今天到期`;
  if (bill.daysLeft === 1) return `${when} 明天到期`;
  return `${when} 還有 ${bill.daysLeft} 天`;
}
