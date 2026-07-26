'use client';

/** Browser-side helpers: typed fetch plus the formatting the UI repeats. */

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

  if (response.status === 401) {
    // Session expired — bounce to login rather than showing a broken page.
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
    throw new Error('未登入');
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error((payload as { error?: string } | null)?.error ?? `HTTP ${response.status}`);
  }
  return payload as T;
}

export const post = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const patch = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });

export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });

export function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `NT$${Math.round(value).toLocaleString('en-US')}`;
}

/** Undo money()'s thousands separators so typed/pasted amounts like "93,633" parse. */
export function parseAmount(input: string): number {
  return Number(input.replace(/,/g, '').trim());
}

const TZ_OFFSET_MS = 8 * 60 * 60_000;

/** `YYYY-MM-DD` in Taipei time — matches the server's `dateKey`. */
export function dayKey(input: Date | string): string {
  const date = typeof input === 'string' ? new Date(input) : input;
  return new Date(date.getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

/** `YYYY-MM` in Taipei time. */
export function monthKey(input: Date | string): string {
  return dayKey(input).slice(0, 7);
}

export function timeLabel(input: Date | string): string {
  const date = typeof input === 'string' ? new Date(input) : input;
  return new Date(date.getTime() + TZ_OFFSET_MS).toISOString().slice(11, 16);
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export function weekdayLabel(input: Date | string): string {
  const date = typeof input === 'string' ? new Date(input) : input;
  return WEEKDAYS[new Date(date.getTime() + TZ_OFFSET_MS).getUTCDay()];
}

export function dayLabel(input: Date | string, withWeekday = true): string {
  const key = dayKey(input);
  const [, month, day] = key.split('-');
  const base = `${Number(month)}/${Number(day)}`;
  return withWeekday ? `${base} (${weekdayLabel(input)})` : base;
}

/** Turn Taipei-local form fields into the UTC ISO string the API expects. */
export function toIso(date: string, time?: string): string {
  const [hour, minute] = (time && /^\d{2}:\d{2}$/.test(time) ? time : '00:00').split(':');
  const [year, month, day] = date.split('-').map(Number);
  return new Date(
    Date.UTC(year, month - 1, day, Number(hour), Number(minute)) - TZ_OFFSET_MS,
  ).toISOString();
}

/** Today in Taipei, as `YYYY-MM-DD`, for date input defaults. */
export function todayKey(): string {
  return dayKey(new Date());
}

export function shiftMonth(period: string, delta: number): string {
  const [year, month] = period.split('-').map(Number);
  const zero = year * 12 + (month - 1) + delta;
  return `${Math.floor(zero / 12)}-${String((zero % 12) + 1).padStart(2, '0')}`;
}

export function daysUntil(input: Date | string): number {
  const target = new Date(typeof input === 'string' ? input : input.getTime());
  const startOf = (d: Date) =>
    Math.floor((d.getTime() + TZ_OFFSET_MS) / (24 * 60 * 60_000));
  return startOf(target) - startOf(new Date());
}
