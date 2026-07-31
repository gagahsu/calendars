import { prisma, toNum } from './db';
import { addMonths, dateKey, periodKey, periodRange, toTaipeiParts } from './date';
import { CATEGORIES, categoryLabel } from './categories';
import { chat, extractJson, openRouterConfigured, OpenRouterError } from './openrouter';
import { statementCycleRange, trackedSpendFor } from './billing';

export type CategoryBreakdown = {
  key: string;
  label: string;
  total: number;
  count: number;
  share: number; // 0-1 of the month's total
  prevTotal: number;
  delta: number; // total - prevTotal
};

export type MonthlyStats = {
  period: string;
  total: number;
  count: number;
  days: number; // days elapsed in the period (full month length for past months)
  dailyAverage: number;
  projectedTotal: number; // straight-line projection for the current month
  budget: number | null;
  prevPeriod: string;
  prevTotal: number;
  categories: CategoryBreakdown[];
  topMerchants: Array<{ merchant: string; total: number; count: number }>;
  byCard: Array<{ card: string; total: number; count: number }>;
  /** Merchants charged in 3 consecutive months — likely subscriptions. */
  recurring: Array<{ merchant: string; monthlyAverage: number; months: number }>;
  billTotal: number;
  /**
   * Per statement, the bill against what was logged inside the cycle it
   * actually bills for. `billTotal` alone invites a comparison with the
   * calendar-month total that means nothing: a 2026-07 statement closing on
   * the 12th is mostly June's spending, so the two figures are never expected
   * to match and reading a shortfall into the difference is a false alarm.
   */
  billCoverage: Array<{
    card: string;
    period: string;
    amount: number | null;
    tracked: number;
    cycleStart: string;
    cycleEnd: string;
  }>;
  unpaidBills: Array<{ card: string; period: string; amount: number | null; dueAt: string }>;
};

export type Tip = {
  title: string;
  detail: string;
  /** Estimated monthly saving in TWD, as judged by the model. */
  monthlySaving: number | null;
};

export type InsightPayload = {
  summary: string;
  highlights: string[];
  tips: Tip[];
  warnings: string[];
  stats: MonthlyStats;
  fingerprint: string;
  generatedAt: string;
};

/** Collect every number the analysis needs, with no AI involved. */
export async function buildMonthlyStats(
  period: string,
  now: Date = new Date(),
): Promise<MonthlyStats> {
  const prevPeriod = addMonths(period, -1);
  const { start, end } = periodRange(period);
  const prev = periodRange(prevPeriod);

  const [expenses, prevExpenses, cards, statements] = await Promise.all([
    prisma.expense.findMany({
      where: { spentAt: { gte: start, lt: end } },
      include: { card: { select: { name: true } } },
    }),
    prisma.expense.findMany({ where: { spentAt: { gte: prev.start, lt: prev.end } } }),
    prisma.card.findMany({ where: { active: true }, select: { id: true, name: true } }),
    prisma.statement.findMany({
      where: { period },
      // The billing-rule fields come along so each statement's real cycle can
      // be worked out, not just its name.
      include: {
        card: {
          select: { name: true, statementDay: true, dueDay: true, dueNextMonth: true },
        },
      },
    }),
  ]);

  const total = sum(expenses.map((e) => toNum(e.amount) ?? 0));
  const prevTotal = sum(prevExpenses.map((e) => toNum(e.amount) ?? 0));

  // For the month in progress, average over elapsed days only.
  const isCurrent = period === periodKey(now);
  const monthLength = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60_000));
  const days = isCurrent ? Math.max(1, toTaipeiParts(now).day) : monthLength;
  const dailyAverage = total / days;

  const prevByCategory = new Map<string, number>();
  for (const expense of prevExpenses) {
    prevByCategory.set(
      expense.category,
      (prevByCategory.get(expense.category) ?? 0) + (toNum(expense.amount) ?? 0),
    );
  }

  const categories: CategoryBreakdown[] = CATEGORIES.map(({ key, label }) => {
    const matching = expenses.filter((e) => e.category === key);
    const catTotal = sum(matching.map((e) => toNum(e.amount) ?? 0));
    const prevCatTotal = prevByCategory.get(key) ?? 0;
    return {
      key,
      label,
      total: round(catTotal),
      count: matching.length,
      share: total > 0 ? catTotal / total : 0,
      prevTotal: round(prevCatTotal),
      delta: round(catTotal - prevCatTotal),
    };
  })
    .filter((c) => c.total > 0 || c.prevTotal > 0)
    .sort((a, b) => b.total - a.total);

  const merchantTotals = new Map<string, { total: number; count: number }>();
  for (const expense of expenses) {
    const name = (expense.merchant ?? expense.note ?? '').trim();
    if (!name) continue;
    const entry = merchantTotals.get(name) ?? { total: 0, count: 0 };
    entry.total += toNum(expense.amount) ?? 0;
    entry.count += 1;
    merchantTotals.set(name, entry);
  }
  const topMerchants = [...merchantTotals.entries()]
    .map(([merchant, v]) => ({ merchant, total: round(v.total), count: v.count }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  const cardNames = new Map(cards.map((c) => [c.id, c.name]));
  const cardTotals = new Map<string, { total: number; count: number }>();
  for (const expense of expenses) {
    const name = expense.cardId ? (cardNames.get(expense.cardId) ?? '其他卡') : '現金／其他';
    const entry = cardTotals.get(name) ?? { total: 0, count: 0 };
    entry.total += toNum(expense.amount) ?? 0;
    entry.count += 1;
    cardTotals.set(name, entry);
  }
  const byCard = [...cardTotals.entries()]
    .map(([card, v]) => ({ card, total: round(v.total), count: v.count }))
    .sort((a, b) => b.total - a.total);

  const budgetRaw = Number(process.env.MONTHLY_BUDGET ?? '0');
  const budget = Number.isFinite(budgetRaw) && budgetRaw > 0 ? budgetRaw : null;

  return {
    period,
    total: round(total),
    count: expenses.length,
    days,
    dailyAverage: round(dailyAverage),
    projectedTotal: round(isCurrent ? dailyAverage * monthLength : total),
    budget,
    prevPeriod,
    prevTotal: round(prevTotal),
    categories,
    topMerchants,
    byCard,
    recurring: await findRecurring(period),
    billTotal: round(sum(statements.map((s) => toNum(s.amount) ?? 0))),
    billCoverage: await Promise.all(
      statements.map(async (statement) => {
        const { start, end } = statementCycleRange(statement.card, statement.period);
        return {
          card: statement.card.name,
          period: statement.period,
          amount: toNum(statement.amount),
          tracked: round(await trackedSpendFor(statement.cardId, statement.card, statement.period)),
          cycleStart: dateKey(start),
          cycleEnd: dateKey(end),
        };
      }),
    ),
    unpaidBills: statements
      .filter((s) => !s.paid)
      .map((s) => ({
        card: s.card.name,
        period: s.period,
        amount: toNum(s.amount),
        dueAt: s.dueAt.toISOString(),
      })),
  };
}

/**
 * A merchant billed in each of the last three months at a similar amount is
 * almost always a subscription — the highest-value thing to surface for saving.
 */
async function findRecurring(period: string) {
  const oldest = periodRange(addMonths(period, -2)).start;
  const newest = periodRange(period).end;
  const expenses = await prisma.expense.findMany({
    where: { spentAt: { gte: oldest, lt: newest }, NOT: { merchant: null } },
    select: { merchant: true, amount: true, spentAt: true, category: true },
  });

  const seen = new Map<string, { months: Set<string>; total: number; count: number }>();
  for (const expense of expenses) {
    const merchant = expense.merchant!.trim();
    if (!merchant) continue;
    const entry = seen.get(merchant) ?? { months: new Set<string>(), total: 0, count: 0 };
    entry.months.add(periodKey(expense.spentAt));
    entry.total += toNum(expense.amount) ?? 0;
    entry.count += 1;
    seen.set(merchant, entry);
  }

  return [...seen.entries()]
    .filter(([, v]) => v.months.size >= 3)
    .map(([merchant, v]) => ({
      merchant,
      monthlyAverage: round(v.total / v.months.size),
      months: v.months.size,
    }))
    .sort((a, b) => b.monthlyAverage - a.monthlyAverage)
    .slice(0, 10);
}

const SYSTEM_PROMPT = `你是一位務實的台灣個人理財顧問。使用者會提供某個月份的消費統計 JSON。
請用繁體中文分析，並嚴格輸出符合以下格式的 JSON（不要加任何說明文字或 markdown 標記）：

{
  "summary": "3 到 4 句話總結這個月的消費狀況，要提到具體金額與最大的支出類別",
  "highlights": ["3 到 5 條具體觀察，每條一句話，必須引用資料中的數字"],
  "tips": [
    { "title": "建議標題（12 字內）", "detail": "具體做法，說明為什麼、怎麼做", "monthlySaving": 每月可省下的金額數字或 null }
  ],
  "warnings": ["需要注意的風險，例如帳單逾期、某類別暴增、超出預算。沒有就給空陣列"]
}

分析原則：
- 一切結論都要有資料支撐，資料裡沒有的事情不要編。
- 信用卡帳單的「期別」是結帳週期不是曆月，所以帳單金額與本月支出本來就不會相等，
  兩者的差距不是異常，不要拿來當作漏記或現金流的警告。要談帳單就用
  「帳單與已記錄消費對照」裡同一列的兩個數字比。
- tips 給 3 到 5 條，依可省金額由大到小排列，優先針對訂閱服務、與上月相比暴增的類別、以及高頻小額消費。
- monthlySaving 要保守估計，只填數字（新台幣），沒把握就填 null。
- 金額一律用新台幣，語氣直接、像朋友給建議，不要客套話。
- 若資料筆數很少（少於 5 筆），summary 要說明資料不足、建議多記錄，tips 仍給通用但具體的建議。`;

/**
 * Whether an analysis is worth showing. A model that answers with valid JSON
 * but none of the fields we asked for is no more useful than no answer at all,
 * and treating it as a success is what let an empty shell reach the user: the
 * fallback chain stopped at the first model and the empty result got cached,
 * so every later request replayed it.
 *
 * Shaped to accept both a fresh model response and a stored InsightPayload.
 */
function hasUsableAnalysis(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object') return false;
  const value = parsed as { summary?: unknown; highlights?: unknown; tips?: unknown };
  const summary = typeof value.summary === 'string' ? value.summary.trim() : '';
  if (summary.length < 10) return false;
  return toStringArray(value.highlights).length > 0 || toTips(value.tips).length > 0;
}

function fingerprintOf(stats: MonthlyStats): string {
  return `${stats.count}:${stats.total}:${stats.billTotal}:${stats.unpaidBills.length}`;
}

/**
 * Return the cached analysis when the underlying numbers have not changed,
 * otherwise call the model and cache the result.
 */
export async function getInsight(
  period: string,
  { force = false, now = new Date() }: { force?: boolean; now?: Date } = {},
): Promise<{ insight: InsightPayload; model: string; cached: boolean }> {
  const stats = await buildMonthlyStats(period, now);
  const fingerprint = fingerprintOf(stats);
  const cached = await prisma.insight.findUnique({ where: { period } });

  if (!force && cached) {
    const data = cached.data as unknown as InsightPayload | null;
    // An empty analysis cached before this was guarded would otherwise be
    // served for as long as the numbers held still. Ignoring it here lets the
    // next request quietly replace it.
    if (data?.fingerprint === fingerprint && hasUsableAnalysis(data)) {
      return { insight: { ...data, stats }, model: cached.model, cached: true };
    }
  }

  if (!openRouterConfigured()) {
    // Still useful without a key: hand back the numbers and rule-based notes.
    const fallback = fallbackInsight(stats, fingerprint, '未設定 OPENROUTER_API_KEY，以下為規則分析');
    return { insight: fallback, model: 'rule-based', cached: false };
  }

  try {
    const result = await chat(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(promptPayload(stats)) },
      ],
      // Rejecting an unusable answer here is what moves the chain on to the
      // next model instead of accepting the first thing that parses.
      { json: true, temperature: 0.5, validate: hasUsableAnalysis },
    );

    const parsed = extractJson<{
      summary?: unknown;
      highlights?: unknown;
      tips?: unknown;
      warnings?: unknown;
    }>(result.content);

    // `chat` already applied this, so reaching it means something changed
    // underneath; the rule-based analysis below is a better answer than a
    // placeholder either way.
    if (!hasUsableAnalysis(parsed)) throw new Error('模型回應缺少分析內容');

    const insight: InsightPayload = {
      summary: (parsed!.summary as string).trim(),
      highlights: toStringArray(parsed?.highlights).slice(0, 6),
      tips: toTips(parsed?.tips).slice(0, 6),
      warnings: [...ruleWarnings(stats), ...toStringArray(parsed?.warnings)].slice(0, 6),
      stats,
      fingerprint,
      generatedAt: new Date().toISOString(),
    };

    await prisma.insight.upsert({
      where: { period },
      create: {
        period,
        model: result.model,
        summary: insight.summary,
        data: insight as unknown as object,
      },
      update: {
        model: result.model,
        summary: insight.summary,
        data: insight as unknown as object,
      },
    });

    return { insight, model: result.model, cached: false };
  } catch (error) {
    const reason =
      error instanceof OpenRouterError
        ? `AI 分析失敗（${error.attempts.map((a) => `${a.model}: ${a.error}`).join('；')}）`
        : `AI 分析失敗（${error instanceof Error ? error.message : String(error)}）`;
    // A rate-limited free model should not blank out the page.
    if (cached) {
      const data = cached.data as unknown as InsightPayload | null;
      if (data && hasUsableAnalysis(data)) {
        return {
          insight: { ...data, stats, warnings: [reason, ...data.warnings].slice(0, 6) },
          model: cached.model,
          cached: true,
        };
      }
    }
    return { insight: fallbackInsight(stats, fingerprint, reason), model: 'rule-based', cached: false };
  }
}

/** Trim the stats down to what the model actually needs to reason about. */
function promptPayload(stats: MonthlyStats) {
  return {
    月份: stats.period,
    本月總支出: stats.total,
    上月總支出: stats.prevTotal,
    記錄筆數: stats.count,
    平均每日支出: stats.dailyAverage,
    本月預估總支出: stats.projectedTotal,
    每月預算: stats.budget,
    分類明細: stats.categories.map((c) => ({
      類別: c.label,
      金額: c.total,
      筆數: c.count,
      佔比: `${Math.round(c.share * 100)}%`,
      上月金額: c.prevTotal,
      變化: c.delta,
    })),
    消費最多的店家: stats.topMerchants.map((m) => ({
      店家: m.merchant,
      金額: m.total,
      次數: m.count,
    })),
    各卡片支出: stats.byCard.map((c) => ({ 卡片: c.card, 金額: c.total, 筆數: c.count })),
    疑似固定訂閱: stats.recurring.map((r) => ({
      店家: r.merchant,
      每月平均: r.monthlyAverage,
      連續月數: r.months,
    })),
    信用卡帳單總額: stats.billTotal,
    帳單與已記錄消費對照: {
      說明:
        '帳單期別是結帳週期，不是曆月。例如 2026-07 期、結帳日 12 號的卡，帳的是 6/13–7/12 的消費，' +
        '所以帳單金額本來就不會等於本月支出，兩者相差不代表漏記或現金流風險，不要據此提出警告。' +
        '要比較請拿同一列的「帳單金額」與「該週期已記錄」比。',
      明細: stats.billCoverage.map((b) => ({
        卡片: b.card,
        期別: b.period,
        結帳週期: `${b.cycleStart} ~ ${b.cycleEnd}`,
        帳單金額: b.amount,
        該週期已記錄: b.tracked,
      })),
    },
    未繳帳單: stats.unpaidBills.map((b) => ({
      卡片: b.card,
      期別: b.period,
      金額: b.amount,
      // A local date reads far better to the model than a UTC timestamp.
      繳款期限: dateKey(new Date(b.dueAt)),
    })),
  };
}

/** Deterministic analysis used when the model is unavailable. */
function fallbackInsight(stats: MonthlyStats, fingerprint: string, note: string): InsightPayload {
  const top = stats.categories[0];
  const highlights: string[] = [];
  if (top) {
    highlights.push(
      `最大支出類別是${top.label} NT$${top.total.toLocaleString('en-US')}，佔總支出 ${Math.round(top.share * 100)}%。`,
    );
  }
  if (stats.prevTotal > 0) {
    const diff = stats.total - stats.prevTotal;
    const pct = Math.round((diff / stats.prevTotal) * 100);
    highlights.push(
      `與上月相比${diff >= 0 ? '增加' : '減少'} NT$${Math.abs(round(diff)).toLocaleString('en-US')}（${pct >= 0 ? '+' : ''}${pct}%）。`,
    );
  }
  highlights.push(`平均每日支出 NT$${stats.dailyAverage.toLocaleString('en-US')}。`);

  const tips: Tip[] = [];
  const subs = sum(stats.recurring.map((r) => r.monthlyAverage));
  if (subs > 0) {
    tips.push({
      title: '檢視固定訂閱',
      detail: `偵測到 ${stats.recurring.length} 筆連續 3 個月以上的固定支出（${stats.recurring
        .slice(0, 3)
        .map((r) => r.merchant)
        .join('、')}），每月共約 NT$${round(subs).toLocaleString('en-US')}。取消其中沒在用的服務是最快的節省方式。`,
      monthlySaving: round(subs * 0.3),
    });
  }
  const jumped = stats.categories.filter((c) => c.prevTotal > 0 && c.delta > c.prevTotal * 0.3);
  for (const category of jumped.slice(0, 2)) {
    tips.push({
      title: `${category.label}比上月多`,
      detail: `${category.label}從 NT$${category.prevTotal.toLocaleString('en-US')} 增加到 NT$${category.total.toLocaleString('en-US')}，共 ${category.count} 筆。先確認是一次性支出還是習慣改變。`,
      monthlySaving: round(category.delta * 0.5),
    });
  }
  if (tips.length === 0) {
    tips.push({
      title: '先把記錄補齊',
      detail: '目前資料量還不足以看出模式。用 LINE 傳「記 120 午餐」這種格式隨手記帳，累積一個月後分析才會準。',
      monthlySaving: null,
    });
  }

  return {
    summary: `${note}。${stats.period} 共記錄 ${stats.count} 筆、合計 NT$${stats.total.toLocaleString('en-US')}。`,
    highlights,
    tips,
    warnings: ruleWarnings(stats),
    stats,
    fingerprint,
    generatedAt: new Date().toISOString(),
  };
}

/** Warnings we can be certain about, always prepended to the model's own. */
function ruleWarnings(stats: MonthlyStats): string[] {
  const warnings: string[] = [];
  if (stats.budget && stats.projectedTotal > stats.budget) {
    warnings.push(
      `照目前速度，本月預估支出 NT$${stats.projectedTotal.toLocaleString('en-US')} 會超出預算 NT$${stats.budget.toLocaleString('en-US')}。`,
    );
  }
  const now = Date.now();
  for (const bill of stats.unpaidBills) {
    const due = new Date(bill.dueAt).getTime();
    if (due < now) warnings.push(`${bill.card} ${bill.period} 帳單已逾期未繳。`);
  }

  // The honest version of "you are not recording enough": the bill and the
  // tracked total cover the exact same window, so a large shortfall here means
  // spending really is going unlogged. Fees and carryover make small gaps
  // normal, hence the generous threshold.
  for (const bill of stats.billCoverage) {
    if (bill.amount === null || bill.amount < 1000) continue;
    const missing = round(bill.amount - bill.tracked);
    if (missing < 1000 || missing <= bill.amount * 0.4) continue;
    warnings.push(
      `${bill.card} ${bill.period} 帳單 NT$${bill.amount.toLocaleString('en-US')}，` +
        `但 ${bill.cycleStart}~${bill.cycleEnd} 只記錄了 NT$${bill.tracked.toLocaleString('en-US')}，` +
        `有 NT$${missing.toLocaleString('en-US')} 沒記到。`,
    );
  }
  return warnings;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

function toTips(value: unknown): Tip[] {
  if (!Array.isArray(value)) return [];
  const tips: Tip[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const title = typeof item.title === 'string' ? item.title : null;
    const detail = typeof item.detail === 'string' ? item.detail : null;
    if (!title && !detail) continue;
    const saving = Number(item.monthlySaving);
    tips.push({
      title: title ?? '建議',
      detail: detail ?? '',
      monthlySaving: Number.isFinite(saving) && saving > 0 ? Math.round(saving) : null,
    });
  }
  return tips;
}

/** Compact plain-text rendering for LINE. */
export function insightToText(insight: InsightPayload): string {
  const { stats } = insight;
  const lines: string[] = [`📊 ${stats.period} 消費分析`, ''];
  lines.push(`總支出 NT$${stats.total.toLocaleString('en-US')}（${stats.count} 筆）`);
  if (stats.prevTotal > 0) {
    const diff = stats.total - stats.prevTotal;
    lines.push(`上月 NT$${stats.prevTotal.toLocaleString('en-US')}｜${diff >= 0 ? '▲' : '▼'} NT$${Math.abs(round(diff)).toLocaleString('en-US')}`);
  }
  lines.push('');

  const top = stats.categories.slice(0, 5);
  if (top.length > 0) {
    lines.push('【分類前五】');
    for (const category of top) {
      lines.push(`・${category.label} NT$${category.total.toLocaleString('en-US')}（${Math.round(category.share * 100)}%）`);
    }
    lines.push('');
  }

  lines.push('【總結】', insight.summary, '');

  if (insight.tips.length > 0) {
    lines.push('【節省建議】');
    insight.tips.forEach((tip, index) => {
      const saving = tip.monthlySaving ? `（約省 NT$${tip.monthlySaving.toLocaleString('en-US')}/月）` : '';
      lines.push(`${index + 1}. ${tip.title}${saving}`);
      if (tip.detail) lines.push(`   ${tip.detail}`);
    });
    lines.push('');
  }

  if (insight.warnings.length > 0) {
    lines.push('【注意】');
    for (const warning of insight.warnings) lines.push(`⚠️ ${warning}`);
  }

  return lines.join('\n').trim();
}

export { categoryLabel };

function sum(values: number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
