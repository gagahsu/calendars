import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { bool, handle, int, intArray, notFound, readJson, str } from '@/lib/api';
import { deleteCardEvents, syncStatements } from '@/lib/billing';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  return handle(async () => {
    const { id } = await params;
    const existing = await prisma.card.findUnique({ where: { id } });
    if (!existing) notFound('找不到這張卡片');

    const body = await readJson(request);
    const data: Record<string, unknown> = {};
    if ('name' in body) data.name = str(body, 'name', { required: true, max: 60 });
    if ('issuer' in body) data.issuer = str(body, 'issuer', { max: 60 });
    if ('last4' in body) data.last4 = str(body, 'last4', { max: 4 });
    if ('statementDay' in body) {
      data.statementDay = int(body, 'statementDay', { required: true, min: 1, max: 31 });
    }
    if ('dueDay' in body) data.dueDay = int(body, 'dueDay', { required: true, min: 1, max: 31 });
    if ('dueNextMonth' in body) data.dueNextMonth = bool(body, 'dueNextMonth');
    if ('autoPay' in body) data.autoPay = bool(body, 'autoPay');
    if ('active' in body) data.active = bool(body, 'active');
    if ('color' in body) data.color = str(body, 'color', { max: 20 }) ?? '#6366f1';
    if ('remindDaysBefore' in body) {
      data.remindDaysBefore = intArray(body, 'remindDaysBefore', { min: 0, max: 30 }) ?? [];
    }

    const card = await prisma.card.update({ where: { id }, data });
    // Due dates and titles are derived from the card, so re-sync after a change.
    await syncStatements(card);
    return { card };
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  return handle(async () => {
    const { id } = await params;
    const existing = await prisma.card.findUnique({ where: { id } });
    if (!existing) notFound('找不到這張卡片');
    // Statements cascade with the card; their calendar events do not.
    await deleteCardEvents(id);
    await prisma.card.delete({ where: { id } });
    return { ok: true };
  });
}
