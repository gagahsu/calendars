import { NextResponse } from 'next/server';
import { prisma, toNum } from '@/lib/db';
import {
  DEFAULT_QUICK_REPLIES,
  isOwner,
  replyMessage,
  text,
  verifyLineSignature,
} from '@/lib/line';
import { HELP_TEXT, parseCommand, type Command } from '@/lib/parser';
import {
  billsText,
  cardListText,
  dayAgendaText,
  expenseReceiptText,
  money,
  openTodos,
  summaryText,
  todoListText,
  weekAgendaText,
} from '@/lib/agenda';
import { categoryEmoji } from '@/lib/categories';
import {
  findCardByHint,
  refreshStatementEvent,
  syncStatements,
  targetStatementFor,
  upcomingBills,
} from '@/lib/billing';
import {
  addDays,
  formatShortZh,
  periodKey,
  periodRange,
  startOfTaipeiDay,
} from '@/lib/date';
import { getInsight, insightToText } from '@/lib/insights';

export const dynamic = 'force-dynamic';

type LineEvent = {
  type: string;
  replyToken?: string;
  source?: { userId?: string; type?: string };
  message?: { type: string; text?: string };
};

export async function POST(request: Request) {
  // The signature is computed over the raw bytes — never re-serialise first.
  const raw = await request.text();
  if (!verifyLineSignature(raw, request.headers.get('x-line-signature'))) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  let payload: { events?: LineEvent[] };
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  for (const event of payload.events ?? []) {
    try {
      await handleEvent(event);
    } catch (error) {
      // Always 200 back to LINE: a non-2xx makes it retry, which would
      // duplicate whatever did succeed.
      console.error('[line] event failed', error);
      if (event.replyToken) {
        await replyMessage(event.replyToken, `😵 處理時發生錯誤：${message(error)}`).catch(
          () => undefined,
        );
      }
    }
  }

  return NextResponse.json({ ok: true });
}

async function handleEvent(event: LineEvent): Promise<void> {
  const userId = event.source?.userId;

  if (event.type === 'follow' && event.replyToken) {
    await replyMessage(event.replyToken, [
      text(
        [
          '👋 歡迎使用個人行事曆助理！',
          '',
          `你的 LINE userId：`,
          userId ?? '(取不到)',
          '',
          '請把它設定到環境變數 LINE_USER_ID，之後才會收到繳費提醒。',
          '',
          HELP_TEXT,
        ].join('\n'),
        DEFAULT_QUICK_REPLIES,
      ),
    ]);
    return;
  }

  if (event.type !== 'message' || event.message?.type !== 'text' || !event.replyToken) return;
  const body = event.message.text ?? '';

  if (!isOwner(userId)) {
    // Before LINE_USER_ID is configured, echo the id so setup can finish.
    const owner = process.env.LINE_USER_ID;
    await replyMessage(
      event.replyToken,
      owner
        ? '這個機器人只服務擁有者。'
        : `尚未綁定擁有者。請將以下 userId 設定到 LINE_USER_ID：\n${userId ?? '(取不到)'}`,
    );
    return;
  }

  const now = new Date();
  // Pasting several "記 ..." lines at once (e.g. copying a statement) is a
  // real workflow — treat multiple non-empty lines as one command per line
  // instead of failing the whole message as unparseable.
  const lines = body.split('\n').map((line) => line.trim()).filter(Boolean);
  const reply =
    lines.length > 1 ? await runBatch(lines, now) : await runCommand(parseCommand(body, now), now);
  await replyMessage(event.replyToken, [text(reply, DEFAULT_QUICK_REPLIES)]);
}

async function runBatch(lines: string[], now: Date): Promise<string> {
  const results: string[] = [];
  let expenseTotal = 0;
  let expenseCount = 0;

  for (const line of lines) {
    const command = parseCommand(line, now);
    if (command.kind === 'unknown') {
      results.push(`❓ 看不懂：${line}`);
      continue;
    }
    if (command.kind !== 'expense') {
      // Non-expense commands still run for real, just summarised to one line.
      const reply = await runCommand(command, now);
      results.push(reply.split('\n')[0]);
      continue;
    }

    const { cardName, cardMissing } = await recordExpense(command);
    expenseTotal += command.amount;
    expenseCount += 1;
    const warn = cardMissing ? ` ⚠️找不到卡片「${command.cardHint}」` : '';
    results.push(
      [
        `${categoryEmoji(command.category)} ${money(command.amount)}`,
        command.merchant,
        formatShortZh(command.spentAt),
        cardName,
      ]
        .filter(Boolean)
        .join(' ｜ ') + warn,
    );
  }

  const header =
    expenseCount > 0
      ? `📋 批次處理 ${lines.length} 行，${expenseCount} 筆消費合計 ${money(expenseTotal)}`
      : `📋 批次處理 ${lines.length} 行`;
  return [header, '', ...results].join('\n');
}

/** Shared by the single-command and batch paths: look up the card and write the row. */
async function recordExpense(
  command: Extract<Command, { kind: 'expense' }>,
): Promise<{ cardId: string | null; cardName: string | null; cardMissing: boolean }> {
  let cardId: string | null = null;
  let cardName: string | null = null;
  if (command.cardHint) {
    const card = await findCardByHint(command.cardHint);
    if (card) {
      cardId = card.id;
      cardName = card.name;
    }
  }

  await prisma.expense.create({
    data: {
      amount: command.amount,
      category: command.category,
      merchant: command.merchant,
      spentAt: command.spentAt,
      cardId,
      source: 'line',
    },
  });

  return { cardId, cardName, cardMissing: !!command.cardHint && !cardId };
}

async function runCommand(command: Command, now: Date): Promise<string> {
  switch (command.kind) {
    case 'help':
      return HELP_TEXT;

    case 'agenda': {
      if (command.range === 'week') return weekAgendaText(now);
      const day = command.range === 'tomorrow' ? addDays(startOfTaipeiDay(now), 1) : now;
      return dayAgendaText(day);
    }

    case 'summary':
      return summaryText(now);

    case 'bills':
      return billsText(now);

    case 'card_list':
      return cardListText();

    case 'todo_list':
      return todoListText(now);

    case 'expense': {
      const { cardName, cardMissing } = await recordExpense(command);

      const { start, end } = periodRange(periodKey(command.spentAt));
      const monthly = await prisma.expense.aggregate({
        where: { spentAt: { gte: start, lt: end } },
        _sum: { amount: true },
      });

      const receipt = expenseReceiptText({
        amount: command.amount,
        category: command.category,
        merchant: command.merchant,
        spentAt: command.spentAt,
        cardName,
        monthTotal: toNum(monthly._sum.amount) ?? 0,
      });
      const warning = cardMissing ? `\n\n⚠️ 找不到卡片「${command.cardHint}」，這筆先記為現金。` : '';
      return receipt + warning;
    }

    case 'todo_add': {
      const todo = await prisma.todo.create({
        data: { title: command.title, dueAt: command.dueAt },
      });
      const due = todo.dueAt ? `\n期限：${formatShortZh(todo.dueAt, true)}` : '';
      return `✅ 已加入待辦：${todo.title}${due}`;
    }

    case 'todo_done': {
      const todos = await openTodos();
      if (todos.length === 0) return '待辦清單是空的，沒有可以完成的項目。';

      const index = /^\d+$/.test(command.ref) ? Number(command.ref) - 1 : -1;
      let target = index >= 0 && index < todos.length ? todos[index] : undefined;
      if (!target) {
        const needle = command.ref.toLowerCase();
        const matches = todos.filter((todo) => todo.title.toLowerCase().includes(needle));
        if (matches.length === 1) target = matches[0];
        else if (matches.length > 1) {
          return ['有多個符合的待辦，請用編號指定：', ...matches.map((m) => `・${m.title}`)].join('\n');
        }
      }
      if (!target) return `找不到「${command.ref}」這個待辦。傳「待辦」可以看清單。`;

      await prisma.todo.update({
        where: { id: target.id },
        data: { done: true, doneAt: new Date() },
      });
      const remaining = await prisma.todo.count({ where: { done: false } });
      return `🎉 完成：${target.title}\n還剩 ${remaining} 件待辦。`;
    }

    case 'event_add': {
      const event = await prisma.event.create({
        data: {
          title: command.title,
          startsAt: command.startsAt,
          allDay: command.allDay,
          // Non-all-day events get a 30-minute heads-up by default.
          remindMinutes: command.allDay ? [] : [30],
        },
      });
      return `🗓 已新增行程：${event.title}\n時間：${formatShortZh(event.startsAt, !event.allDay)}${
        event.allDay ? '（全天）' : ''
      }`;
    }

    case 'bill_amount': {
      const card = await findCardByHint(command.cardHint);
      if (!card) return await cardNotFound(command.cardHint);

      await syncStatements(card);
      const statement = await targetStatementFor(card.id, now);
      if (!statement) return `${card.name} 目前沒有待繳的帳單。`;

      await prisma.statement.update({
        where: { id: statement.id },
        data: { amount: command.amount },
      });
      await refreshStatementEvent(statement.id);

      const days = Math.ceil((statement.dueAt.getTime() - now.getTime()) / (24 * 60 * 60_000));
      return [
        `💳 已登記 ${card.name} ${statement.period} 帳單`,
        `金額 NT$${Math.round(command.amount).toLocaleString('en-US')}`,
        `繳款期限 ${formatShortZh(statement.dueAt)}${days >= 0 ? `（還有 ${days} 天）` : '（已逾期）'}`,
      ].join('\n');
    }

    case 'bill_paid': {
      const card = await findCardByHint(command.cardHint);
      if (!card) return await cardNotFound(command.cardHint);

      const statement = await targetStatementFor(card.id, now);
      if (!statement) return `${card.name} 沒有未繳的帳單，不用再繳了 👍`;

      await prisma.statement.update({
        where: { id: statement.id },
        data: { paid: true, paidAt: new Date(), paidAmount: statement.amount },
      });
      await refreshStatementEvent(statement.id);

      const amount = toNum(statement.amount);
      // Only count deadlines the user can act on — statements that have not
      // closed yet are not "unpaid" in any useful sense.
      const remaining = (await upcomingBills({ withinDays: 45, now })).length;
      return [
        `✅ 已標記 ${card.name} ${statement.period} 帳單為已繳`,
        amount ? `金額 NT$${Math.round(amount).toLocaleString('en-US')}` : '（金額未登記）',
        remaining > 0 ? `還有 ${remaining} 筆未繳帳單，傳「帳單」查看。` : '所有帳單都繳完了 🎉',
      ].join('\n');
    }

    case 'card_add': {
      const existing = await prisma.card.findUnique({ where: { name: command.name } });
      if (existing) return `已經有一張叫「${command.name}」的卡片了。`;

      const card = await prisma.card.create({
        data: {
          name: command.name,
          statementDay: command.statementDay,
          dueDay: command.dueDay,
        },
      });
      await syncStatements(card);
      const next = await targetStatementFor(card.id, now);
      return [
        `💳 已新增卡片：${card.name}`,
        `每月 ${card.statementDay} 日結帳、次月 ${card.dueDay} 日繳費`,
        `提醒時間：到期前 ${card.remindDaysBefore.join('、')} 天`,
        next ? `下次繳款：${formatShortZh(next.dueAt)}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    }

    case 'insight': {
      const period = command.period ?? periodKey(now);
      const { insight, model } = await getInsight(period, { now });
      return `${insightToText(insight)}\n\n— 由 ${model} 分析`;
    }

    case 'unknown':
    default:
      return [
        '🤔 看不懂這個指令。',
        '',
        '常用的幾個：',
        '・記 120 午餐',
        '・待辦 繳水電費 明天',
        '・帳單',
        '・分析',
        '',
        '傳「說明」看完整用法。',
      ].join('\n');
  }
}

async function cardNotFound(hint: string): Promise<string> {
  const cards = await prisma.card.findMany({ where: { active: true }, select: { name: true } });
  if (cards.length === 0) {
    return ['還沒有設定任何卡片。', '', '新增方式：', '新增卡片 國泰CUBE 結帳15 繳費5'].join('\n');
  }
  return [
    `找不到卡片「${hint}」，或名稱不夠明確。`,
    '',
    '目前有這些卡片：',
    ...cards.map((card) => `・${card.name}`),
  ].join('\n');
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
