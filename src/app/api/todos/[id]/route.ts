import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { bool, date, handle, int, notFound, readJson, str } from '@/lib/api';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  return handle(async () => {
    const { id } = await params;
    const existing = await prisma.todo.findUnique({ where: { id } });
    if (!existing) notFound('找不到這個待辦');

    const body = await readJson(request);
    const data: Record<string, unknown> = {};
    if ('title' in body) data.title = str(body, 'title', { required: true, max: 200 });
    if ('note' in body) data.note = str(body, 'note', { max: 2000 });
    if ('dueAt' in body) data.dueAt = date(body, 'dueAt');
    if ('priority' in body) data.priority = int(body, 'priority', { min: 1, max: 3 }) ?? 2;
    if ('done' in body) {
      const done = bool(body, 'done') ?? false;
      data.done = done;
      data.doneAt = done ? new Date() : null;
    }

    const todo = await prisma.todo.update({ where: { id }, data });
    return { todo };
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  return handle(async () => {
    const { id } = await params;
    const existing = await prisma.todo.findUnique({ where: { id } });
    if (!existing) notFound('找不到這個待辦');
    await prisma.todo.delete({ where: { id } });
    return { ok: true };
  });
}
