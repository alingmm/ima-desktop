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

export interface Message {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at?: string;
}

export interface Model {
  id: string;
  name: string;
  provider: string;
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
