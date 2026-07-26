import { fromTaipei, toTaipeiParts, daysInMonth } from './date';
import { guessCategory, isCategoryKey, type CategoryKey } from './categories';

/**
 * Parses the free-text messages people actually type into LINE.
 *
 * Design: everything is keyword-driven and deterministic — no model call on the
 * hot path, so recording an expense stays instant and works when OpenRouter is
 * rate limited. Unrecognised input falls back to `unknown`, and the bot replies
 * with usage help.
 */

export type Command =
  | { kind: 'expense'; amount: number; merchant: string | null; category: CategoryKey; spentAt: Date; cardHint: string | null }
  | { kind: 'todo_add'; title: string; dueAt: Date | null }
  | { kind: 'todo_list' }
  | { kind: 'todo_done'; ref: string }
  | { kind: 'event_add'; title: string; startsAt: Date; allDay: boolean }
  | { kind: 'agenda'; range: 'today' | 'tomorrow' | 'week' }
  | { kind: 'bills' }
  | { kind: 'bill_amount'; cardHint: string; amount: number }
  | { kind: 'bill_paid'; cardHint: string }
  | { kind: 'card_list' }
  | { kind: 'category_list' }
  | { kind: 'card_add'; name: string; statementDay: number; dueDay: number }
  | { kind: 'insight'; period: string | null }
  | { kind: 'summary' }
  | { kind: 'help' }
  | { kind: 'unknown'; text: string };

const WEEKDAY_WORDS: Record<string, number> = {
  日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6,
};

/** Strip full-width digits/punctuation so `１２０` and `：` behave like ASCII. */
function normalise(input: string): string {
  return input
    .replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10))
    .replace(/[：]/g, ':')
    .replace(/[／]/g, '/')
    .replace(/[，]/g, ',')
    .replace(/　/g, ' ')
    .trim();
}

// ---------------------------------------------------------------- dates

/**
 * Which way to resolve a date that names no year (`7/26`, `20號`).
 * Expenses are recorded after the fact, events are scheduled ahead — guessing
 * per command beats a single symmetric rule.
 */
export type DateBias = 'past' | 'future';

/**
 * Pull a date out of `text`, returning the Taipei midnight instant plus the
 * text with the date token removed.
 */
export function extractDate(
  text: string,
  now: Date,
  bias: DateBias = 'future',
): { date: Date | null; rest: string } {
  const today = toTaipeiParts(now);
  const dayOf = (offset: number) => fromTaipei(today.year, today.month, today.day + offset, 0, 0);

  const relative: Array<[RegExp, number]> = [
    [/前天/, -2],
    [/昨天|昨日/, -1],
    [/今天|今日|本日/, 0],
    [/明天|明日/, 1],
    [/後天/, 2],
    [/大後天/, 3],
  ];
  for (const [pattern, offset] of relative) {
    if (pattern.test(text)) {
      return { date: dayOf(offset), rest: text.replace(pattern, ' ') };
    }
  }

  // 下週三 / 這週五 / 星期一 / 禮拜六
  const weekday = /(下下|下|這|本)?\s*(?:週|周|星期|禮拜|拜)([日天一二三四五六])/.exec(text);
  if (weekday) {
    const target = WEEKDAY_WORDS[weekday[2]];
    let offset = (target - today.weekday + 7) % 7;
    if (weekday[1] === '下') offset += 7;
    else if (weekday[1] === '下下') offset += 14;
    return { date: dayOf(offset), rest: text.replace(weekday[0], ' ') };
  }

  // 2026-07-26 / 2026/7/26
  const iso = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(text);
  if (iso) {
    const [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    if (isValidYmd(year, month, day)) {
      return { date: fromTaipei(year, month, day, 0, 0), rest: text.replace(iso[0], ' ') };
    }
  }

  // 7/26 or 7月26日 — year inferred from the bias.
  const monthDay = /(\d{1,2})\s*(?:\/|月)\s*(\d{1,2})\s*(?:日|號)?/.exec(text);
  if (monthDay) {
    const month = Number(monthDay[1]);
    const day = Number(monthDay[2]);
    if (isValidYmd(today.year, month, day)) {
      let year = today.year;
      const thisYear = fromTaipei(year, month, day, 0, 0);
      if (bias === 'past' && thisYear.getTime() > dayOf(0).getTime()) year -= 1;
      if (bias === 'future' && thisYear.getTime() < dayOf(0).getTime()) year += 1;
      // Feb 29 may not exist in the shifted year.
      const safeDay = Math.min(day, daysInMonth(year, month));
      return {
        date: fromTaipei(year, month, safeDay, 0, 0),
        rest: text.replace(monthDay[0], ' '),
      };
    }
  }

  // Bare 26日 / 26號 → that day of the closest month in the bias direction.
  const bareDay = /(?:^|\s)(\d{1,2})\s*(?:日|號)(?:\s|$)/.exec(text);
  if (bareDay) {
    const day = Number(bareDay[1]);
    if (day >= 1 && day <= 31) {
      let year = today.year;
      let month = today.month;
      if (bias === 'past' && day > today.day) month -= 1;
      if (bias === 'future' && day < today.day) month += 1;
      if (month < 1) {
        month = 12;
        year -= 1;
      } else if (month > 12) {
        month = 1;
        year += 1;
      }
      if (day <= daysInMonth(year, month)) {
        return {
          date: fromTaipei(year, month, day, 0, 0),
          rest: text.replace(bareDay[0], ' '),
        };
      }
    }
  }

  return { date: null, rest: text };
}

function isValidYmd(year: number, month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

/** Pull a time-of-day out of `text`. */
export function extractTime(text: string): { hour: number; minute: number; rest: string } | null {
  const meridiem = /(上午|早上|早|清晨|中午|下午|傍晚|晚上|晚|凌晨|半夜)/.exec(text);

  // 14:30 / 14點30分 / 9點半 / 9點
  const explicit = /(\d{1,2})\s*(?::|點|时|時)\s*(\d{1,2})?\s*(分|半)?/.exec(text);
  if (explicit) {
    let hour = Number(explicit[1]);
    let minute = explicit[2] ? Number(explicit[2]) : 0;
    if (explicit[3] === '半' && !explicit[2]) minute = 30;
    if (hour > 23 || minute > 59) return null;
    hour = applyMeridiem(hour, meridiem?.[1]);
    let rest = text.replace(explicit[0], ' ');
    if (meridiem) rest = rest.replace(meridiem[0], ' ');
    return { hour, minute, rest };
  }

  // 「下午三點」handled above; 「中午」/「晚上」alone give a sensible default hour.
  if (meridiem) {
    const defaults: Record<string, number> = {
      清晨: 6, 早上: 8, 早: 8, 上午: 9, 中午: 12, 下午: 14, 傍晚: 17, 晚上: 19, 晚: 19, 凌晨: 1, 半夜: 0,
    };
    const hour = defaults[meridiem[1]];
    if (hour !== undefined) {
      return { hour, minute: 0, rest: text.replace(meridiem[0], ' ') };
    }
  }
  return null;
}

function applyMeridiem(hour: number, word?: string): number {
  if (!word) return hour;
  const isPm = ['下午', '傍晚', '晚上', '晚'].includes(word);
  const isAm = ['上午', '早上', '早', '清晨'].includes(word);
  if (word === '中午') return hour === 12 ? 12 : hour + 12 > 23 ? hour : 12;
  if (isPm && hour < 12) return hour + 12;
  if (isAm && hour === 12) return 0;
  if (['凌晨', '半夜'].includes(word) && hour === 12) return 0;
  return hour;
}

// ---------------------------------------------------------------- amounts

/** First money-looking number in the text: `1,200`, `120`, `35.5`, `1200元`. */
export function extractAmount(text: string): { amount: number; rest: string } | null {
  const match = /(?<![\d/:-])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d{1,2})?)\s*(?:元|塊|NT\$?|\$)?/i.exec(text);
  if (!match) return null;
  const amount = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount, rest: text.replace(match[0], ' ') };
}

function tidy(text: string): string {
  return text.replace(/\s+/g, ' ').trim().replace(/^[,、]+|[,、]+$/g, '').trim();
}

// ---------------------------------------------------------------- commands

export function parseCommand(raw: string, now: Date = new Date()): Command {
  const input = normalise(raw);
  if (!input) return { kind: 'unknown', text: raw };
  const lower = input.toLowerCase();

  if (/^(說明|help|幫助|指令|\?|？|使用說明)$/i.test(lower)) return { kind: 'help' };
  if (/^(今天|今日|today)$/i.test(lower)) return { kind: 'agenda', range: 'today' };
  if (/^(明天|明日|tomorrow)$/i.test(lower)) return { kind: 'agenda', range: 'tomorrow' };
  if (/^(本週|這週|本周|這周|一週|week|七天)$/i.test(lower)) return { kind: 'agenda', range: 'week' };
  if (/^(總覽|概況|狀態|summary|dashboard)$/i.test(lower)) return { kind: 'summary' };
  if (/^(帳單|繳費|信用卡帳單|bills?)$/i.test(lower)) return { kind: 'bills' };
  if (/^(卡片|我的卡|卡片列表|cards?)$/i.test(lower)) return { kind: 'card_list' };
  if (/^(分類|分類說明|分類列表|categor(?:y|ies))$/i.test(lower)) return { kind: 'category_list' };
  if (/^(待辦|待辦事項|todo|todos|清單)$/i.test(lower)) return { kind: 'todo_list' };

  // 分析 / 分析 2026-06 / 分析 6月
  const insight = /^(分析|消費分析|報告|analy(?:se|ze|sis)|insight)\s*(.*)$/i.exec(input);
  if (insight) {
    const arg = insight[2].trim();
    const iso = /^(\d{4})[-/](\d{1,2})$/.exec(arg);
    if (iso) {
      return { kind: 'insight', period: `${iso[1]}-${String(Number(iso[2])).padStart(2, '0')}` };
    }
    const monthOnly = /^(\d{1,2})\s*月?$/.exec(arg);
    if (monthOnly) {
      const month = Number(monthOnly[1]);
      const today = toTaipeiParts(now);
      if (month >= 1 && month <= 12) {
        // A month later than the current one refers to last year.
        const year = month > today.month ? today.year - 1 : today.year;
        return { kind: 'insight', period: `${year}-${String(month).padStart(2, '0')}` };
      }
    }
    if (/^(上月|上個月)$/.test(arg)) {
      const today = toTaipeiParts(now);
      const zero = today.year * 12 + (today.month - 1) - 1;
      return {
        kind: 'insight',
        period: `${Math.floor(zero / 12)}-${String((zero % 12) + 1).padStart(2, '0')}`,
      };
    }
    return { kind: 'insight', period: null };
  }

  // 已繳 國泰 / 繳了 台新
  const paid = /^(已繳|繳了|已付|付了|paid)\s*(.+)$/i.exec(input);
  if (paid) {
    const cardHint = tidy(paid[2].replace(/(帳單|卡|了)/g, ' '));
    if (cardHint) return { kind: 'bill_paid', cardHint };
  }

  // 帳單 國泰 3200 / 國泰帳單 3200
  const billAmount =
    /^(?:帳單|對帳單)\s*(.+?)\s+([\d,]+(?:\.\d{1,2})?)\s*(?:元)?$/.exec(input) ??
    /^(.+?)\s*(?:帳單|對帳單)\s*([\d,]+(?:\.\d{1,2})?)\s*(?:元)?$/.exec(input);
  if (billAmount) {
    const amount = Number(billAmount[2].replace(/,/g, ''));
    const cardHint = tidy(billAmount[1]);
    if (cardHint && Number.isFinite(amount) && amount > 0) {
      return { kind: 'bill_amount', cardHint, amount };
    }
  }

  // 新增卡片 國泰CUBE 結帳15 繳費5
  const cardAdd = /^(?:新增卡片|加卡|新卡|add ?card)\s*(.+)$/i.exec(input);
  if (cardAdd) {
    const body = cardAdd[1];
    const statement = /(?:結帳|帳單|關帳)\s*(\d{1,2})/.exec(body);
    const due = /(?:繳費|繳款|到期|付款)\s*(\d{1,2})/.exec(body);
    let name = body;
    if (statement) name = name.replace(statement[0], ' ');
    if (due) name = name.replace(due[0], ' ');
    name = tidy(name.replace(/[日號]/g, ' '));
    if (name && statement && due) {
      const statementDay = Number(statement[1]);
      const dueDay = Number(due[1]);
      if (statementDay >= 1 && statementDay <= 31 && dueDay >= 1 && dueDay <= 31) {
        return { kind: 'card_add', name, statementDay, dueDay };
      }
    }
  }

  // 完成 2 / 完成 買牛奶 / done 1
  const done = /^(?:完成|做完了?|勾選|done|finish)\s*(.+)$/i.exec(input);
  if (done) {
    const ref = tidy(done[1]);
    if (ref) return { kind: 'todo_done', ref };
  }

  // 待辦 買牛奶 明天 / todo 繳水電費
  const todoAdd = /^(?:待辦|todo|任務|事項|記得|要做)\s*(.+)$/i.exec(input);
  if (todoAdd) {
    const { date, rest } = extractDate(todoAdd[1], now, 'future');
    const time = extractTime(rest);
    const title = tidy(time ? time.rest : rest);
    if (title) {
      let dueAt: Date | null = null;
      if (date) {
        const p = toTaipeiParts(date);
        dueAt = fromTaipei(p.year, p.month, p.day, time?.hour ?? 23, time?.minute ?? 59);
      } else if (time) {
        const today = toTaipeiParts(now);
        dueAt = fromTaipei(today.year, today.month, today.day, time.hour, time.minute);
      }
      return { kind: 'todo_add', title, dueAt };
    }
  }

  // 行程 3/5 14:00 看牙醫 / 提醒 明天 9點 開會
  const eventAdd = /^(?:行程|活動|提醒|安排|會議|預約|新增行程|event)\s*(.+)$/i.exec(input);
  if (eventAdd) {
    const { date, rest } = extractDate(eventAdd[1], now, 'future');
    const time = extractTime(rest);
    const title = tidy(time ? time.rest : rest);
    if (title) {
      const base = date ?? now;
      const p = toTaipeiParts(base);
      const startsAt = time
        ? fromTaipei(p.year, p.month, p.day, time.hour, time.minute)
        : fromTaipei(p.year, p.month, p.day, 9, 0);
      return { kind: 'event_add', title, startsAt, allDay: !time };
    }
  }

  // 記 120 午餐 / 花 350 星巴克 昨天 / -120 停車
  const expense =
    /^(?:記帳?|花了?|支出|消費|買|spend|expense)\s*(.+)$/i.exec(input) ??
    /^-\s*(.+)$/.exec(input) ??
    (/^[\d,]+(?:\.\d{1,2})?\s*(?:元|塊)?(?:\s|$)/.test(input) ? [input, input] : null);
  if (expense) {
    const body = expense[1];
    // Spending is recorded after it happened, so a bare date means the past.
    const { date, rest: afterDate } = extractDate(body, now, 'past');
    const money = extractAmount(afterDate);
    if (money) {
      const cardMatch = /(?:用|刷)\s*([^\s]{1,12}?)\s*(?:卡)?(?:\s|$)/.exec(money.rest);
      const cardHint = cardMatch ? tidy(cardMatch[1]) : null;
      const withoutCard = cardMatch ? money.rest.replace(cardMatch[0], ' ') : money.rest;
      const label = tidy(withoutCard.replace(/^(?:元|塊)/, ' '));
      const categoryOverride = /^#(\S+)/.exec(label);
      const merchant = tidy(label.replace(/^#\S+/, ' ')) || null;
      const category =
        categoryOverride && isCategoryKey(categoryOverride[1])
          ? (categoryOverride[1] as CategoryKey)
          : guessCategory(`${merchant ?? ''} ${cardHint ?? ''}`);
      const spentAt = date ?? now;
      return { kind: 'expense', amount: money.amount, merchant, category, spentAt, cardHint };
    }
  }

  return { kind: 'unknown', text: raw };
}

export const HELP_TEXT = [
  '📖 使用說明',
  '',
  '【記帳】',
  '・記 120 午餐',
  '・花 350 星巴克 昨天',
  '・記 1200 家樂福 7/20 刷國泰',
  '・120 停車費（直接打數字也可以）',
  '・記 300 #pet 貓罐頭（用 #代碼 強制指定分類）',
  '・分類（看所有分類代碼）',
  '',
  '【待辦】',
  '・待辦 繳水電費 明天',
  '・待辦（看清單）',
  '・完成 1 或 完成 繳水電費',
  '',
  '【行程】',
  '・行程 3/5 14:00 看牙醫',
  '・提醒 下週三 早上9點 開會',
  '',
  '【信用卡】',
  '・帳單（看未繳帳單）',
  '・帳單 國泰 3200（登記金額）',
  '・已繳 國泰',
  '・新增卡片 國泰CUBE 結帳15 繳費5',
  '・卡片（看所有卡片設定）',
  '',
  '【查詢與分析】',
  '・今天 / 明天 / 本週',
  '・總覽',
  '・分析（本月消費分析與節省建議）',
  '・分析 2026-06 或 分析 上月',
].join('\n');
