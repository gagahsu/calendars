import { NextResponse } from 'next/server';

/** Small helpers so route handlers stay about behaviour, not plumbing. */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function badRequest(message: string): never {
  throw new HttpError(400, message);
}

export function notFound(message = '找不到資料'): never {
  throw new HttpError(404, message);
}

/** Wraps a handler so thrown HttpErrors become responses instead of 500s. */
export async function handle(fn: () => Promise<unknown>): Promise<Response> {
  try {
    const data = await fn();
    // Handlers that need control over status/cookies return a Response directly.
    if (data instanceof Response) return data;
    return NextResponse.json(data ?? { ok: true });
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[api]', error);
    const message = error instanceof Error ? error.message : '伺服器錯誤';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) badRequest('請提供 JSON 物件');
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    badRequest('JSON 格式錯誤');
  }
}

export function str(
  body: Record<string, unknown>,
  key: string,
  { required = false, max = 500 }: { required?: boolean; max?: number } = {},
): string | null {
  const value = body[key];
  if (value === undefined || value === null || value === '') {
    if (required) badRequest(`缺少必填欄位：${key}`);
    return null;
  }
  if (typeof value !== 'string') badRequest(`${key} 必須是文字`);
  const trimmed = value.trim();
  if (!trimmed) {
    if (required) badRequest(`${key} 不可為空白`);
    return null;
  }
  if (trimmed.length > max) badRequest(`${key} 太長（上限 ${max} 字）`);
  return trimmed;
}

export function num(
  body: Record<string, unknown>,
  key: string,
  { required = false, min, max }: { required?: boolean; min?: number; max?: number } = {},
): number | null {
  const value = body[key];
  if (value === undefined || value === null || value === '') {
    if (required) badRequest(`缺少必填欄位：${key}`);
    return null;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) badRequest(`${key} 必須是數字`);
  if (min !== undefined && parsed < min) badRequest(`${key} 不可小於 ${min}`);
  if (max !== undefined && parsed > max) badRequest(`${key} 不可大於 ${max}`);
  return parsed;
}

export function int(
  body: Record<string, unknown>,
  key: string,
  options: { required?: boolean; min?: number; max?: number } = {},
): number | null {
  const value = num(body, key, options);
  return value === null ? null : Math.round(value);
}

export function bool(body: Record<string, unknown>, key: string): boolean | null {
  const value = body[key];
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  badRequest(`${key} 必須是 true 或 false`);
}

export function date(
  body: Record<string, unknown>,
  key: string,
  { required = false }: { required?: boolean } = {},
): Date | null {
  const value = body[key];
  if (value === undefined || value === null || value === '') {
    if (required) badRequest(`缺少必填欄位：${key}`);
    return null;
  }
  if (typeof value !== 'string' && typeof value !== 'number') badRequest(`${key} 日期格式錯誤`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) badRequest(`${key} 日期格式錯誤`);
  return parsed;
}

export function intArray(
  body: Record<string, unknown>,
  key: string,
  { min, max, maxLength = 20 }: { min?: number; max?: number; maxLength?: number } = {},
): number[] | null {
  const value = body[key];
  if (value === undefined || value === null) return null;
  const list = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',').filter((v) => v.trim() !== '')
      : badRequest(`${key} 必須是陣列`);
  if (list.length > maxLength) badRequest(`${key} 最多 ${maxLength} 項`);
  const parsed = list.map((item) => {
    const n = Number(item);
    if (!Number.isFinite(n)) badRequest(`${key} 只能放數字`);
    const rounded = Math.round(n);
    if (min !== undefined && rounded < min) badRequest(`${key} 不可小於 ${min}`);
    if (max !== undefined && rounded > max) badRequest(`${key} 不可大於 ${max}`);
    return rounded;
  });
  return [...new Set(parsed)].sort((a, b) => b - a);
}
