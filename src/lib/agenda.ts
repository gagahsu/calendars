import { prisma, toNum } from './db';
import {
  addDays,
  dateKey,
  daysBetween,
  formatShortZh,
  periodKey,
  periodRange,
  startOfTaipeiDay,
  timeKey,
} from './date';
import { billStatusText, upcomingBills } from './billing';
import { categoryEmoji, categoryLabel } from './categories';

/**
 * Text renderers shared by the LINE bot (on demand) and the cron job (pushed).
 * Keeping them here means a reminder and a `今天` query read identically.
 */

const money = (value: number) => `NT$${Math.round(value).toLocaleString('en-US')}`;

export async function dayAgendaText(day: Date): Promise<string> {
  const start = startOfTaipeiDay(day);
  const end = addDays(start, 1);

  const [events, todos] = await Promise.all([
    prisma.event.findMany({
      where: { startsAt: { gte: start, lt: end } },
      orderBy: [{ allDay: 'desc' }, { startsAt: 'asc' }],
    }),
    prisma.todo.findMany({
      where: { done: false, dueAt: { lt: end } },
      orderBy: [{ dueAt: 'asc' }, { priority: 'asc' }],
      take: 10,
    }),
  ]);

  const lines = [`🗓 ${formatShortZh(start)} 行程`];
  if (events.length === 0) {
    lines.push('・沒有安排');
  } else {
    for (const event of events) {
      const when = event.allDay ? '全天' : timeKey(event.startsAt);
      const mark = event.category === 'bill' ? '💳' : '・';
      lines.push(`${mark} ${when} ${event.title}`);
    }
  }

  if (todos.length > 0) {
    lines.push('', '✅ 待辦');
    for (const todo of todos) {
      const overdue = todo.dueAt && daysBetween(start, todo.dueAt) < 0 ? '（逾期）' : '';
      lines.push(`・${todo.title}${overdue}`);
    }
  }

  return lines.join('\n');
}

export async function weekAgendaText(now: Date): Promise<string> {
  const start = startOfTaipeiDay(now);
  const end = addDays(start, 7);

  const [events, todos] = await Promise.all([
    prisma.event.findMany({
      where: { startsAt: { gte: start, lt: end } },
      orderBy: [{ startsAt: 'asc' }],
    }),
    prisma.todo.findMany({
      where: { done: false, dueAt: { gte: start, lt: end } },
      orderBy: [{ dueAt: 'asc' }],
    }),
  ]);

  const byDay = new Map<string, string[]>();
  for (const event of events) {
    const key = dateKey(event.startsAt);
    const when = event.allDay ? '全天' : timeKey(event.startsAt);
    const mark = event.category === 'bill' ? '💳' : '・';
    push(byDay, key, `${mark} ${when} ${event.title}`);
  }
  for (const todo of todos) {
    if (!todo.dueAt) continue;
    push(byDay, dateKey(todo.dueAt), `☑️ ${todo.title}`);
  }

  const lines = ['🗓 未來七天'];
  for (let i = 0; i < 7; i += 1) {
    const day = addDays(start, i);
    const entries = byDay.get(dateKey(day));
    if (!entries || entries.length === 0) continue;
    lines.push('', `${formatShortZh(day)}`);
    lines.push(...entries);
  }
  if (lines.length === 1) lines.push('・這七天沒有任何安排');
  return lines.join('\n');
}

export async function billsText(now: Date): Promise<string> {
  const bills = await upcomingBills({ withinDays: 60, now });
  if (bills.length === 0) return '💳 目前沒有未繳的信用卡帳單。';

  const lines = ['💳 未繳帳單'];
  let total = 0;
  for (const bill of bills) {
    const amount = toNum(bill.statement.amount);
    if (amount) total += amount;
    const amountText = amount ? money(amount) : '金額未登記';
    const flag = bill.overdue ? '🔴' : bill.daysLeft <= 3 ? '🟠' : '🟢';
    const autoPay = bill.card.autoPay ? '（自動扣繳）' : '';
    lines.push(`${flag} ${bill.card.name}｜${amountText}`);
    lines.push(`   ${billStatusText(bill)}${autoPay}`);
  }
  if (total > 0) lines.push('', `合計 ${money(total)}`);
  lines.push('', '登記金額：帳單 國泰 3200');
  lines.push('標記已繳：已繳 國泰');
  return lines.join('\n');
}

/**
 * The canonical open-todo ordering. The LINE bot numbers todos with this list,
 * so `完成 2` must resolve against exactly the same query that rendered it.
 */
export function openTodos(limit = 20) {
  return prisma.todo.findMany({
    where: { done: false },
    orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { priority: 'asc' }, { createdAt: 'asc' }],
    take: limit,
  });
}

export async function todoListText(now: Date): Promise<string> {
  const todos = await openTodos();
  if (todos.length === 0) return '✅ 待辦清單是空的。';

  const lines = ['✅ 待辦清單'];
  todos.forEach((todo, index) => {
    const priority = todo.priority === 1 ? '❗' : '';
    let due = '';
    if (todo.dueAt) {
      const left = daysBetween(now, todo.dueAt);
      due =
        left < 0
          ? `（逾期 ${Math.abs(left)} 天）`
          : left === 0
            ? '（今天）'
            : left === 1
              ? '（明天）'
              : `（${formatShortZh(todo.dueAt)}）`;
    }
    lines.push(`${index + 1}. ${priority}${todo.title}${due}`);
  });
  lines.push('', '完成請傳：完成 1');
  return lines.join('\n');
}

export async function cardListText(): Promise<string> {
  const cards = await prisma.card.findMany({ orderBy: { name: 'asc' } });
  if (cards.length === 0) {
    return ['💳 還沒有設定任何卡片。', '', '新增方式：', '新增卡片 國泰CUBE 結帳15 繳費5'].join('\n');
  }
  const lines = ['💳 卡片設定'];
  for (const card of cards) {
    const status = card.active ? '' : '（已停用）';
    const dueMonth = card.dueNextMonth ? '次月' : '當月';
    lines.push(`・${card.name}${card.last4 ? ` (${card.last4})` : ''}${status}`);
    lines.push(`   每月 ${card.statementDay} 日結帳、${dueMonth} ${card.dueDay} 日繳費`);
    lines.push(
      `   提醒：到期前 ${card.remindDaysBefore.join('、')} 天${card.autoPay ? '｜自動扣繳' : ''}`,
    );
  }
  return lines.join('\n');
}

/** Everything at a glance: today, bills, overdue todos, month-to-date spend. */
export async function summaryText(now: Date): Promise<string> {
  const start = startOfTaipeiDay(now);
  const monthStart = periodRange(periodKey(now)).start;

  const [bills, events, todos, spend] = await Promise.all([
    upcomingBills({ withinDays: 14, now }),
    prisma.event.count({ where: { startsAt: { gte: start, lt: addDays(start, 1) } } }),
    prisma.todo.count({ where: { done: false } }),
    prisma.expense.aggregate({
      where: { spentAt: { gte: monthStart } },
      _sum: { amount: true },
      _count: true,
    }),
  ]);

  const lines = [`📌 ${formatShortZh(start)} 總覽`, ''];
  const total = toNum(spend._sum.amount) ?? 0;
  lines.push(`本月支出 ${money(total)}（${spend._count} 筆）`);
  lines.push(`今日行程 ${events} 件｜待辦 ${todos} 件`);

  if (bills.length === 0) {
    lines.push('', '💳 近兩週沒有要繳的帳單');
  } else {
    lines.push('', '💳 近期帳單');
    for (const bill of bills) {
      const amount = toNum(bill.statement.amount);
      lines.push(`・${bill.card.name} ${amount ? money(amount) : '金額未登記'}｜${billStatusText(bill)}`);
    }
  }
  return lines.join('\n');
}

/** One-line receipt after logging an expense. */
export function expenseReceiptText(input: {
  amount: number;
  category: string;
  merchant: string | null;
  spentAt: Date;
  cardName: string | null;
  monthTotal: number;
}): string {
  const parts = [
    `${categoryEmoji(input.category)} 已記帳 ${money(input.amount)}`,
    `${categoryLabel(input.category)}${input.merchant ? `｜${input.merchant}` : ''}`,
    `${formatShortZh(input.spentAt)}${input.cardName ? `｜${input.cardName}` : ''}`,
    `本月累計 ${money(input.monthTotal)}`,
  ];
  return parts.join('\n');
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
