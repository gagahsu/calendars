import { prisma, toNum } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { badRequest, date, handle, num, readJson, str } from '@/lib/api';
import { parsePeriodKey, periodRange, periodKey } from '@/lib/date';
import { isCategoryKey } from '@/lib/categories';

export const dynamic = 'force-dynamic';

/** GET /api/expenses?period=YYYY-MM */
export async function GET(request: Request) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  return handle(async () => {
    const params = new URL(request.url).searchParams;
    const period = params.get('period') ?? periodKey(new Date());
    if (!parsePeriodKey(period)) badRequest('period 格式應為 YYYY-MM');
    const { start, end } = periodRange(period);

    const expenses = await prisma.expense.findMany({
      where: { spentAt: { gte: start, lt: end } },
      include: { card: { select: { id: true, name: true, color: true } } },
      orderBy: [{ spentAt: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });

    const total = expenses.reduce((acc, expense) => acc + (toNum(expense.amount) ?? 0), 0);
    return {
      period,
      total: Math.round(total * 100) / 100,
      expenses: expenses.map((expense) => ({ ...expense, amount: toNum(expense.amount) })),
    };
  });
}

export async function POST(request: Request) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  return handle(async () => {
    const body = await readJson(request);
    const category = str(body, 'category', { max: 40 }) ?? 'other';
    if (!isCategoryKey(category)) badRequest(`未知的分類：${category}`);

    const cardId = str(body, 'cardId', { max: 40 });
    if (cardId) {
      const card = await prisma.card.findUnique({ where: { id: cardId } });
      if (!card) badRequest('找不到指定的卡片');
    }

    const expense = await prisma.expense.create({
      data: {
        amount: num(body, 'amount', { required: true, min: 0.01, max: 99_999_999 })!,
        category,
        merchant: str(body, 'merchant', { max: 100 }),
        note: str(body, 'note', { max: 500 }),
        spentAt: date(body, 'spentAt') ?? new Date(),
        cardId,
        source: 'web',
      },
    });

    return { expense: { ...expense, amount: toNum(expense.amount) } };
  });
}
