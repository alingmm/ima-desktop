export interface User {
  id: string;
  email: string;
  name?: string;
  avatar_url?: string;
}

export interface Conversation {
  id: string;
  title: string;
  model: string;
  created_at: string;
  updated_at: string;
}

/** 多模态消息内容分片（图片识别，OpenAI vision 格式） */
export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } };

export interface Message {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string | ChatContentPart[];
  /** 仅前端展示用：本条用户消息携带的图片（不落库） */
  images?: string[];
  created_at?: string;
}

/** 对话输入区待发送的附件 */
export interface PendingAttachment {
  id: string;
  kind: 'image' | 'document';
  name: string;
  /** 图片的 data URL */
  dataUrl?: string;
  /** 文档抽取后的文本 */
  text?: string;
  status: 'loading' | 'ready';
}

export interface Model {
  id: string;
  name: string;
  provider: string;
}

export interface OllamaModel {
  id: string;
  name: string;
  provider: 'ollama';
  size?: number;
  digest?: string;
  modified_at?: string;
  details?: {
    family?: string;
    parameter_size?: string;
    quantization_level?: string;
  };
}

export interface AISettings {
  defaultModel: string;
  ollamaUrl: string;
}

export interface KnowledgeBase {
  id: string;
  name: string;
  description: string;
  icon?: string;
  document_count?: number;
  created_at: string;
  updated_at: string;
}

export interface Document {
  id: string;
  knowledge_base_id: string;
  filename: string;
  file_size: number;
  content_preview: string;
  chunk_count: number;
  status: string;
  created_at: string;
}

export interface SearchResult {
  id: string;
  title: string;
  url?: string;
  snippet: string;
  site_name?: string;
  publish_time?: string;
  logo_url?: string;
  rank_score?: number;
}

export interface VideoTask {
  id: string;
  prompt: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  video_url?: string;
  thumbnail_url?: string;
  model: string;
  duration: number;
  ratio: string;
  resolution: string;
  input_type: 'text' | 'image';
  image_url?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
}

export interface ShareLink {
  id: string;
  share_token: string;
  permission: string;
  expires_at?: string;
  is_active: boolean;
  created_at: string;
}

export interface Collaborator {
  id: string;
  user_email: string;
  permission: string;
  invited_by: string;
  invited_at: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
}

export interface BrowseResult {
  url: string;
  title: string;
  description: string;
  content: string;
  content_length: number;
  is_truncated: boolean;
  status: number;
}
