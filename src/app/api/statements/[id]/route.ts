import { prisma, toNum } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { bool, handle, notFound, num, readJson } from '@/lib/api';
import { refreshStatementEvent } from '@/lib/billing';

type Params = { params: Promise<{ id: string }> };

/** PATCH /api/statements/:id — register the amount, or mark it paid. */
export async function PATCH(request: Request, { params }: Params) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  return handle(async () => {
    const { id } = await params;
    const existing = await prisma.statement.findUnique({ where: { id } });
    if (!existing) notFound('找不到這筆帳單');

    const body = await readJson(request);
    const data: Record<string, unknown> = {};
    if ('amount' in body) data.amount = num(body, 'amount', { min: 0, max: 99_999_999 });
    if ('minimum' in body) data.minimum = num(body, 'minimum', { min: 0, max: 99_999_999 });
    if ('paid' in body) {
      const paid = bool(body, 'paid') ?? false;
      data.paid = paid;
      data.paidAt = paid ? new Date() : null;
      if (!paid) data.paidAmount = null;
    }
    if ('paidAmount' in body) data.paidAmount = num(body, 'paidAmount', { min: 0 });

    const statement = await prisma.statement.update({ where: { id }, data });
    await refreshStatementEvent(statement.id);

    return {
      statement: {
        ...statement,
        amount: toNum(statement.amount),
        minimum: toNum(statement.minimum),
        paidAmount: toNum(statement.paidAmount),
      },
    };
  });
}
