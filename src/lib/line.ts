import { createHmac, timingSafeEqual } from 'node:crypto';

/** Overridable so local/staging runs can point at a stub instead of LINE. */
const LINE_API = process.env.LINE_API_BASE ?? 'https://api.line.me/v2/bot';

export type LineTextMessage = { type: 'text'; text: string; quickReply?: QuickReply };
export type LineFlexMessage = { type: 'flex'; altText: string; contents: unknown };
export type LineMessage = LineTextMessage | LineFlexMessage;

type QuickReplyItem = {
  type: 'action';
  action: { type: 'message'; label: string; text: string } | { type: 'uri'; label: string; uri: string };
};

type QuickReply = { items: QuickReplyItem[] };

/**
 * LINE signs every webhook body with the channel secret. Compare against the
 * exact raw body — re-serialising parsed JSON changes the bytes and breaks it.
 */
export function verifyLineSignature(rawBody: string, signature: string | null): boolean {
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  if (!channelSecret || !signature) return false;
  const expected = createHmac('sha256', channelSecret).update(rawBody).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function accessToken(): string {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not set');
  return token;
}

export function lineConfigured(): boolean {
  return !!process.env.LINE_CHANNEL_ACCESS_TOKEN && !!process.env.LINE_CHANNEL_SECRET;
}

async function callLine(path: string, body: unknown): Promise<void> {
  const response = await fetch(`${LINE_API}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken()}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`LINE ${path} failed: ${response.status} ${detail}`);
  }
}

/** Reply to a webhook event. Reply tokens are single-use and expire fast. */
export async function replyMessage(
  replyToken: string,
  messages: LineMessage[] | string,
): Promise<void> {
  await callLine('/message/reply', {
    replyToken,
    messages: normalise(messages),
  });
}

/** Push to the owner (or an explicit target). Used by the cron reminders. */
export async function pushMessage(
  messages: LineMessage[] | string,
  to = process.env.LINE_USER_ID,
): Promise<void> {
  if (!to) throw new Error('LINE_USER_ID is not set');
  await callLine('/message/push', { to, messages: normalise(messages) });
}

function normalise(messages: LineMessage[] | string): LineMessage[] {
  const list = typeof messages === 'string' ? [text(messages)] : messages;
  // The API rejects requests with more than 5 messages.
  return list.slice(0, 5);
}

export function text(body: string, quickReplyLabels?: string[]): LineTextMessage {
  const message: LineTextMessage = {
    type: 'text',
    // LINE truncates at 5000 characters.
    text: body.length > 4900 ? `${body.slice(0, 4900)}…` : body,
  };

  const items: QuickReplyItem[] = [];
  // A tap-through to the web app, so recording something fiddlier than a
  // one-line command (bulk edits, browsing history) doesn't need a command
  // to be remembered at all.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    items.push({ type: 'action', action: { type: 'uri', label: '🌐 開啟網站', uri: appUrl } });
  }
  if (quickReplyLabels?.length) {
    items.push(
      ...quickReplyLabels.map((label) => ({
        type: 'action' as const,
        action: { type: 'message' as const, label: label.slice(0, 20), text: label },
      })),
    );
  }
  if (items.length) {
    message.quickReply = { items: items.slice(0, 13) };
  }
  return message;
}

export const DEFAULT_QUICK_REPLIES = ['今天', '本週', '帳單', '待辦', '分析', '分類', '說明'];

/** Only the owner's LINE account may drive the bot. */
export function isOwner(userId: string | undefined): boolean {
  const owner = process.env.LINE_USER_ID;
  // Before the owner id is configured, accept the first sender so the setup
  // flow can tell the user what their id is.
  if (!owner) return false;
  return !!userId && userId === owner;
}
