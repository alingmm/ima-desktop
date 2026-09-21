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

function getBaseUrl(): string {
  const config = loadConfig();
  return config.openaiBaseUrl.replace(/\/$/, '');
}

// ========== Chat Completion ==========
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
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

  const response = await fetch(`${getBaseUrl()}/embeddings`, {
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
