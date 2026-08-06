import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { badRequest, bool, date, handle, intArray, readJson, str } from '@/lib/api';
import { periodRange, parsePeriodKey, addMonths } from '@/lib/date';

export const dynamic = 'force-dynamic';

/**
 * GET /api/events?period=YYYY-MM   → that month plus one month either side,
 *                                    so the calendar grid's leading/trailing
 *                                    days are populated too.
 * GET /api/events?from=ISO&to=ISO  → explicit range.
 */
export async function GET(request: Request) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  return handle(async () => {
    const params = new URL(request.url).searchParams;
    const period = params.get('period');
    let from: Date;
    let to: Date;

    if (period && parsePeriodKey(period)) {
      from = periodRange(addMonths(period, -1)).start;
      to = periodRange(addMonths(period, 1)).end;
    } else {
      const fromParam = params.get('from');
      const toParam = params.get('to');
      from = fromParam ? new Date(fromParam) : new Date(Date.now() - 30 * 24 * 60 * 60_000);
      to = toParam ? new Date(toParam) : new Date(Date.now() + 60 * 24 * 60 * 60_000);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        from = new Date(Date.now() - 30 * 24 * 60 * 60_000);
        to = new Date(Date.now() + 60 * 24 * 60 * 60_000);
      }
    }

    const events = await prisma.event.findMany({
      where: { startsAt: { gte: from, lt: to } },
      orderBy: [{ startsAt: 'asc' }],
      include: { statement: { select: { id: true, paid: true, cardId: true } } },
    });

    return { events };
  });
}

export async function POST(request: Request) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  return handle(async () => {
    const body = await readJson(request);
    const startsAt = date(body, 'startsAt', { required: true })!;
    const endsAt = date(body, 'endsAt');
    if (endsAt && endsAt <= startsAt) badRequest('結束時間必須晚於開始時間');

    const event = await prisma.event.create({
      data: {
        title: str(body, 'title', { required: true, max: 200 })!,
        note: str(body, 'note', { max: 2000 }),
        location: str(body, 'location', { max: 200 }),
        startsAt,
        endsAt,
        allDay: bool(body, 'allDay') ?? false,
        category: str(body, 'category', { max: 40 }) ?? 'general',
        remindMinutes: intArray(body, 'remindMinutes', { min: 0, max: 60 * 24 * 30 }) ?? [],
      },
    });
    return { event };
  });
}
