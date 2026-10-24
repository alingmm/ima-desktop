// 本地大模型（Ollama）非流式对话服务 —— 供自主执行链路等非流式场景调用
// 与走云端 OpenAI 兼容接口的 chatCompletion 对应：本地优先、隐私可控
import { ChatMessage } from './ai';
import { fetchWithTimeout } from './ai';

const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';

export class LocalModelError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'LocalModelError';
  }
}

export function getOllamaBaseUrl(): string {
  return process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL;
}

export interface LocalChatOptions {
  model: string;
  temperature?: number;
  timeoutMs?: number;
}

export interface LocalChatResult {
  content: string;
  model: string;
}

interface OllamaChatResponse {
  message?: { role?: string; content?: string };
  done?: boolean;
  model?: string;
  error?: string;
}

// 探测 Ollama 是否可用，返回已安装模型列表；不可用时返回 available=false
export async function checkOllamaHealth(baseUrl?: string): Promise<{
  available: boolean;
  models: string[];
  url: string;
  error?: string;
}> {
  const url = (baseUrl || getOllamaBaseUrl()).replace(/\/$/, '');
  try {
    const res = await fetchWithTimeout(`${url}/api/tags`, { method: 'GET' }, 4000);
    if (!res.ok) {
      return { available: false, models: [], url, error: `Ollama 返回 ${res.status}` };
    }
    const data: any = await res.json();
    const models: string[] = Array.isArray(data.models)
      ? data.models.map((m: any) => m.name).filter(Boolean)
      : [];
    return { available: true, models, url };
  } catch (e: any) {
    return {
      available: false,
      models: [],
      url,
      error: '连不上本地模型服务（Ollama），请确认已启动 Ollama',
    };
  }
}

// 自动挑一个本地模型：优先指定，其次健康检查里的第一个
export async function resolveLocalModel(preferred?: string): Promise<string> {
  const health = await checkOllamaHealth();
  if (!health.available) {
    throw new LocalModelError('LOCAL_MODEL_UNAVAILABLE', health.error || '本地模型不可用');
  }
  if (preferred && health.models.includes(preferred)) return preferred;
  if (health.models.length > 0) return health.models[0];
  throw new LocalModelError('LOCAL_MODEL_NOT_INSTALLED', '本地还没有可用的模型，请先在 Ollama 中下载一个模型');
}

// 非流式对话：给 ReAct 执行器等需要一次性拿完整 JSON 决策的场景使用
export async function localChatCompletion(
  messages: ChatMessage[],
  options: LocalChatOptions,
): Promise<LocalChatResult> {
  const baseUrl = getOllamaBaseUrl();
  const model = options.model || (await resolveLocalModel());
  const body: Record<string, unknown> = {
    model,
    messages: messages.map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' })),
    stream: false,
  };
  if (options.temperature !== undefined) body.options = { temperature: options.temperature };

  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${baseUrl}/api/chat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      options.timeoutMs || 90_000,
    );
  } catch (e: any) {
    throw new LocalModelError('LOCAL_MODEL_UNAVAILABLE', '连不上本地模型服务（Ollama），请确认已启动 Ollama 后重试');
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 404 || /not found|no model/i.test(text)) {
      throw new LocalModelError('LOCAL_MODEL_NOT_INSTALLED', `本地没有模型「${model}」，请先在 Ollama 中下载`);
    }
    throw new LocalModelError('LOCAL_MODEL_ERROR', `本地模型调用失败（${res.status}），请稍后重试`);
  }

  const data: OllamaChatResponse = await res.json().catch(() => ({} as OllamaChatResponse));
  if (data.error) {
    throw new LocalModelError('LOCAL_MODEL_ERROR', '本地模型返回错误，请检查模型是否正常');
  }
  return {
    content: data.message?.content || '',
    model: data.model || model,
  };
}
