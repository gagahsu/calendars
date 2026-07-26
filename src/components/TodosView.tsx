'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, dayLabel, daysUntil, del, patch, post, toIso, todayKey } from '@/lib/client';
import type { ApiTodo } from '@/lib/types';

const FILTERS = [
  { key: 'open', label: '未完成' },
  { key: 'today', label: '今天到期' },
  { key: 'done', label: '已完成' },
] as const;

type FilterKey = (typeof FILTERS)[number]['key'];

export default function TodosView() {
  const [todos, setTodos] = useState<ApiTodo[]>([]);
  const [filter, setFilter] = useState<FilterKey>('open');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState(2);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ todos: ApiTodo[] }>('/api/todos?done=all');
      setTodos(data.todos);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '載入失敗');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    if (filter === 'done') {
      return todos
        .filter((todo) => todo.done)
        .sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''));
    }
    const open = todos.filter((todo) => !todo.done);
    if (filter === 'today') {
      return open.filter((todo) => todo.dueAt !== null && daysUntil(todo.dueAt) <= 0);
    }
    return open;
  }, [todos, filter]);

  const overdue = todos.filter(
    (todo) => !todo.done && todo.dueAt !== null && daysUntil(todo.dueAt) < 0,
  ).length;

  async function add(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    if (title.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await post('/api/todos', {
        title: title.trim(),
        // A due date with no time means "by end of that day".
        dueAt: dueDate ? toIso(dueDate, '23:59') : null,
        priority,
      });
      setTitle('');
      setDueDate('');
      setPriority(2);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '新增失敗');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(todo: ApiTodo) {
    // Optimistic: the checkbox should feel instant.
    setTodos((current) =>
      current.map((item) => (item.id === todo.id ? { ...item, done: !item.done } : item)),
    );
    try {
      await patch(`/api/todos/${todo.id}`, { done: !todo.done });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '更新失敗');
      await load();
    }
  }

  async function remove(todo: ApiTodo) {
    await del(`/api/todos/${todo.id}`);
    await load();
  }

  return (
    <main>
      <header className="topbar">
        <h1>
          待辦事項
          <span className="sub">
            {todos.filter((todo) => !todo.done).length} 件未完成
            {overdue > 0 ? `・${overdue} 件逾期` : ''}
          </span>
        </h1>
      </header>

      {error && <div className="alert danger">{error}</div>}

      <form className="card" onSubmit={add}>
        <input
          value={title}
          placeholder="要做什麼？"
          onChange={(changeEvent) => setTitle(changeEvent.target.value)}
        />
        <div className="row" style={{ marginTop: 10, gap: 8 }}>
          <input
            type="date"
            className="grow"
            value={dueDate}
            min="2000-01-01"
            onChange={(changeEvent) => setDueDate(changeEvent.target.value)}
          />
          <button
            type="button"
            className="chip"
            data-active={dueDate === todayKey()}
            onClick={() => setDueDate(todayKey())}
          >
            今天
          </button>
          <button
            type="button"
            className="chip"
            data-active={priority === 1}
            onClick={() => setPriority(priority === 1 ? 2 : 1)}
          >
            重要
          </button>
        </div>
        <button
          className="btn primary block"
          style={{ marginTop: 10 }}
          type="submit"
          disabled={busy || title.trim().length === 0}
        >
          {busy ? <span className="spinner" /> : '新增待辦'}
        </button>
      </form>

      <div className="chips" style={{ marginBottom: 10 }}>
        {FILTERS.map((option) => (
          <button
            key={option.key}
            className="chip"
            data-active={filter === option.key}
            onClick={() => setFilter(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="card">
        {loading && <div className="empty">載入中…</div>}
        {!loading && visible.length === 0 && <div className="empty">沒有符合的待辦</div>}
        {visible.map((todo) => {
          const left = todo.dueAt ? daysUntil(todo.dueAt) : null;
          return (
            <div className={`item ${todo.done ? 'done' : ''}`} key={todo.id}>
              <button
                className="check"
                data-done={todo.done}
                onClick={() => void toggle(todo)}
                aria-label={todo.done ? '標記未完成' : '標記完成'}
              >
                ✓
              </button>
              <div className="grow">
                <div className="title">
                  {todo.priority === 1 && !todo.done ? '❗ ' : ''}
                  {todo.title}
                </div>
                <div className="meta">
                  {todo.dueAt === null
                    ? '沒有期限'
                    : left !== null && left < 0
                      ? `逾期 ${Math.abs(left)} 天（${dayLabel(todo.dueAt)}）`
                      : left === 0
                        ? '今天到期'
                        : left === 1
                          ? '明天到期'
                          : dayLabel(todo.dueAt)}
                </div>
              </div>
              <button className="btn sm ghost" onClick={() => void remove(todo)}>
                刪除
              </button>
            </div>
          );
        })}
      </div>

      <p className="tiny faint" style={{ padding: '0 4px 8px' }}>
        也可以在 LINE 傳「待辦 繳水電費 明天」新增，「完成 1」勾掉第一項。
      </p>
    </main>
  );
}
