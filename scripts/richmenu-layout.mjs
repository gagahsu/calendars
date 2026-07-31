/**
 * The LINE rich menu: one definition, used twice.
 *
 * `generate-richmenu.mjs` draws the image from it and `setup-richmenu.mjs`
 * derives the tappable areas from it, so the picture and the hit boxes cannot
 * drift apart. Change a cell here and re-run both.
 *
 * 2500x1686 is the large rich menu size; LINE rejects anything else in that
 * family, so the grid below is fixed rather than computed from a cell size.
 */

export const WIDTH = 2500;
export const HEIGHT = 1686;

export const MENU_NAME = 'calendars-main';
export const CHAT_BAR_TEXT = '選單'; // LINE caps this at 14 characters.

// Same palette as the PWA icons (scripts/generate-icons.py).
const BG_TOP = '#4F63D2';
const BG_BOTTOM = '#6D8CFF';
const INK = '#FFFFFF';
const ACCENT = '#FFB454';

const FONTS = "'Microsoft JhengHei','PingFang TC','Noto Sans CJK TC','Hiragino Sans','Heiti TC',sans-serif";

/**
 * The menu is drawn 2500px wide but shown at phone width — around 390pt — so
 * everything here lands on screen at roughly a sixth of its value. Divide by
 * 6.4 to read these as points: the 152px label is about 24pt, the 70px
 * sub-label about 11pt. That ratio is why the sizes look oversized in the PNG.
 */
const ICON_BOX = 160; // the coordinate space the ICONS paths are written in
const ICON_SIZE = 210; // how large that box is actually drawn
const LABEL_SIZE = 152;
const SUB_SIZE = 70;

const COLS = [
  { x: 0, width: 833 },
  { x: 833, width: 834 },
  { x: 1667, width: 833 },
];
const ROWS = [
  { y: 0, height: 843 },
  { y: 843, height: 843 },
];

/**
 * Icons are drawn in a local 160x160 box so each one can be written in plain
 * coordinates and then dropped wherever the grid puts it.
 */
const ICONS = {
  // A plus in a rounded square — "add one".
  add: `
    <rect x="20" y="20" width="120" height="120" rx="26" />
    <path d="M80 56 V104 M56 80 H104" />`,
  // Credit card.
  card: `
    <rect x="14" y="34" width="132" height="92" rx="15" />
    <path d="M14 66 H146" stroke-width="16" />
    <path d="M36 101 H72" />`,
  // Checklist: two done, one still open.
  checklist: `
    <path d="M20 46 L34 60 L60 31" />
    <path d="M80 46 H146" />
    <path d="M20 86 L34 100 L60 71" />
    <path d="M80 86 H146" />
    <rect x="20" y="112" width="28" height="28" rx="7" />
    <path d="M80 126 H124" />`,
  // Calendar with today marked.
  calendar: `
    <rect x="15" y="30" width="130" height="115" rx="15" />
    <path d="M15 63 H145" />
    <path d="M48 15 V42 M112 15 V42" />
    <circle cx="80" cy="106" r="13" fill="currentColor" stroke="none" />`,
  // Bar chart.
  chart: `
    <path d="M14 148 H146" />
    <rect x="26" y="92" width="28" height="46" rx="7" fill="currentColor" stroke="none" />
    <rect x="66" y="56" width="28" height="82" rx="7" fill="currentColor" stroke="none" />
    <rect x="106" y="30" width="28" height="108" rx="7" fill="currentColor" stroke="none" />`,
  // Globe.
  globe: `
    <circle cx="80" cy="80" r="63" />
    <ellipse cx="80" cy="80" rx="27" ry="63" />
    <path d="M17 80 H143 M30 45 H130 M30 115 H130" />`,
};

/**
 * Reading order matches how often each one gets used: the thing you do several
 * times a day sits first and is the only cell painted in the accent colour.
 *
 * `fillInText` is the reason this menu is worth building by API rather than in
 * the Official Account Manager — it opens the keyboard with the command prefix
 * already typed, so recording a spend is one tap plus the amount.
 */
export const CELLS = [
  {
    col: 0, row: 0,
    icon: 'add', label: '記帳', sub: '點一下開始輸入', primary: true,
    action: {
      type: 'postback',
      label: '記帳',
      data: 'richmenu=expense',
      inputOption: 'openKeyboard',
      fillInText: '記 ',
    },
  },
  {
    col: 1, row: 0,
    icon: 'card', label: '帳單', sub: '未繳與到期日',
    action: { type: 'message', label: '帳單', text: '帳單' },
  },
  {
    col: 2, row: 0,
    icon: 'checklist', label: '待辦', sub: '清單與逾期',
    action: { type: 'message', label: '待辦', text: '待辦' },
  },
  {
    col: 0, row: 1,
    icon: 'calendar', label: '今天', sub: '今日行程',
    action: { type: 'message', label: '今天', text: '今天' },
  },
  {
    col: 1, row: 1,
    icon: 'chart', label: '分析', sub: '本月消費',
    action: { type: 'message', label: '分析', text: '分析' },
  },
  {
    col: 2, row: 1,
    icon: 'globe', label: '網站', sub: '開啟完整版',
    // Filled in by setup-richmenu.mjs, which knows the deployed URL.
    action: { type: 'uri', label: '網站', uri: null },
  },
];

/** The pixel rectangle a cell occupies. */
export function boundsOf(cell) {
  const col = COLS[cell.col];
  const row = ROWS[cell.row];
  return { x: col.x, y: row.y, width: col.width, height: row.height };
}

export function buildSvg() {
  const parts = [];

  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`);
  parts.push(`<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">`);
  parts.push(`<stop offset="0" stop-color="${BG_TOP}"/><stop offset="1" stop-color="${BG_BOTTOM}"/>`);
  parts.push(`</linearGradient></defs>`);
  parts.push(`<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>`);

  for (const cell of CELLS) {
    const { x, y, width, height } = boundsOf(cell);
    const cx = x + width / 2;
    const cy = y + height / 2;
    const colour = cell.primary ? ACCENT : INK;

    // A faint wash so the primary cell reads as the one to reach for.
    if (cell.primary) {
      parts.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${ACCENT}" fill-opacity="0.13"/>`);
    }

    // Icon, label and sub-label as one block centred in the cell.
    parts.push(
      `<g transform="translate(${cx - ICON_SIZE / 2} ${cy - 260}) scale(${ICON_SIZE / ICON_BOX})"` +
      ` color="${colour}" fill="none" stroke="currentColor" stroke-width="9"` +
      ` stroke-linecap="round" stroke-linejoin="round">${ICONS[cell.icon]}</g>`,
    );

    parts.push(
      `<text x="${cx}" y="${cy + 157}" text-anchor="middle" font-family="${FONTS}"` +
      ` font-size="${LABEL_SIZE}" font-weight="bold" fill="${colour}" letter-spacing="8">${cell.label}</text>`,
    );
    parts.push(
      `<text x="${cx}" y="${cy + 260}" text-anchor="middle" font-family="${FONTS}"` +
      ` font-size="${SUB_SIZE}" fill="${INK}" fill-opacity="0.66" letter-spacing="2">${cell.sub}</text>`,
    );
  }

  // Grid lines last so they sit above the primary cell's wash.
  for (const col of COLS.slice(1)) {
    parts.push(`<rect x="${col.x - 1}" y="0" width="3" height="${HEIGHT}" fill="${INK}" fill-opacity="0.16"/>`);
  }
  parts.push(`<rect x="0" y="${ROWS[1].y - 1}" width="${WIDTH}" height="3" fill="${INK}" fill-opacity="0.16"/>`);

  parts.push('</svg>');
  return parts.join('');
}
