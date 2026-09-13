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
