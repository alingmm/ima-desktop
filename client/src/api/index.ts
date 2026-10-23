const API_BASE = '/api';

interface RequestOptions extends RequestInit {
  headers?: Record<string, string>;
}

const DEFAULT_REQUEST_TIMEOUT = 120_000; // 向量化等长耗时操作给足 2 分钟

async function request<T>(endpoint: string, options: RequestOptions = {}, timeoutMs: number = DEFAULT_REQUEST_TIMEOUT): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
  } catch (err: any) {
    clearTimeout(timer);
    if (err?.name === 'AbortError') {
      throw new Error('请求超时，请检查网络后重试');
    }
    // 把浏览器抛出的英文网络异常统一翻译成人话
    const raw = String(err?.message || '');
    if (/Failed to fetch|NetworkError|Network request failed|load failed/i.test(raw)) {
      throw new Error('网络连接失败，请检查网络后重试');
    }
    throw new Error(raw || '网络连接失败，请检查网络后重试');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    const fallback = response.status >= 500
      ? '服务暂时开小差了，请稍后重试'
      : response.status === 404
        ? '没找到相关内容'
        : response.status === 403
          ? '没有权限执行这个操作'
          : '操作失败，请稍后重试';
    const err = new Error(error.message || error.error || fallback) as Error & { error?: string; code?: string };
    err.error = error.error;
    err.code = error.error;
    throw err;
  }

  return response.json();
}

// Auth APIs
export const authApi = {
  login: (email: string, password: string) =>
    request<{ user: any; token: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  register: (email: string, password: string, name?: string) =>
    request<{ user: any; token: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    }),
};

// Chat APIs
export const chatApi = {
  getModels: () => request<{ models: any[] }>('/chat/models'),
  getConversations: () => request<{ conversations: any[] }>('/chat/conversations'),
  createConversation: (title?: string, model?: string) =>
    request<{ conversation: any }>('/chat/conversations', {
      method: 'POST',
      body: JSON.stringify({ title, model }),
    }),
  getMessages: (conversationId: string) =>
    request<{ messages: any[] }>(`/chat/conversations/${conversationId}/messages`),
  deleteConversation: (id: string) =>
    request<{ success: boolean }>(`/chat/conversations/${id}`, { method: 'DELETE' }),
  updateConversation: (id: string, data: any) =>
    request<{ conversation: any }>(`/chat/conversations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  sendMessage: (messages: any[], model: string, conversationId?: string) =>
    request<{ content: string }>('/chat/send', {
      method: 'POST',
      body: JSON.stringify({ messages, model, conversation_id: conversationId }),
    }),
  streamMessage: (
    messages: any[],
    model: string,
    conversationId?: string,
    onChunk?: (text: string) => void
  ): Promise<string> => {
    return new Promise((resolve, reject) => {
      const eventSource = new EventSourcePolyfill('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, model, conversation_id: conversationId }),
      });

      let fullText = '';

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.done) {
            eventSource.close();
            resolve(fullText);
          } else if (data.error) {
            eventSource.close();
            reject(new Error(data.error));
          } else if (data.content) {
            fullText += data.content;
            onChunk?.(data.content);
          }
        } catch (e) {
          console.error('Parse error:', e);
        }
      };

      eventSource.onerror = (error) => {
        eventSource.close();
        if (fullText) {
          resolve(fullText);
        } else {
          reject(error);
        }
      };
    });
  },
  saveToKnowledge: (params: {
    knowledge_base_id?: string;
    knowledge_base_name?: string;
    question?: string;
    answer?: string;
    message_id?: string;
  }) =>
    request<{ success: boolean; knowledge_base_id: string; document_id: string; embedding_ready?: boolean; embed_error_message?: string }>('/chat/save-to-knowledge', {
      method: 'POST',
      body: JSON.stringify(params),
    }),
};

// Knowledge Base APIs
export const knowledgeApi = {
  getBases: () => request<{ bases: any[] }>('/knowledge/bases'),
  createBase: (name: string, description?: string) =>
    request<{ base: any }>('/knowledge/bases', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }),
  updateBase: (id: string, data: any) =>
    request<{ base: any }>(`/knowledge/bases/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteBase: (id: string) =>
    request<{ success: boolean }>(`/knowledge/bases/${id}`, { method: 'DELETE' }),
  getDocuments: (baseId: string) =>
    request<{ documents: any[] }>(`/knowledge/bases/${baseId}/documents`),
  uploadDocument: (baseId: string, file: File): Promise<any> => {
    const formData = new FormData();
    formData.append('file', file);
    return fetch(`/api/knowledge/bases/${baseId}/upload`, {
      method: 'POST',
      body: formData,
    }).then((res) => res.json());
  },
  deleteDocument: (id: string) =>
    request<{ success: boolean }>(`/knowledge/documents/${id}`, { method: 'DELETE' }),
  getDocumentContent: (id: string) =>
    request<{ content: string; filename: string; chunk_count: number }>(`/knowledge/documents/${id}/content`),
  updateDocument: (id: string, data: { content: string; filename?: string }) =>
    request<{ document: any; embedding_ready: boolean; chunk_count: number }>(`/knowledge/documents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  importNote: (baseId: string, noteId: string) =>
    request<{ document: any; embedding_ready: boolean }>(`/knowledge/bases/${baseId}/import-note`, {
      method: 'POST',
      body: JSON.stringify({ note_id: noteId }),
    }),
  queryBase: (baseId: string, query: string, topK?: number) =>
    request<{ results: any[]; answer: string }>(`/knowledge/bases/${baseId}/query`, {
      method: 'POST',
      body: JSON.stringify({ query, top_k: topK }),
    }),
  getShareInfo: (baseId: string) =>
    request<{ shareLinks: any[]; collaborators: any[] }>(`/knowledge/bases/${baseId}/share`),
  createShare: (baseId: string, permission?: string, expiresAt?: string) =>
    request<{ share: any; share_url: string }>(`/knowledge/bases/${baseId}/share`, {
      method: 'POST',
      body: JSON.stringify({ permission, expires_at: expiresAt }),
    }),
  addCollaborator: (baseId: string, email: string, permission?: string) =>
    request<{ collaborator: any }>(`/knowledge/bases/${baseId}/collaborators`, {
      method: 'POST',
      body: JSON.stringify({ email, permission }),
    }),
  removeCollaborator: (id: string) =>
    request<{ success: boolean }>(`/knowledge/collaborators/${id}`, { method: 'DELETE' }),
  addFromUrl: (baseId: string, url: string, title?: string) =>
    request<{ document_id: string; title: string; status: string }>('/knowledge/add-from-url', {
      method: 'POST',
      body: JSON.stringify({ baseId, url, title }),
    }),
};

// Video APIs
export const videoApi = {
  getTasks: () => request<{ tasks: any[] }>('/video/tasks'),
  getTask: (id: string) => request<{ task: any }>(`/video/tasks/${id}`),
  textToVideo: (data: { prompt: string; duration?: number; ratio?: string; resolution?: string }) =>
    request<{ task_id: string; task: any }>('/video/text-to-video', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  imageToVideo: (data: { prompt?: string; image_url: string; duration?: number; ratio?: string; resolution?: string }) =>
    request<{ task_id: string; task: any }>('/video/image-to-video', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deleteTask: (id: string) =>
    request<{ success: boolean }>(`/video/tasks/${id}`, { method: 'DELETE' }),
  assistStream: (options: { topic: string; type: string; model?: string }) =>
    new EventSourcePolyfill(`${API_BASE}/video/assist/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(options),
    }),
  assist: (data: { topic: string; type: string; model?: string }) =>
    request<{ content: string; type: string }>('/video/assist', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

// Search APIs
export const searchApi = {
  webSearch: (query: string, options?: { count?: number; timeRange?: string; sites?: string }) =>
    request<{ summary?: string; results: any[] }>('/search/web', {
      method: 'POST',
      body: JSON.stringify({ query, ...options }),
    }),
  imageSearch: (query: string, count?: number) =>
    request<{ results: any[] }>('/search/images', {
      method: 'POST',
      body: JSON.stringify({ query, count }),
    }),
  summarize: (query: string, results: any[]) =>
    request<{ summary: string }>('/search/summarize', {
      method: 'POST',
      body: JSON.stringify({ query, results }),
    }),
  browse: (url: string) =>
    request<any>('/search/browse', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),
  getHistory: () => request<{ history: any[] }>('/search/history'),
  deleteHistory: (id: string) =>
    request<{ success: boolean }>(`/search/history/${id}`, { method: 'DELETE' }),
  clearHistory: () =>
    request<{ success: boolean }>('/search/history', { method: 'DELETE' }),
  importToKb: (
    baseId: string,
    items: { title: string; url: string; content: string }[],
    title?: string
  ) =>
    request<{
      success: boolean;
      document?: any;
      chunk_count?: number;
      embedding_ready?: boolean;
      embed_error_code?: string;
      embed_error_message?: string;
    }>('/search/import-to-kb', {
      method: 'POST',
      body: JSON.stringify({ base_id: baseId, items, title }),
    }),
  toNote: (items: { title: string; url: string; content: string }[], title?: string) =>
    request<{ success: boolean; note?: any }>('/search/to-note', {
      method: 'POST',
      body: JSON.stringify({ items, title }),
    }),
};

// User APIs
export const userApi = {
  getProfile: () => request<{ user: any }>('/user/profile'),
  updateProfile: (data: any) =>
    request<{ user: any }>('/user/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  getStats: () => request<{ stats: any }>('/user/stats'),
  getSettings: () => request<{ settings: any }>('/user/settings'),
  updateSettings: (data: any) =>
    request<{ settings: any }>('/user/settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
};

// Settings APIs (system-level: API keys, model configs)
export const settingsApi = {
  getSettings: () =>
    request<{
      settings: {
        openaiBaseUrl: string;
        chatModel: string;
        embeddingModel: string;
        searchProvider: string;
        openaiApiKeyConfigured: boolean;
        openaiApiKeyTail?: string;
        searchApiKeyConfigured: boolean;
        searchApiKeyTail?: string;
      };
    }>('/settings'),
  updateSettings: (data: Record<string, any>) =>
    request<{
      success: boolean;
      settings: {
        openaiBaseUrl: string;
        chatModel: string;
        embeddingModel: string;
        searchProvider: string;
        openaiApiKeyConfigured: boolean;
        openaiApiKeyTail?: string;
        searchApiKeyConfigured: boolean;
        searchApiKeyTail?: string;
      };
    }>('/settings', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

// Notes APIs
export const notesApi = {
  getNotes: (params?: { search?: string; tag?: string; sort_by?: string; order?: string }) => {
    const query = new URLSearchParams();
    if (params?.search) query.set('search', params.search);
    if (params?.tag) query.set('tag', params.tag);
    if (params?.sort_by) query.set('sort_by', params.sort_by);
    if (params?.order) query.set('order', params.order);
    const qs = query.toString();
    return request<{ notes: any[] }>(`/notes${qs ? `?${qs}` : ''}`);
  },
  getNote: (id: string) => request<{ note: any }>(`/notes/${id}`),
  getTags: () => request<{ tags: string[] }>('/notes/tags'),
  createNote: (data: { title?: string; content?: string; tags?: string[]; is_pinned?: boolean }) =>
    request<{ note: any }>('/notes', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateNote: (id: string, data: any) =>
    request<{ note: any }>(`/notes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteNote: (id: string) =>
    request<{ success: boolean }>(`/notes/${id}`, { method: 'DELETE' }),
  batchDelete: (ids: string[]) =>
    request<{ success: boolean; deleted_count: number }>('/notes/batch-delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
  createFromDocument: (documentId: string) =>
    request<{ note: any }>('/notes/from-document', {
      method: 'POST',
      body: JSON.stringify({ document_id: documentId }),
    }),
};

// Tracking (话题追踪) APIs
export const trackingApi = {
  getProjects: () =>
    request<{ projects: any[] }>('/tracking/projects'),

  getProject: (id: string) =>
    request<{ project: any }>(`/tracking/projects/${id}`),

  createProject: (data: any) =>
    request<{ project: any }>('/tracking/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateProject: (id: string, data: any) =>
    request<{ project: any }>(`/tracking/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  deleteProject: (id: string) =>
    request<{ success: boolean }>(`/tracking/projects/${id}`, {
      method: 'DELETE',
    }),

  getRuns: (projectId: string) =>
    request<{ runs: any[] }>(`/tracking/projects/${projectId}/runs`),

  runProject: (projectId: string, opts?: { resume_run_id?: string; guidance?: string }) =>
    request<any>(`/tracking/projects/${projectId}/run`, {
      method: 'POST',
      body: JSON.stringify(opts || {}),
    }),
};

// Local model (Ollama) APIs
export const localModelApi = {
  checkHealth: (ollamaUrl?: string) => {
    const headers: Record<string, string> = {};
    if (ollamaUrl) headers['x-ollama-url'] = ollamaUrl;
    return request<{ available: boolean; url: string; error?: string; hint?: string }>('/local-model/health', { headers });
  },

  getModels: (ollamaUrl?: string) => {
    const headers: Record<string, string> = {};
    if (ollamaUrl) headers['x-ollama-url'] = ollamaUrl;
    return request<{ models: import('../types').OllamaModel[] }>('/local-model/models', { headers }).then((r) => r.models);
  },

  pullModel: (name: string, ollamaUrl?: string) => {
    const headers: Record<string, string> = {};
    if (ollamaUrl) headers['x-ollama-url'] = ollamaUrl;
    return request<{ status: string; model: string }>('/local-model/pull', { method: 'POST', body: JSON.stringify({ name }), headers });
  },

  streamChat: (options: {
    model: string;
    messages: Array<{ role: string; content: string }>;
    system_prompt?: string;
    ollamaUrl?: string;
    onMessage?: (text: string) => void;
    onDone?: () => void;
    onError?: (error: string) => void;
  }) => {
    const { model, messages, system_prompt, ollamaUrl, onMessage, onDone, onError } = options;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (ollamaUrl) headers['x-ollama-url'] = ollamaUrl;
    const eventSource = new EventSourcePolyfill('/api/local-model/stream', {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, messages, system_prompt }),
    });

    eventSource.onmessage = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.error) {
          onError?.(data.error);
          eventSource.close();
          return;
        }
        if (data.content) {
          onMessage?.(data.content);
        }
        if (data.done) {
          onDone?.();
          eventSource.close();
        }
      } catch {
        // ignore parse errors
      }
    };

    eventSource.onerror = () => {
      onError?.('连接本地模型失败');
      eventSource.close();
    };

    return eventSource;
  },
};

// Polyfill for EventSource with POST support
class EventSourcePolyfill {
  private url: string;
  private options: any;
  private controller: AbortController;
  onmessage: ((event: any) => void) | null = null;
  onerror: ((error: any) => void) | null = null;

  constructor(url: string, options: any = {}) {
    this.url = url;
    this.options = options;
    this.controller = new AbortController();
    this.init();
  }

  private async init() {
    try {
      const response = await fetch(this.url, {
        ...this.options,
        signal: this.controller.signal,
      });

      if (!response.ok) {
        this.onerror?.(new Error(`HTTP ${response.status}`));
        return;
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      if (!reader) return;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            this.onmessage?.({ data });
          }
        }
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        this.onerror?.(error);
      }
    }
  }

  close() {
    this.controller.abort();
  }
}

// 记忆 APIs
export const memoryApi = {
  getMemories: (q?: string) => {
    const query = q ? `?q=${encodeURIComponent(q)}` : '';
    return request<{ memories: any[] }>(`/memories${query}`);
  },

  createMemory: (data: { content: string; category?: string; tags?: string[] }) =>
    request<{ memory: any }>('/memories', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateMemory: (id: string, data: { content?: string; category?: string; tags?: string[] }) =>
    request<{ memory: any }>(`/memories/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteMemory: (id: string) =>
    request<{ success: boolean }>(`/memories/${id}`, {
      method: 'DELETE',
    }),

  extractFromChat: (data: { user_text: string; assistant_text: string }) =>
    request<{ saved: boolean; reason: string; memory: any }>('/memories/extract-from-chat', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

export interface ExtractedFile {
  filename: string;
  ext: string;
  size: number;
  chars: number;
  content: string;
}

// 外部文件上传/解析 APIs
export const filesApi = {
  /** 上传文件并在后端抽取文本（不保存，仅预览） */
  extract: async (file: File): Promise<ExtractedFile> => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/files/extract', { method: 'POST', body: formData });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.message || data.error || '文件解析失败');
    }
    return data as ExtractedFile;
  },

  /** 上传文件直接存为一条笔记 */
  toNote: async (file: File, tags?: string): Promise<{ note: any }> => {
    const formData = new FormData();
    formData.append('file', file);
    if (tags) formData.append('tags', tags);
    const res = await fetch('/api/files/to-note', { method: 'POST', body: formData });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.message || data.error || '保存到笔记失败');
    }
    return data as { note: any };
  },
};

// ========== 网页 / 视频链接抓取 APIs ==========

export interface WebCaptureData {
  kind?: 'web';
  title: string;
  content: string;
  url: string;
  final_url?: string;
  description?: string;
  site_name?: string;
  char_count?: number;
  truncated?: boolean;
}

export interface VideoCaptureData {
  kind?: 'video';
  platform: string;
  title: string;
  author?: string;
  description?: string;
  thumbnail?: string;
  duration_seconds?: number;
  url: string;
  final_url?: string;
  has_transcript: boolean;
  note?: string;
}

export type CaptureData = WebCaptureData | VideoCaptureData;

async function postJson<T>(path: string, body: any): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || data.error || '请求失败');
  }
  return data as T;
}

export const captureApi = {
  /** 抓取普通网页 */
  captureWeb: (url: string) => postJson<WebCaptureData>('/api/capture/web', { url }),

  /** 抓取视频元信息 */
  captureVideo: (url: string) => postJson<VideoCaptureData>('/api/capture/video', { url }),

  /** 自动识别网页/视频并抓取 */
  fetch: (url: string) => postJson<CaptureData>('/api/capture/fetch', { url }),

  /** 大模型一键整理为结构化文档 */
  organize: (params: {
    kind: 'web' | 'video';
    title: string;
    content: string;
    url: string;
  }) => postJson<{ title: string; content: string; kind: string }>('/api/capture/organize', params),

  /** 保存为笔记 */
  toNote: (params: {
    kind: 'web' | 'video';
    title: string;
    content: string;
    url: string;
    author?: string;
    organized?: boolean;
  }) => postJson<{ success: boolean; note: any; truncated?: boolean; char_count?: number }>('/api/capture/to-note', params),
};

// ========== 外部工具调用（权限分级） APIs ==========

export type ToolActionType = 'open_app' | 'run_command';
export type ToolPolicyLevel = 'auto' | 'confirm' | 'deny';

export interface ToolPendingItem {
  id: string;
  action_type: ToolActionType;
  action_detail: string;
  risk_level: 'normal' | 'high';
  risk_reason?: string;
  source: 'manual' | 'agent';
  run_id?: string;
  project_id?: string;
  created_at: string;
}

export interface ToolExecutionLogItem {
  id: string;
  action_type: ToolActionType;
  action_detail: string;
  level: ToolPolicyLevel;
  risk_level: 'normal' | 'high';
  ok: boolean;
  result_summary: string;
  source: 'manual' | 'agent';
  duration_ms?: number;
  created_at: string;
}

export const toolsApi = {
  /** 获取权限分级 */
  getPolicy: () => request<Record<ToolActionType, ToolPolicyLevel>>('/tools/policy'),

  /** 保存权限分级 */
  savePolicy: (policies: Partial<Record<ToolActionType, ToolPolicyLevel>>) =>
    request<{ success: boolean; policies: Record<ToolActionType, ToolPolicyLevel> }>('/tools/policy', {
      method: 'POST',
      body: JSON.stringify({ policies }),
    }),

  /** 待确认列表 */
  getPending: () => request<{ pending: ToolPendingItem[] }>('/tools/pending'),

  /** 执行日志 */
  getLogs: (limit = 50) => request<{ logs: ToolExecutionLogItem[] }>(`/tools/logs?limit=${limit}`),

  /** 手动执行一次工具调用 */
  run: (actionType: ToolActionType, target: string) =>
    request<
      | { status: 'executed'; ok: boolean; output: string; duration_ms: number }
      | { status: 'pending'; pending: ToolPendingItem }
    >('/tools/run', {
      method: 'POST',
      body: JSON.stringify({ action_type: actionType, target }),
    }),

  /** 批准/拒绝待确认项 */
  confirm: (pendingId: string, approve: boolean, note?: string) =>
    request<{ success: boolean; status: string; resumed: boolean; executed?: { ok: boolean; output: string } }>(
      '/tools/confirm',
      {
        method: 'POST',
        body: JSON.stringify({ pending_id: pendingId, approve, note }),
      },
    ),
};

// ========== 自主执行与隐私（需求10）==========
export interface AgentPrivacySettings {
  id?: string;
  user_id?: string;
  allow_web_search: boolean;
  allow_web_capture: boolean;
  allow_external_tools: boolean;
  model_preference: 'default' | 'local';
  local_model?: string;
}

export interface AgentTraceStats {
  search_count?: number;
  capture_count?: number;
  knowledge_search_count?: number;
  note_count?: number;
  knowledge_write_count?: number;
  memory_count?: number;
  open_app_count?: number;
  command_count?: number;
  model_source?: 'cloud' | 'local';
  local_model?: string;
}

export const agentApi = {
  /** 读取自主执行与隐私设置 */
  getPrivacy: () => request<{ settings: AgentPrivacySettings }>('/agent/privacy'),

  /** 保存自主执行与隐私设置 */
  savePrivacy: (patch: Partial<AgentPrivacySettings>) =>
    request<{ settings: AgentPrivacySettings }>('/agent/privacy', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  /** 查询本地模型可用性与已安装模型 */
  getLocalModels: () =>
    request<{ available: boolean; models: string[]; url?: string; error?: string }>('/agent/local-models'),
};
