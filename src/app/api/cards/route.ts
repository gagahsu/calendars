import { prisma, toNum } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { bool, handle, int, intArray, readJson, str, badRequest } from '@/lib/api';
import { syncStatements } from '@/lib/billing';

export const dynamic = 'force-dynamic';

export async function GET() {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  return handle(async () => {
    const cards = await prisma.card.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: {
        statements: {
          orderBy: { period: 'desc' },
          take: 8,
        },
      },
    });

    return {
      cards: cards.map((card) => ({
        ...card,
        statements: card.statements.map((statement) => ({
          ...statement,
          amount: toNum(statement.amount),
          minimum: toNum(statement.minimum),
          paidAmount: toNum(statement.paidAmount),
        })),
      })),
    };
  });
}

export async function POST(request: Request) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  return handle(async () => {
    const body = await readJson(request);
    const name = str(body, 'name', { required: true, max: 60 })!;

    const duplicate = await prisma.card.findUnique({ where: { name } });
    if (duplicate) badRequest(`已經有一張叫「${name}」的卡片`);

    const card = await prisma.card.create({
      data: {
        name,
        issuer: str(body, 'issuer', { max: 60 }),
        last4: str(body, 'last4', { max: 4 }),
        statementDay: int(body, 'statementDay', { required: true, min: 1, max: 31 })!,
        dueDay: int(body, 'dueDay', { required: true, min: 1, max: 31 })!,
        dueNextMonth: bool(body, 'dueNextMonth') ?? true,
        autoPay: bool(body, 'autoPay') ?? false,
        color: str(body, 'color', { max: 20 }) ?? '#6366f1',
        remindDaysBefore: intArray(body, 'remindDaysBefore', { min: 0, max: 30 }) ?? [7, 3, 1, 0],
      },
    });

    // Materialise the upcoming deadlines immediately so the calendar fills in.
    await syncStatements(card);
    return { card };
  });
}
