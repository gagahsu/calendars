/**
 * Thin OpenRouter client. OpenRouter exposes an OpenAI-compatible endpoint, so
 * this is just `fetch` plus a fallback chain — free-tier models get rate
 * limited often, and being able to fall through to the next one keeps the
 * monthly analysis working without a paid key.
 */
/**
 * Overridable base URL. OpenRouter is the default, but any OpenAI-compatible
 * gateway works, and local runs can point this at a stub.
 */
const BASE_URL = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
const ENDPOINT = `${BASE_URL.replace(/\/$/, '')}/chat/completions`;

/**
 * Free-tier slugs get retired without notice — the previous three fallbacks
 * had all started answering 404 ("unavailable for free"), which left the chain
 * with no working link behind the router. Every entry here was verified to
 * answer and to support `response_format`. Re-check with
 * `GET /api/v1/models` (pricing.prompt === '0') when one starts failing.
 */
const DEFAULT_MODELS = [
  // OpenRouter's own router: picks a free model at random and adapts to the
  // request (e.g. tool use, images). Tried first; the pinned models below
  // are the fallback if the router endpoint itself has an issue, or if the
  // model it happens to route to answers with nothing usable.
  'openrouter/free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'openai/gpt-oss-20b:free',
  'google/gemma-4-26b-a4b-it:free',
];

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export function openRouterConfigured(): boolean {
  return !!process.env.OPENROUTER_API_KEY;
}

export function configuredModels(): string[] {
  const raw = process.env.OPENROUTER_MODELS;
  if (!raw) return DEFAULT_MODELS;
  const models = raw
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  return models.length > 0 ? models : DEFAULT_MODELS;
}

export class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly attempts: Array<{ model: string; error: string }>,
  ) {
    super(message);
    this.name = 'OpenRouterError';
  }
}

type ChatOptions = {
  /** Ask the model for JSON and validate that we got some. */
  json?: boolean;
  /**
   * Checked against the parsed JSON before a model's answer is accepted.
   * Syntactically valid JSON that is missing everything the caller asked for
   * is a failed answer, not a successful one — without this the first model to
   * return `{}` ends the chain and the remaining models never get a turn.
   */
  validate?: (parsed: unknown) => boolean;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
};

export type ChatResult = { content: string; model: string };

export async function chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new OpenRouterError('OPENROUTER_API_KEY 未設定', []);

  // Free models are slow and verbose: one observed run took 93s, and a JSON
  // reply in Chinese burns roughly a token per character, so both of these
  // used to cut healthy answers off rather than wait for them.
  const {
    json = false,
    validate,
    temperature = 0.4,
    maxTokens = 3000,
    timeoutMs = 60_000,
  } = options;
  const attempts: Array<{ model: string; error: string }> = [];

  for (const model of configuredModels()) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          // OpenRouter uses these for attribution on its dashboard.
          'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
          'X-Title': 'Calendars',
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
          ...(json ? { response_format: { type: 'json_object' } } : {}),
        }),
      });

      if (!response.ok) {
        attempts.push({ model, error: `HTTP ${response.status} ${await safeText(response)}` });
        continue;
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
      };
      const content = payload.choices?.[0]?.message?.content?.trim();
      if (!content) {
        attempts.push({ model, error: payload.error?.message ?? 'empty completion' });
        continue;
      }
      if (json) {
        const parsed = extractJson(content);
        if (!parsed) {
          attempts.push({ model, error: 'response was not valid JSON' });
          continue;
        }
        if (validate && !validate(parsed)) {
          attempts.push({ model, error: 'JSON had none of the requested fields' });
          continue;
        }
      }
      return { content, model };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      attempts.push({ model, error: controller.signal.aborted ? 'timeout' : reason });
    } finally {
      clearTimeout(timer);
    }
  }

  throw new OpenRouterError('所有模型都呼叫失敗', attempts);
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return '';
  }
}

/**
 * Models wrap JSON in prose or ```json fences even when told not to. Pull the
 * first balanced object out of the response.
 */
export function extractJson<T = unknown>(content: string): T | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(content);
  const candidates = [fenced?.[1], content].filter((c): c is string => !!c);

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    const direct = tryParse<T>(trimmed);
    if (direct !== null) return direct;

    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start !== -1 && end > start) {
      const sliced = tryParse<T>(trimmed.slice(start, end + 1));
      if (sliced !== null) return sliced;
    }
  }
  return null;
}

function tryParse<T>(value: string): T | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as T) : null;
  } catch {
    return null;
  }
}
