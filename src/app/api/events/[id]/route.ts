import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { bool, date, handle, intArray, notFound, readJson, str } from '@/lib/api';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  return handle(async () => {
    const { id } = await params;
    const existing = await prisma.event.findUnique({ where: { id } });
    if (!existing) notFound('找不到這個行程');

    const body = await readJson(request);
    const data: Record<string, unknown> = {};
    if ('title' in body) data.title = str(body, 'title', { required: true, max: 200 });
    if ('note' in body) data.note = str(body, 'note', { max: 2000 });
    if ('location' in body) data.location = str(body, 'location', { max: 200 });
    if ('startsAt' in body) data.startsAt = date(body, 'startsAt', { required: true });
    if ('endsAt' in body) data.endsAt = date(body, 'endsAt');
    if ('allDay' in body) data.allDay = bool(body, 'allDay');
    if ('category' in body) data.category = str(body, 'category', { max: 40 }) ?? 'general';
    if ('remindMinutes' in body) {
      data.remindMinutes = intArray(body, 'remindMinutes', { min: 0, max: 60 * 24 * 30 }) ?? [];
    }

    const event = await prisma.event.update({ where: { id }, data });
    return { event };
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  return handle(async () => {
    const { id } = await params;
    const existing = await prisma.event.findUnique({
      where: { id },
      include: { statement: true },
    });
    if (!existing) notFound('找不到這個行程');
    // Bill events are owned by their statement; deleting one by hand would just
    // get recreated by the next sync, so refuse and explain.
    if (existing.statement) {
      return { ok: false, error: '這是信用卡帳單，請到「卡片」頁面調整或標記已繳。' };
    }
    await prisma.event.delete({ where: { id } });
    return { ok: true };
  });
}
