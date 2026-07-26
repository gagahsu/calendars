import { prisma, toNum } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { badRequest, date, handle, notFound, num, readJson, str } from '@/lib/api';
import { isCategoryKey } from '@/lib/categories';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  return handle(async () => {
    const { id } = await params;
    const existing = await prisma.expense.findUnique({ where: { id } });
    if (!existing) notFound('找不到這筆消費');

    const body = await readJson(request);
    const data: Record<string, unknown> = {};
    if ('amount' in body) {
      data.amount = num(body, 'amount', { required: true, min: 0.01, max: 99_999_999 });
    }
    if ('category' in body) {
      const category = str(body, 'category', { max: 40 }) ?? 'other';
      if (!isCategoryKey(category)) badRequest(`未知的分類：${category}`);
      data.category = category;
    }
    if ('merchant' in body) data.merchant = str(body, 'merchant', { max: 100 });
    if ('note' in body) data.note = str(body, 'note', { max: 500 });
    if ('spentAt' in body) data.spentAt = date(body, 'spentAt', { required: true });
    if ('cardId' in body) {
      const cardId = str(body, 'cardId', { max: 40 });
      if (cardId) {
        const card = await prisma.card.findUnique({ where: { id: cardId } });
        if (!card) badRequest('找不到指定的卡片');
      }
      data.cardId = cardId;
    }

    const expense = await prisma.expense.update({ where: { id }, data });
    return { expense: { ...expense, amount: toNum(expense.amount) } };
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  return handle(async () => {
    const { id } = await params;
    const existing = await prisma.expense.findUnique({ where: { id } });
    if (!existing) notFound('找不到這筆消費');
    await prisma.expense.delete({ where: { id } });
    return { ok: true };
  });
}
