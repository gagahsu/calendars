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
  timeLabel,
  toIso,
  todayKey,
} from '@/lib/client';
import type { ApiBill, ApiEvent, ApiExpense, ApiTodo } from '@/lib/types';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

type DayBuckets = {
  events: ApiEvent[];
  todos: ApiTodo[];
  expenses: ApiExpense[];
  spend: number;
};

export default function CalendarView() {
  const [period, setPeriod] = useState(() => monthKey(new Date()));
  const [selected, setSelected] = useState(() => todayKey());
  const [events, setEvents] = useState<ApiEvent[]>([]);
  const [todos, setTodos] = useState<ApiTodo[]>([]);
  const [expenses, setExpenses] = useState<ApiExpense[]>([]);
  const [bills, setBills] = useState<ApiBill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [eventData, todoData, expenseData, billData] = await Promise.all([
        api<{ events: ApiEvent[] }>(`/api/events?period=${period}`),
        api<{ todos: ApiTodo[] }>('/api/todos?done=all'),
        api<{ expenses: ApiExpense[] }>(`/api/expenses?period=${period}`),
        api<{ bills: ApiBill[] }>('/api/statements?unpaid=1&withinDays=45'),
      ]);
      setEvents(eventData.events);
      setTodos(todoData.todos);
      setExpenses(expenseData.expenses);
      setBills(billData.bills);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '載入失敗');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Index everything by Taipei day so the grid render is a map lookup. */
  const buckets = useMemo(() => {
    const map = new Map<string, DayBuckets>();
    const bucket = (key: string) => {
      const existing = map.get(key);
      if (existing) return existing;
      const created: DayBuckets = { events: [], todos: [], expenses: [], spend: 0 };
      map.set(key, created);
      return created;
    };

    for (const event of events) bucket(dayKey(event.startsAt)).events.push(event);
    for (const todo of todos) {
      if (todo.dueAt) bucket(dayKey(todo.dueAt)).todos.push(todo);
    }
    for (const expense of expenses) {
      const entry = bucket(dayKey(expense.spentAt));
      entry.expenses.push(expense);
      entry.spend += expense.amount;
    }
    return map;
  }, [events, todos, expenses]);

  const grid = useMemo(() => buildGrid(period), [period]);
  const selectedBucket = buckets.get(selected);
  const monthSpend = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const urgentBills = bills.filter((bill) => bill.overdue || bill.daysLeft <= 7);

  async function addEvent(input: { title: string; date: string; time: string; location: string }) {
    const allDay = input.time === '';
    await post('/api/events', {
      title: input.title,
      startsAt: toIso(input.date, input.time || '09:00'),
      allDay,
      location: input.location || null,
      remindMinutes: allDay ? [] : [30],
    });
    setComposing(false);
    await load();
  }

  async function removeEvent(id: string) {
    const result = await del<{ ok: boolean; error?: string }>(`/api/events/${id}`);
    if (result.error) {
      setError(result.error);
      return;
    }
    await load();
  }

  async function toggleTodo(todo: ApiTodo) {
    await api(`/api/todos/${todo.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ done: !todo.done }),
    });
    await load();
  }

  return (
    <main>
      <header className="topbar">
        <div>
          <h1>
            {period.replace('-', ' / ')}
            <span className="sub">本月支出 {money(monthSpend)}</span>
          </h1>
        </div>
        <div className="row">
          <button className="btn sm ghost" onClick={() => setPeriod(shiftMonth(period, -1))}>
            ‹
          </button>
          <button
            className="btn sm ghost"
            onClick={() => {
              setPeriod(monthKey(new Date()));
              setSelected(todayKey());
            }}
          >
            今天
          </button>
          <button className="btn sm ghost" onClick={() => setPeriod(shiftMonth(period, 1))}>
            ›
          </button>
        </div>
      </header>

      {error && <div className="alert danger">{error}</div>}

      {urgentBills.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--warn)' }}>
          <h2>
            💳 待繳帳單
            <span className="badge warn">{urgentBills.length}</span>
          </h2>
          <div className="stack">
            {urgentBills.map((bill) => (
              <div className="row spread" key={bill.id}>
                <div className="grow">
                  <div className="small" style={{ fontWeight: 560 }}>
                    {bill.card}
                  </div>
                  <div className="tiny faint">{bill.status}</div>
                </div>
                <span className="amount small">{money(bill.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="cal-head">
          {WEEKDAYS.map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="cal-grid">
          {grid.map((cell) => {
            const entry = buckets.get(cell.key);
            const bill = entry?.events.find((event) => event.category === 'bill');
            const other = entry?.events.filter((event) => event.category !== 'bill') ?? [];
            return (
              <button
                className="cal-day"
                key={cell.key}
                data-outside={!cell.inMonth}
                data-today={cell.key === todayKey()}
                data-selected={cell.key === selected}
                data-weekend={cell.weekday === 0 || cell.weekday === 6}
                onClick={() => setSelected(cell.key)}
              >
                <span className="num">{cell.day}</span>
                {/* A day cell is ~50px wide on a phone, so titles would all
                    truncate to "家…". Show typed markers instead and put the
                    detail in the panel below. */}
                {bill && (
                  <span className={`marker ${bill.statement?.paid ? 'bill-paid' : 'bill'}`}>
                    {bill.statement?.paid ? '✓' : '💳'}
                  </span>
                )}
                <span className="dots">
                  {other.slice(0, 3).map((event) => (
                    <span className="dot event" key={event.id} />
                  ))}
                  {(entry?.todos.filter((todo) => !todo.done).length ?? 0) > 0 && (
                    <span className="dot todo" />
                  )}
                  {(entry?.spend ?? 0) > 0 && <span className="dot spend" />}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="card">
        <h2>
          {dayLabel(`${selected}T12:00:00Z`)}
          <button className="btn sm primary" onClick={() => setComposing(true)}>
            ＋ 行程
          </button>
        </h2>

        {loading && <div className="empty">載入中…</div>}

        {!loading && (
          <div className="stack">
            {(selectedBucket?.events.length ?? 0) === 0 &&
              (selectedBucket?.todos.length ?? 0) === 0 &&
              (selectedBucket?.expenses.length ?? 0) === 0 && (
                <div className="empty">這天沒有任何紀錄</div>
              )}

            {selectedBucket?.events.map((event) => (
              <div className="item" key={event.id}>
                <div className="grow">
                  <div className="title">
                    {event.category === 'bill' ? '💳 ' : ''}
                    {event.title}
                  </div>
                  <div className="meta">
                    {event.allDay ? '全天' : timeLabel(event.startsAt)}
                    {event.location ? `・📍 ${event.location}` : ''}
                    {event.remindMinutes.length > 0 ? `・🔔 前 ${event.remindMinutes[0]} 分鐘` : ''}
                  </div>
                </div>
                {event.category !== 'bill' && (
                  <button className="btn sm ghost" onClick={() => void removeEvent(event.id)}>
                    刪除
                  </button>
                )}
              </div>
            ))}

            {selectedBucket?.todos.map((todo) => (
              <div className={`item ${todo.done ? 'done' : ''}`} key={todo.id}>
                <button
                  className="check"
                  data-done={todo.done}
                  onClick={() => void toggleTodo(todo)}
                  aria-label={todo.done ? '標記未完成' : '標記完成'}
                >
                  ✓
                </button>
                <div className="grow">
                  <div className="title">{todo.title}</div>
                  <div className="meta">待辦{todo.priority === 1 ? '・重要' : ''}</div>
                </div>
              </div>
            ))}

            {(selectedBucket?.expenses.length ?? 0) > 0 && (
              <>
                <div className="tiny faint" style={{ marginTop: 4 }}>
                  當日支出 {money(selectedBucket?.spend ?? 0)}
                </div>
                {selectedBucket?.expenses.map((expense) => (
                  <div className="item" key={expense.id}>
                    <div className="grow">
                      <div className="title small">{expense.merchant ?? '未命名消費'}</div>
                      <div className="meta">
                        {expense.card?.name ?? '現金'}
                        {expense.source === 'line' ? '・LINE' : ''}
                      </div>
                    </div>
                    <span className="amount small">{money(expense.amount)}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {composing && (
        <EventSheet
          defaultDate={selected}
          onClose={() => setComposing(false)}
          onSubmit={addEvent}
        />
      )}
    </main>
  );
}

function EventSheet({
  defaultDate,
  onClose,
  onSubmit,
}: {
  defaultDate: string;
  onClose: () => void;
  onSubmit: (input: { title: string; date: string; time: string; location: string }) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState('');
  const [location, setLocation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ title, date, time, location });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '新增失敗');
      setBusy(false);
    }
  }

  return (
    <div
      className="sheet-backdrop"
      onClick={(clickEvent) => {
        if (clickEvent.target === clickEvent.currentTarget) onClose();
      }}
    >
      <form className="sheet" onSubmit={submit}>
        <h2>新增行程</h2>

        <label className="field" htmlFor="event-title">
          標題
        </label>
        <input
          id="event-title"
          value={title}
          autoFocus
          placeholder="例如：看牙醫"
          onChange={(changeEvent) => setTitle(changeEvent.target.value)}
        />

        <div className="grid2" style={{ marginTop: 10 }}>
          <div>
            <label className="field" htmlFor="event-date">
              日期
            </label>
            <input
              id="event-date"
              type="date"
              value={date}
              onChange={(changeEvent) => setDate(changeEvent.target.value)}
            />
          </div>
          <div>
            <label className="field" htmlFor="event-time">
              時間（留空為全天）
            </label>
            <input
              id="event-time"
              type="time"
              value={time}
              onChange={(changeEvent) => setTime(changeEvent.target.value)}
            />
          </div>
        </div>

        <div style={{ marginTop: 10 }}>
          <label className="field" htmlFor="event-location">
            地點（可留空）
          </label>
          <input
            id="event-location"
            value={location}
            onChange={(changeEvent) => setLocation(changeEvent.target.value)}
          />
        </div>

        {error && (
          <div className="alert danger" style={{ marginTop: 10 }}>
            {error}
          </div>
        )}

        <div className="row" style={{ marginTop: 14 }}>
          <button type="button" className="btn ghost grow" onClick={onClose}>
            取消
          </button>
          <button
            type="submit"
            className="btn primary grow"
            disabled={busy || title.trim().length === 0}
          >
            {busy ? <span className="spinner" /> : '新增'}
          </button>
        </div>
      </form>
    </div>
  );
}

type Cell = { key: string; day: number; inMonth: boolean; weekday: number };

/** Six-week grid starting on the Sunday on or before the 1st. */
function buildGrid(period: string): Cell[] {
  const [year, month] = period.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const start = new Date(first.getTime() - first.getUTCDay() * 24 * 60 * 60_000);

  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start.getTime() + index * 24 * 60 * 60_000);
    return {
      key: day.toISOString().slice(0, 10),
      day: day.getUTCDate(),
      inMonth: day.getUTCMonth() === month - 1,
      weekday: day.getUTCDay(),
    };
  });
}
