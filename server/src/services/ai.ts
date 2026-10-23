import { loadConfig } from '../config';

// 错误码
export const API_ERRORS = {
  API_KEY_NOT_CONFIGURED: 'API_KEY_NOT_CONFIGURED',
  REQUEST_FAILED: 'REQUEST_FAILED',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
};

function ensureApiKey(): string {
  const config = loadConfig();
  if (!config.openaiApiKey) {
    const err = new Error('请先在设置页配置 OpenAI API Key') as Error & { code: string };
    err.code = API_ERRORS.API_KEY_NOT_CONFIGURED;
    throw err;
  }
  return config.openaiApiKey;
}

// 需要被剥离的端点路径后缀（当用户把完整端点填入 Base URL 时）
const ENDPOINT_SUFFIXES = [
  '/chat/completions',
  '/embeddings',
  '/v1/chat/completions',
  '/v1/embeddings',
  '/chat/completions/',
  '/embeddings/',
  '/v1/chat/completions/',
  '/v1/embeddings/',
];

/**
 * 规范化 OpenAI 兼容 baseUrl：
 * 1. 去掉末尾多余斜杠
 * 2. 若用户填入了完整端点（如 .../chat/completions、.../v1/embeddings），智能剥离，统一由代码拼端点
 */
export function normalizeBaseUrl(raw: string): string {
  let url = (raw || '').trim();
  if (!url) return url;

  // 循环剥离已知端点后缀（可能用户填了嵌套，如 /v1/chat/completions 只剥离一次即可）
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of ENDPOINT_SUFFIXES) {
      if (url.endsWith(suffix)) {
        url = url.slice(0, url.length - suffix.length).replace(/\/$/, '');
        changed = true;
      }
    }
  }
  return url.replace(/\/$/, '');
}

function getBaseUrl(): string {
  const config = loadConfig();
  return normalizeBaseUrl(config.openaiBaseUrl);
}

// ========== 带超时的 fetch（防止挂起导致前端永久转圈 / 主进程堆积） ==========
const DEFAULT_TIMEOUT_MS = 30_000;

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      const e = new Error(`请求超时（${Math.round(timeoutMs / 1000)}秒无响应），请检查服务地址与网络`) as Error & { code: string };
      e.code = 'REQUEST_TIMEOUT';
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ========== Chat Completion ==========
/** 多模态消息内容分片（OpenAI 兼容 vision 格式） */
export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ChatContentPart[];
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
}

/** 判断消息列表中是否含图片（用于识别模型不支持视觉的场景） */
export function messagesContainImage(messages: ChatMessage[]): boolean {
  return messages.some(
    (m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url')
  );
}

/** 模型返回视觉不支持错误时，转换为用户可理解的错误码 */
function asVisionErrorIfNeeded(
  messages: ChatMessage[],
  status: number,
  errText: string
): (Error & { code: string; status: number }) | null {
  if (!messagesContainImage(messages)) return null;
  const lower = errText.toLowerCase();
  const hit =
    /image|vision|visual|multimodal|multi-modal|unsupported type|does not support|不支持|图片|图像|多模态/.test(
      lower
    );
  if (!hit) return null;
  const err = new Error(
    '当前选择的模型不支持图片识别，请在「设置」中切换到支持视觉的多模态模型后重试'
  ) as Error & { code: string; status: number };
  err.code = 'MODEL_NOT_VISION';
  err.status = status;
  return err;
}

export async function chatCompletion(
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<{ content: string }> {
  const apiKey = ensureApiKey();
  const config = loadConfig();
  const model = options.model || config.chatModel;

  const response = await fetch(`${getBaseUrl()}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    const visionErr = asVisionErrorIfNeeded(messages, response.status, errText);
    if (visionErr) throw visionErr;
    const err = new Error(`请求失败 (${response.status}): ${errText || response.statusText}`) as Error & { code: string; status: number };
    err.code = API_ERRORS.REQUEST_FAILED;
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content ?? '';
  return { content };
}

// ========== Streaming Chat Completion ==========
export interface StreamCallbacks {
  onContent: (text: string) => void;
  onDone: (fullContent: string) => void;
  onError: (error: Error & { code?: string }) => void;
}

export async function streamChatCompletion(
  messages: ChatMessage[],
  callbacks: StreamCallbacks,
  options: ChatOptions = {}
): Promise<void> {
  const { onContent, onDone, onError } = callbacks;

  try {
    const apiKey = ensureApiKey();
    const config = loadConfig();
    const model = options.model || config.chatModel;

    const response = await fetch(`${getBaseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.max_tokens,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      const visionErr = asVisionErrorIfNeeded(messages, response.status, errText);
      if (visionErr) throw visionErr;
      const err = new Error(`请求失败 (${response.status}): ${errText || response.statusText}`) as Error & { code: string; status: number };
      err.code = API_ERRORS.REQUEST_FAILED;
      err.status = response.status;
      throw err;
    }

    if (!response.body) {
      throw new Error('响应无 body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const dataStr = trimmed.slice(5).trim();
        if (dataStr === '[DONE]') {
          onDone(fullContent);
          return;
        }
        try {
          const data = JSON.parse(dataStr);
          const delta = data.choices?.[0]?.delta?.content;
          if (delta) {
            fullContent += delta;
            onContent(delta);
          }
          if (data.choices?.[0]?.finish_reason) {
            // stream finished
          }
        } catch {
          // skip malformed lines
        }
      }
    }

    onDone(fullContent);
  } catch (err) {
    onError(err as Error & { code?: string });
  }
}

// ========== Embedding ==========
export async function createEmbedding(text: string): Promise<number[]> {
  const apiKey = ensureApiKey();
  const config = loadConfig();

  const response = await fetchWithTimeout(`${getBaseUrl()}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: config.embeddingModel,
      input: text,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    const err = new Error(`Embedding 请求失败 (${response.status}): ${errText || response.statusText}`) as Error & { code: string; status: number };
    err.code = API_ERRORS.REQUEST_FAILED;
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  const embedding = data.data?.[0]?.embedding;
  if (!embedding || !Array.isArray(embedding)) {
    const err = new Error('Embedding 响应格式无效') as Error & { code: string };
    err.code = API_ERRORS.INVALID_RESPONSE;
    throw err;
  }
  return embedding as number[];
}

// ========== 批量 embedding（受控并发，单块失败不中断整体，绝不让异常冒泡到主进程） ==========
export interface BatchEmbeddingResult {
  embeddings: (number[] | null)[];
  failedCount: number;
  firstError: { code: string; message: string } | null;
}

export async function createEmbeddingsBatch(
  texts: string[],
  concurrency: number = 3,
  perRequestTimeoutMs: number = 30_000
): Promise<BatchEmbeddingResult> {
  const results: (number[] | null)[] = new Array(texts.length).fill(null);
  let failedCount = 0;
  let firstError: { code: string; message: string } | null = null;

  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < texts.length) {
      const index = cursor++;
      try {
        const apiKey = ensureApiKey();
        const config = loadConfig();
        const response = await fetchWithTimeout(`${getBaseUrl()}/embeddings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ model: config.embeddingModel, input: texts[index] }),
        }, perRequestTimeoutMs);
        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          const err = new Error(`Embedding 请求失败 (${response.status}): ${(errText || response.statusText).slice(0, 200)}`) as Error & { code: string };
          err.code = API_ERRORS.REQUEST_FAILED;
          throw err;
        }
        const data = await response.json();
        const embedding = data?.data?.[0]?.embedding;
        if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
          const err = new Error('Embedding 响应格式无效（当前服务可能不支持向量模型）') as Error & { code: string };
          err.code = API_ERRORS.INVALID_RESPONSE;
          throw err;
        }
        results[index] = embedding as number[];
      } catch (err: any) {
        failedCount += 1;
        if (!firstError) {
          firstError = {
            code: err?.code || 'EMBEDDING_ERROR',
            message: err?.message || '向量生成失败',
          };
        }
      }
    }
  };

  const workerCount = Math.max(1, Math.min(concurrency, texts.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return { embeddings: results, failedCount, firstError };
}

// ========== 余弦相似度 ==========
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
