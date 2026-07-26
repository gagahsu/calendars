import { prisma, toNum } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { handle } from '@/lib/api';
import { billStatusText, upcomingBills } from '@/lib/billing';

export const dynamic = 'force-dynamic';

/** GET /api/statements?unpaid=1&withinDays=45 */
export async function GET(request: Request) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  return handle(async () => {
    const params = new URL(request.url).searchParams;

    if (params.get('unpaid') === '1') {
      const withinDays = Number(params.get('withinDays') ?? '45');
      const bills = await upcomingBills({
        withinDays: Number.isFinite(withinDays) ? withinDays : 45,
      });
      return {
        bills: bills.map((bill) => ({
          id: bill.statement.id,
          cardId: bill.card.id,
          card: bill.card.name,
          color: bill.card.color,
          autoPay: bill.card.autoPay,
          period: bill.statement.period,
          amount: toNum(bill.statement.amount),
          dueAt: bill.statement.dueAt,
          daysLeft: bill.daysLeft,
          overdue: bill.overdue,
          status: billStatusText(bill),
        })),
      };
    }

    const period = params.get('period');
    const statements = await prisma.statement.findMany({
      where: period ? { period } : {},
      include: { card: { select: { name: true, color: true } } },
      orderBy: [{ dueAt: 'desc' }],
      take: 120,
    });
    return {
      statements: statements.map((statement) => ({
        ...statement,
        amount: toNum(statement.amount),
        minimum: toNum(statement.minimum),
        paidAmount: toNum(statement.paidAmount),
      })),
    };
  });
}
