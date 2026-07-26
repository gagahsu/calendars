'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  dayKey,
  dayLabel,
  del,
  money,
  monthKey,
  post,
  shiftMonth,
  toIso,
  todayKey,
} from '@/lib/client';
import { CATEGORIES, categoryEmoji, categoryLabel } from '@/lib/categories';
import type { ApiCard, ApiExpense } from '@/lib/types';

export default function ExpensesView() {
  const [period, setPeriod] = useState(() => monthKey(new Date()));
  const [expenses, setExpenses] = useState<ApiExpense[]>([]);
  const [cards, setCards] = useState<ApiCard[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [category, setCategory] = useState('food');
  const [spentAt, setSpentAt] = useState(() => todayKey());
  const [cardId, setCardId] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [expenseData, cardData] = await Promise.all([
        api<{ expenses: ApiExpense[]; total: number }>(`/api/expenses?period=${period}`),
        api<{ cards: ApiCard[] }>('/api/cards'),
      ]);
      setExpenses(expenseData.expenses);
      setTotal(expenseData.total);
      setCards(cardData.cards.filter((card) => card.active));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '載入失敗');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void load();
  }, [load]);

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const expense of expenses) {
      map.set(expense.category, (map.get(expense.category) ?? 0) + expense.amount);
    }
    return [...map.entries()]
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => b.value - a.value);
  }, [expenses]);

  const grouped = useMemo(() => {
    const map = new Map<string, ApiExpense[]>();
    for (const expense of expenses) {
      const key = dayKey(expense.spentAt);
      const list = map.get(key);
      if (list) list.push(expense);
      else map.set(key, [expense]);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [expenses]);

  async function add(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError('請輸入正確的金額');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await post('/api/expenses', {
        amount: value,
        category,
        merchant: merchant.trim() || null,
        // Noon local time keeps the record on the intended day in every view.
        spentAt: toIso(spentAt, '12:00'),
        cardId: cardId || null,
      });
      setAmount('');
      setMerchant('');
      // Jump to the month the record landed in, so it is visible right away.
      if (spentAt.slice(0, 7) !== period) setPeriod(spentAt.slice(0, 7));
      else await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '新增失敗');
    } finally {
      setBusy(false);
    }
  }

  async function remove(expense: ApiExpense) {
    await del(`/api/expenses/${expense.id}`);
    await load();
  }

  const max = byCategory[0]?.value ?? 1;

  return (
    <main>
      <header className="topbar">
        <h1>
          記帳
          <span className="sub">
            {period.replace('-', ' / ')}・{money(total)}（{expenses.length} 筆）
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

      <form className="card" onSubmit={add}>
        <div className="row" style={{ gap: 8 }}>
          <input
            className="mono"
            style={{ flex: '0 0 110px', textAlign: 'right', fontSize: '1.05rem' }}
            inputMode="decimal"
            placeholder="金額"
            value={amount}
            onChange={(changeEvent) => setAmount(changeEvent.target.value)}
          />
          <input
            className="grow"
            placeholder="店家／說明"
            value={merchant}
            onChange={(changeEvent) => setMerchant(changeEvent.target.value)}
          />
        </div>

        <div className="chips" style={{ marginTop: 10 }}>
          {CATEGORIES.map((option) => (
            <button
              type="button"
              key={option.key}
              className="chip"
              data-active={category === option.key}
              onClick={() => setCategory(option.key)}
            >
              {option.emoji} {option.label}
            </button>
          ))}
        </div>

        <div className="grid2" style={{ marginTop: 10 }}>
          <input
            type="date"
            value={spentAt}
            onChange={(changeEvent) => setSpentAt(changeEvent.target.value)}
          />
          <select value={cardId} onChange={(changeEvent) => setCardId(changeEvent.target.value)}>
            <option value="">現金／其他</option>
            {cards.map((card) => (
              <option key={card.id} value={card.id}>
                {card.name}
              </option>
            ))}
          </select>
        </div>

        <button
          className="btn primary block"
          style={{ marginTop: 10 }}
          type="submit"
          disabled={busy || amount.trim() === ''}
        >
          {busy ? <span className="spinner" /> : '記一筆'}
        </button>
      </form>

      {byCategory.length > 0 && (
        <div className="card">
          <h2>分類佔比</h2>
          {byCategory.map((row) => (
            <div className="bar-row" key={row.key}>
              <span className="tiny">
                {categoryEmoji(row.key)} {categoryLabel(row.key)}
              </span>
              <span className="bar-track">
                <span className="bar-fill" style={{ width: `${(row.value / max) * 100}%` }} />
              </span>
              <span className="tiny mono">{money(row.value)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h2>明細</h2>
        {loading && <div className="empty">載入中…</div>}
        {!loading && expenses.length === 0 && (
          <div className="empty">
            這個月還沒有紀錄。
            <br />
            也可以在 LINE 傳「記 120 午餐」。
          </div>
        )}
        {grouped.map(([day, list]) => (
          <div key={day}>
            <div
              className="tiny faint row spread"
              style={{ marginTop: 12, paddingBottom: 4, borderBottom: '1px solid var(--border)' }}
            >
              <span>{dayLabel(`${day}T12:00:00Z`)}</span>
              <span className="mono">
                {money(list.reduce((sum, expense) => sum + expense.amount, 0))}
              </span>
            </div>
            {list.map((expense) => (
              <div className="item" key={expense.id}>
                <span style={{ fontSize: '1.05rem' }} aria-hidden>
                  {categoryEmoji(expense.category)}
                </span>
                <div className="grow">
                  <div className="title small">
                    {expense.merchant ?? categoryLabel(expense.category)}
                  </div>
                  <div className="meta">
                    {categoryLabel(expense.category)}・{expense.card?.name ?? '現金'}
                    {expense.source === 'line' ? '・LINE' : ''}
                  </div>
                </div>
                <span className="amount small">{money(expense.amount)}</span>
                <button
                  className="btn sm ghost"
                  onClick={() => void remove(expense)}
                  aria-label="刪除"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </main>
  );
}
