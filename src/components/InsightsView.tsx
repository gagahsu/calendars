'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, dayLabel, money, monthKey, shiftMonth } from '@/lib/client';
import { categoryEmoji } from '@/lib/categories';
import type { ApiInsight } from '@/lib/types';

type Response = {
  insight: ApiInsight;
  model: string;
  cached: boolean;
  aiEnabled: boolean;
  availableModels: string[];
};

export default function InsightsView() {
  const [period, setPeriod] = useState(() => monthKey(new Date()));
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (target: string, force = false) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api<Response>(
        `/api/insights?period=${target}${force ? '&force=1' : ''}`,
      );
      setData(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '分析失敗');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(period);
  }, [load, period]);

  const stats = data?.insight.stats;
  const diff = stats ? stats.total - stats.prevTotal : 0;
  const maxCategory = stats?.categories[0]?.total ?? 1;

  return (
    <main>
      <header className="topbar">
        <h1>
          消費分析
          <span className="sub">
            {period.replace('-', ' / ')}
            {data ? `・${data.cached ? '快取' : '即時'}・${data.model}` : ''}
          </span>
        </h1>
        <div className="row">
          <button className="btn sm ghost" onClick={() => setPeriod(shiftMonth(period, -1))}>
            ‹
          </button>
          <button className="btn sm ghost" onClick={() => setPeriod(monthKey(new Date()))}>
            本月
          </button>
          <button className="btn sm ghost" onClick={() => setPeriod(shiftMonth(period, 1))}>
            ›
          </button>
        </div>
      </header>

      {error && <div className="alert danger">{error}</div>}

      {data && !data.aiEnabled && (
        <div className="alert warn">
          尚未設定 OPENROUTER_API_KEY，目前顯示的是規則式分析。設定後即可使用免費模型產生建議。
        </div>
      )}

      {loading && !data && <div className="card">
        <div className="empty">
          <span className="spinner" style={{ display: 'inline-block', marginRight: 8 }} />
          分析中，免費模型可能需要 10-30 秒…
        </div>
      </div>}

      {stats && (
        <>
          <div className="card">
            <div className="stat-row">
              <div className="stat">
                <div className="k">本月支出</div>
                <div className="v">{money(stats.total)}</div>
              </div>
              <div className="stat">
                <div className="k">平均每日</div>
                <div className="v">{money(stats.dailyAverage)}</div>
              </div>
              <div className="stat">
                <div className="k">預估月底</div>
                <div className="v">{money(stats.projectedTotal)}</div>
              </div>
            </div>

            <div className="row spread small" style={{ marginTop: 12 }}>
              <span className="muted">
                上月 {money(stats.prevTotal)}（{stats.prevPeriod}）
              </span>
              {stats.prevTotal > 0 && (
                <span className={`badge ${diff > 0 ? 'danger' : 'ok'}`}>
                  {diff > 0 ? '▲' : '▼'} {money(Math.abs(diff))}（
                  {Math.round((diff / stats.prevTotal) * 100)}%）
                </span>
              )}
            </div>

            {stats.budget !== null && (
              <div style={{ marginTop: 12 }}>
                <div className="row spread tiny faint">
                  <span>預算使用率</span>
                  <span>
                    {money(stats.total)} / {money(stats.budget)}
                  </span>
                </div>
                <div className="bar-track" style={{ marginTop: 4, height: 9 }}>
                  <div
                    className="bar-fill"
                    style={{
                      width: `${Math.min(100, (stats.total / stats.budget) * 100)}%`,
                      background: stats.total > stats.budget ? 'var(--danger)' : 'var(--ok)',
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {data.insight.warnings.length > 0 && (
            <div className="card">
              <h2>⚠️ 注意事項</h2>
              {data.insight.warnings.map((warning) => (
                <div className="alert danger" key={warning}>
                  {warning}
                </div>
              ))}
            </div>
          )}

          <div className="card">
            <h2>
              🤖 AI 總結
              <button
                className="btn sm ghost"
                disabled={loading}
                onClick={() => void load(period, true)}
              >
                {loading ? <span className="spinner" /> : '重新分析'}
              </button>
            </h2>
            <p className="small" style={{ whiteSpace: 'pre-wrap' }}>
              {data.insight.summary}
            </p>
            {data.insight.highlights.length > 0 && (
              <ul className="small muted" style={{ marginTop: 10, paddingLeft: 18 }}>
                {data.insight.highlights.map((line) => (
                  <li key={line} style={{ marginBottom: 4 }}>
                    {line}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {data.insight.tips.length > 0 && (
            <div className="card">
              <h2>💡 節省建議</h2>
              {data.insight.tips.map((tip) => (
                <div className="tip" key={tip.title}>
                  <div className="tip-title">
                    <span>{tip.title}</span>
                    {tip.monthlySaving !== null && (
                      <span className="badge ok tiny">省 {money(tip.monthlySaving)}/月</span>
                    )}
                  </div>
                  {tip.detail && <p>{tip.detail}</p>}
                </div>
              ))}
            </div>
          )}

          {stats.categories.length > 0 && (
            <div className="card">
              <h2>分類明細</h2>
              {stats.categories.map((category) => (
                <div key={category.key} style={{ marginBottom: 8 }}>
                  <div className="bar-row" style={{ padding: 0 }}>
                    <span className="tiny">
                      {categoryEmoji(category.key)} {category.label}
                    </span>
                    <span className="bar-track">
                      <span
                        className="bar-fill"
                        style={{ width: `${(category.total / maxCategory) * 100}%` }}
                      />
                    </span>
                    <span className="tiny mono">{money(category.total)}</span>
                  </div>
                  <div className="tiny faint" style={{ paddingLeft: 92 }}>
                    {category.count} 筆・佔 {Math.round(category.share * 100)}%
                    {category.prevTotal > 0 && (
                      <>
                        ・上月 {money(category.prevTotal)}（{category.delta >= 0 ? '+' : ''}
                        {money(category.delta)}）
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {stats.recurring.length > 0 && (
            <div className="card">
              <h2>🔁 疑似固定訂閱</h2>
              <p className="tiny faint" style={{ marginBottom: 8 }}>
                連續 3 個月以上都出現的店家，最值得檢查有沒有在用。
              </p>
              {stats.recurring.map((row) => (
                <div className="item" key={row.merchant}>
                  <div className="grow">
                    <div className="title small">{row.merchant}</div>
                    <div className="meta">連續 {row.months} 個月</div>
                  </div>
                  <span className="amount small">{money(row.monthlyAverage)}／月</span>
                </div>
              ))}
            </div>
          )}

          {stats.topMerchants.length > 0 && (
            <div className="card">
              <h2>消費最多的店家</h2>
              {stats.topMerchants.map((row) => (
                <div className="item" key={row.merchant}>
                  <div className="grow">
                    <div className="title small">{row.merchant}</div>
                    <div className="meta">{row.count} 次</div>
                  </div>
                  <span className="amount small">{money(row.total)}</span>
                </div>
              ))}
            </div>
          )}

          {stats.unpaidBills.length > 0 && (
            <div className="card">
              <h2>本期未繳帳單</h2>
              {stats.unpaidBills.map((bill) => (
                <div className="item" key={`${bill.card}-${bill.period}`}>
                  <div className="grow">
                    <div className="title small">{bill.card}</div>
                    <div className="meta">
                      {bill.period}・繳款日 {dayLabel(bill.dueAt)}
                    </div>
                  </div>
                  <span className="amount small">{money(bill.amount)}</span>
                </div>
              ))}
            </div>
          )}

          <p className="tiny faint" style={{ padding: '0 4px 8px' }}>
            分析結果會快取，資料有變動或按「重新分析」時才會重新呼叫模型。
            可用模型：{data.availableModels.join('、')}
          </p>
        </>
      )}
    </main>
  );
}
