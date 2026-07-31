/**
 * Install public/richmenu.png as the LINE rich menu for every user of the bot.
 *
 * Idempotent: any previous menu of the same name is removed first, so this is
 * the one command to run after editing scripts/richmenu-layout.mjs.
 *
 * Usage: npm run richmenu:install
 *
 * Requires LINE_CHANNEL_ACCESS_TOKEN, and an https app URL for the 網站 cell —
 * RICHMENU_APP_URL wins over NEXT_PUBLIC_APP_URL, which is usually localhost
 * during development and would be rejected by LINE.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import { CELLS, CHAT_BAR_TEXT, HEIGHT, MENU_NAME, WIDTH, boundsOf } from './richmenu-layout.mjs';

// Creating the menu and uploading its image live on different hosts. Posting
// the image to api.line.me answers 404, which is a confusing way to find out.
const API = 'https://api.line.me/v2/bot';
const DATA_API = 'https://api-data.line.me/v2/bot';

const IMAGE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
  'richmenu.png',
);

const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not set');

const appUrl = process.env.RICHMENU_APP_URL || process.env.NEXT_PUBLIC_APP_URL;
if (!appUrl || !appUrl.startsWith('https://')) {
  throw new Error(
    `the 網站 button needs an https URL, got ${appUrl || '(unset)'}.\n` +
      'Run with RICHMENU_APP_URL=https://your-app.vercel.app npm run richmenu:install',
  );
}

async function call(base, endpoint, { method = 'POST', body, contentType = 'application/json' } = {}) {
  const response = await fetch(`${base}${endpoint}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': contentType } : {}) },
    body,
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`${method} ${endpoint} -> ${response.status} ${raw}`);
  return raw ? JSON.parse(raw) : {};
}

// The image and the tap targets come from the same layout module, so this only
// has to confirm the file on disk was regenerated after the last layout change.
const image = await readFile(IMAGE);
const meta = await sharp(image).metadata();
if (meta.width !== WIDTH || meta.height !== HEIGHT) {
  throw new Error(`${IMAGE} is ${meta.width}x${meta.height}; run npm run richmenu:image first`);
}

const areas = CELLS.map((cell) => ({
  bounds: boundsOf(cell),
  action: cell.action.type === 'uri' ? { ...cell.action, uri: appUrl } : cell.action,
}));

const { richmenus = [] } = await call(API, '/richmenu/list', { method: 'GET' });
for (const menu of richmenus.filter((m) => m.name === MENU_NAME)) {
  await call(API, `/richmenu/${menu.richMenuId}`, { method: 'DELETE' });
  console.log(`removed previous menu ${menu.richMenuId}`);
}

const { richMenuId } = await call(API, '/richmenu', {
  body: JSON.stringify({
    size: { width: WIDTH, height: HEIGHT },
    // Open by default: the point of the menu is that 記帳 is one tap away.
    selected: true,
    name: MENU_NAME,
    chatBarText: CHAT_BAR_TEXT,
    areas,
  }),
});
console.log(`created ${richMenuId}`);

await call(DATA_API, `/richmenu/${richMenuId}/content`, {
  body: image,
  contentType: 'image/png',
});
console.log(`uploaded image (${(image.byteLength / 1024).toFixed(0)} KB)`);

await call(API, `/user/all/richmenu/${richMenuId}`);
console.log(`set as the default menu for all users — open the chat to see it`);
