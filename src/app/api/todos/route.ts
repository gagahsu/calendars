import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { date, handle, int, intArray, readJson, str } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** GET /api/todos?done=true|false|all */
export async function GET(request: Request) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  return handle(async () => {
    const done = new URL(request.url).searchParams.get('done') ?? 'false';
    const where = done === 'all' ? {} : { done: done === 'true' };
    const todos = await prisma.todo.findMany({
      where,
      orderBy: [
        { done: 'asc' },
        { dueAt: { sort: 'asc', nulls: 'last' } },
        { priority: 'asc' },
        { createdAt: 'desc' },
      ],
      take: 300,
    });
    return { todos };
  });
}

export async function POST(request: Request) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  return handle(async () => {
    const body = await readJson(request);
    const todo = await prisma.todo.create({
      data: {
        title: str(body, 'title', { required: true, max: 200 })!,
        note: str(body, 'note', { max: 2000 }),
        dueAt: date(body, 'dueAt'),
        priority: int(body, 'priority', { min: 1, max: 3 }) ?? 2,
        remindMinutes: intArray(body, 'remindMinutes', { min: 0, max: 60 * 24 * 30 }) ?? [],
      },
    });
    return { todo };
  });
}
