import { requireAuth } from '@/lib/auth';
import { badRequest, handle } from '@/lib/api';
import { parsePeriodKey, periodKey } from '@/lib/date';
import { getInsight } from '@/lib/insights';
import { configuredModels, openRouterConfigured } from '@/lib/openrouter';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** GET /api/insights?period=YYYY-MM&force=1 */
export async function GET(request: Request) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  return handle(async () => {
    const params = new URL(request.url).searchParams;
    const period = params.get('period') ?? periodKey(new Date());
    if (!parsePeriodKey(period)) badRequest('period 格式應為 YYYY-MM');

    const { insight, model, cached } = await getInsight(period, {
      force: params.get('force') === '1',
    });

    return {
      insight,
      model,
      cached,
      aiEnabled: openRouterConfigured(),
      availableModels: configuredModels(),
    };
  });
}
