'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  dayKey,
  dayLabel,
  daysUntil,
  del,
  patch,
  post,
  remindLabel,
  timeLabel,
  toIso,
  todayKey,
} from '@/lib/client';
import type { ApiTodo } from '@/lib/types';

const FILTERS = [
  { key: 'open', label: '未完成' },
  { key: 'today', label: '今天到期' },
  { key: 'done', label: '已完成' },
] as const;

type FilterKey = (typeof FILTERS)[number]['key'];

/** A due date with no time means "by end of that day". */
const END_OF_DAY = '23:59';

/** Minutes-before-dueAt presets, same idea as the credit-card day-before chips. */
const REMIND_PRESETS = [1440, 180, 60, 30, 0];
const label = (minutes: number) => remindLabel(minutes, '到期時');

const tomorrowKey = () => dayKey(new Date(Date.now() + 24 * 60 * 60_000));

export default function TodosView() {
  const [todos, setTodos] = useState<ApiTodo[]>([]);
  const [filter, setFilter] = useState<FilterKey>('open');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [priority, setPriority] = useState(2);
  const [remind, setRemind] = useState<number[]>([]);
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

  const dueIso = dueDate ? toIso(dueDate, dueTime || END_OF_DAY) : null;

  /** Clearing the date drops the time and reminders that hung off it. */
  function pickDate(next: string) {
    setDueDate(next);
    if (!next) {
      setDueTime('');
      setRemind([]);
    }
  }

  /**
   * The offsets are relative to a deadline the user may not have given a time
   * to, so "1 小時前" on its own is guesswork. Spell out when each reminder
   * actually lands instead of making them do the arithmetic.
   */
  const remindPreview =
    dueIso && remind.length > 0
      ? remind
          .map((minutes) => new Date(new Date(dueIso).getTime() - minutes * 60_000))
          .map((at) => `${dayLabel(at, false)} ${timeLabel(at)}`)
          .join('、')
      : null;

  async function add(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    if (title.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await post('/api/todos', {
        title: title.trim(),
        dueAt: dueIso,
        priority,
        remindMinutes: dueIso ? remind : [],
      });
      setTitle('');
      setDueDate('');
      setDueTime('');
      setPriority(2);
      setRemind([]);
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
        <div className="grid2" style={{ marginTop: 10 }}>
          <div>
            <label className="field" htmlFor="todo-due-date">
              到期日（可留空）
            </label>
            <input
              id="todo-due-date"
              type="date"
              value={dueDate}
              min="2000-01-01"
              onChange={(changeEvent) => pickDate(changeEvent.target.value)}
            />
          </div>
          <div>
            <label className="field" htmlFor="todo-due-time">
              時間（留空為當天結束）
            </label>
            <input
              id="todo-due-time"
              type="time"
              value={dueTime}
              disabled={!dueDate}
              onChange={(changeEvent) => setDueTime(changeEvent.target.value)}
            />
          </div>
        </div>

        <div className="chips" style={{ marginTop: 10 }}>
          <button
            type="button"
            className="chip"
            data-active={dueDate === todayKey()}
            onClick={() => pickDate(dueDate === todayKey() ? '' : todayKey())}
          >
            今天
          </button>
          <button
            type="button"
            className="chip"
            data-active={dueDate === tomorrowKey()}
            onClick={() => pickDate(dueDate === tomorrowKey() ? '' : tomorrowKey())}
          >
            明天
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

        {dueDate && (
          <div style={{ marginTop: 10 }}>
            <span className="field">提醒時間（到期前多久，可多選）</span>
            <div className="chips">
              {REMIND_PRESETS.map((minutes) => (
                <button
                  type="button"
                  key={minutes}
                  className="chip"
                  data-active={remind.includes(minutes)}
                  onClick={() =>
                    setRemind((current) =>
                      current.includes(minutes)
                        ? current.filter((value) => value !== minutes)
                        : [...current, minutes].sort((a, b) => b - a),
                    )
                  }
                >
                  {label(minutes)}
                </button>
              ))}
            </div>
            {remindPreview && (
              <p className="tiny faint" style={{ marginTop: 6 }}>
                🔔 將於 {remindPreview} 提醒
              </p>
            )}
          </div>
        )}

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
          // 23:59 is the "no time given" marker, so it is noise on the list.
          const at =
            todo.dueAt && timeLabel(todo.dueAt) !== END_OF_DAY ? ` ${timeLabel(todo.dueAt)}` : '';
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
                      ? `逾期 ${Math.abs(left)} 天（${dayLabel(todo.dueAt)}${at}）`
                      : left === 0
                        ? `今天到期${at}`
                        : left === 1
                          ? `明天到期${at}`
                          : `${dayLabel(todo.dueAt)}${at}`}
                  {todo.dueAt && todo.remindMinutes.length > 0
                    ? `・🔔 ${label(todo.remindMinutes[0])}`
                    : ''}
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
