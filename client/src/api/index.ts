const API_BASE = '/api';

interface RequestOptions extends RequestInit {
  headers?: Record<string, string>;
}

async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${response.status}`);
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
    request<{ success: boolean; knowledge_base_id: string; document_id: string }>('/chat/save-to-knowledge', {
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
  assistStream: (options: { topic: string; type: string }) =>
    new EventSourcePolyfill(`${API_BASE}/video/assist/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(options),
    }),
  assist: (data: { topic: string; type: string }) =>
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
