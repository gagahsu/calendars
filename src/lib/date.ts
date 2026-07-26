/**
 * Everything the user sees is in Taipei time; everything we store is UTC.
 *
 * Taiwan has had no DST since 1980 and sits permanently at UTC+8, so a fixed
 * offset is correct here and avoids dragging in a tz database.
 */
export const TZ = 'Asia/Taipei';
export const TZ_OFFSET_MINUTES = 8 * 60;

export type TaipeiParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday
};

/** Split a UTC instant into Taipei-local calendar fields. */
export function toTaipeiParts(date: Date): TaipeiParts {
  const shifted = new Date(date.getTime() + TZ_OFFSET_MINUTES * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  };
}

/** Build a UTC instant from Taipei-local calendar fields. */
export function fromTaipei(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - TZ_OFFSET_MINUTES * 60_000);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` in Taipei time. This is the canonical key for a calendar day. */
export function dateKey(date: Date): string {
  const p = toTaipeiParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** `YYYY-MM` in Taipei time. */
export function periodKey(date: Date): string {
  const p = toTaipeiParts(date);
  return `${p.year}-${pad(p.month)}`;
}

/** `HH:mm` in Taipei time. */
export function timeKey(date: Date): string {
  const p = toTaipeiParts(date);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export function parseDateKey(key: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function parsePeriodKey(key: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

export function startOfTaipeiDay(date: Date): Date {
  const p = toTaipeiParts(date);
  return fromTaipei(p.year, p.month, p.day, 0, 0);
}

export function endOfTaipeiDay(date: Date): Date {
  return new Date(startOfTaipeiDay(date).getTime() + 24 * 60 * 60_000 - 1);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Add whole Taipei days, preserving the local time of day. */
export function addDays(date: Date, days: number): Date {
  const p = toTaipeiParts(date);
  return fromTaipei(p.year, p.month, p.day + days, p.hour, p.minute);
}

export function addMonths(period: string, delta: number): string {
  const parsed = parsePeriodKey(period);
  if (!parsed) throw new Error(`invalid period: ${period}`);
  const zero = parsed.year * 12 + (parsed.month - 1) + delta;
  return `${Math.floor(zero / 12)}-${pad((zero % 12) + 1)}`;
}

/** Whole Taipei days from `from` to `to`. Negative when `to` is in the past. */
export function daysBetween(from: Date, to: Date): number {
  const a = startOfTaipeiDay(from).getTime();
  const b = startOfTaipeiDay(to).getTime();
  return Math.round((b - a) / (24 * 60 * 60_000));
}

export function periodRange(period: string): { start: Date; end: Date } {
  const parsed = parsePeriodKey(period);
  if (!parsed) throw new Error(`invalid period: ${period}`);
  return {
    start: fromTaipei(parsed.year, parsed.month, 1, 0, 0),
    end: fromTaipei(parsed.year, parsed.month + 1, 1, 0, 0),
  };
}

const WEEKDAYS_ZH = ['日', '一', '二', '三', '四', '五', '六'];

export function weekdayZh(date: Date): string {
  return WEEKDAYS_ZH[toTaipeiParts(date).weekday];
}

/** e.g. `7/26 (六)` — compact form used in LINE messages. */
export function formatShortZh(date: Date, withTime = false): string {
  const p = toTaipeiParts(date);
  const base = `${p.month}/${p.day} (${WEEKDAYS_ZH[p.weekday]})`;
  return withTime ? `${base} ${pad(p.hour)}:${pad(p.minute)}` : base;
}

/** The Taipei-local "today" as a UTC instant at 00:00 Taipei. */
export function todayTaipei(now: Date = new Date()): Date {
  return startOfTaipeiDay(now);
}
