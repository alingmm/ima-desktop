import fs from 'fs';
import path from 'path';
import { getDataDir, ensureDir } from '../config';

// 表名到实体类型的映射
export interface TableSchemas {
  users: UserRecord;
  user_settings: UserSettingRecord;
  conversations: ConversationRecord;
  messages: MessageRecord;
  knowledge_bases: KnowledgeBaseRecord;
  documents: DocumentRecord;
  document_chunks: DocumentChunkRecord;
  knowledge_shares: KnowledgeShareRecord;
  knowledge_collaborators: KnowledgeCollaboratorRecord;
  video_tasks: VideoTaskRecord;
  search_history: SearchHistoryRecord;
  notes: NoteRecord;
}

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  password?: string;
  avatar_url?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface UserSettingRecord {
  id: string;
  user_id: string;
  theme?: string;
  default_model?: string;
  language?: string;
  stream_output?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ConversationRecord {
  id: string;
  user_id: string;
  title: string;
  model: string;
  system_prompt?: string;
  created_at: string;
  updated_at: string;
}

export interface MessageRecord {
  id?: string;
  conversation_id: string;
  role: string;
  content: string;
  created_at?: string;
}

export interface KnowledgeBaseRecord {
  id: string;
  user_id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface DocumentRecord {
  id: string;
  knowledge_base_id: string;
  user_id?: string;
  filename: string;
  file_path?: string;
  file_size?: number;
  content_preview?: string;
  chunk_count?: number;
  status?: string;
  error_code?: string | null;
  error_message?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface DocumentChunkRecord {
  id: string;
  document_id: string;
  knowledge_base_id: string;
  chunk_index: number;
  content: string;
  embedding: number[] | null;
  created_at?: string;
}

export interface KnowledgeShareRecord {
  id: string;
  knowledge_base_id: string;
  share_token: string;
  created_by: string;
  permission: string;
  expires_at?: string | null;
  created_at?: string;
}

export interface KnowledgeCollaboratorRecord {
  id: string;
  knowledge_base_id: string;
  user_email: string;
  permission: string;
  invited_by: string;
  created_at?: string;
}

export interface VideoTaskRecord {
  id: string;
  user_id: string;
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
  error_code?: string;
  created_at: string;
  updated_at: string;
}

export interface SearchHistoryRecord {
  id: string;
  user_id: string;
  query: string;
  result_count?: number;
  created_at: string;
}

export interface NoteRecord {
  id: string;
  user_id: string;
  title: string;
  content: string;
  tags: string[];
  is_pinned?: boolean;
  created_at: string;
  updated_at: string;
}

// ========== JSON File Storage ==========
type TableName = keyof TableSchemas;
type TableData<T extends TableName> = TableSchemas[T][];

const fileCache = new Map<string, unknown[]>();
const fileMtime = new Map<string, number>();

function getTableFile(table: TableName): string {
  return path.join(getDataDir(), `${table}.json`);
}

function loadTable<T extends TableName>(table: T): TableData<T> {
  const filePath = getTableFile(table);
  ensureDir(getDataDir());

  const mtime = fs.existsSync(filePath) ? fs.statSync(filePath).mtimeMs : -1;
  const cachedMtime = fileMtime.get(filePath);

  if (cachedMtime !== undefined && cachedMtime === mtime && fileCache.has(filePath)) {
    return fileCache.get(filePath) as TableData<T>;
  }

  if (!fs.existsSync(filePath)) {
    const empty: TableData<T> = [] as unknown as TableData<T>;
    fs.writeFileSync(filePath, JSON.stringify(empty, null, 2), 'utf-8');
    fileCache.set(filePath, empty as unknown[]);
    fileMtime.set(filePath, fs.statSync(filePath).mtimeMs);
    return empty;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as TableData<T>;
    fileCache.set(filePath, data as unknown[]);
    fileMtime.set(filePath, fs.statSync(filePath).mtimeMs);
    return data;
  } catch {
    const empty: TableData<T> = [] as unknown as TableData<T>;
    fileCache.set(filePath, empty as unknown[]);
    return empty;
  }
}

function saveTable<T extends TableName>(table: T, data: TableData<T>): void {
  const filePath = getTableFile(table);
  ensureDir(getDataDir());
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  fileCache.set(filePath, data as unknown[]);
  fileMtime.set(filePath, fs.statSync(filePath).mtimeMs);
}

// ========== 通用 CRUD 方法 ==========

export function selectAll<T extends TableName>(table: T): TableData<T> {
  return loadTable(table);
}

export function selectWhere<T extends TableName>(
  table: T,
  where: Partial<TableSchemas[T]>
): TableData<T> {
  const data = loadTable(table);
  return data.filter((item) =>
    Object.entries(where).every(([key, value]) => {
      if (value === undefined) return true;
      return (item as unknown as Record<string, unknown>)[key] === value;
    })
  ) as TableData<T>;
}

export function selectOne<T extends TableName>(
  table: T,
  where: Partial<TableSchemas[T]>
): TableSchemas[T] | null {
  const results = selectWhere(table, where);
  return results.length > 0 ? results[0] : null;
}

export function insertOne<T extends TableName>(
  table: T,
  record: TableSchemas[T]
): TableSchemas[T] {
  const data = loadTable(table);
  const now = new Date().toISOString();
  const withTimestamps = { ...record } as unknown as Record<string, unknown>;
  if (!withTimestamps.created_at) withTimestamps.created_at = now;
  if (tableHasUpdatedAt(table) && !withTimestamps.updated_at) withTimestamps.updated_at = now;
  data.push(withTimestamps as unknown as TableSchemas[T]);
  saveTable(table, data);
  return withTimestamps as unknown as TableSchemas[T];
}

export function insertMany<T extends TableName>(
  table: T,
  records: TableSchemas[T][]
): TableSchemas[T][] {
  if (records.length === 0) return [];
  const data = loadTable(table);
  const now = new Date().toISOString();
  const withTimestamps = records.map((r) => {
    const rec = { ...r } as unknown as Record<string, unknown>;
    if (!rec.created_at) rec.created_at = now;
    if (tableHasUpdatedAt(table) && !rec.updated_at) rec.updated_at = now;
    return rec as unknown as TableSchemas[T];
  });
  data.push(...withTimestamps);
  saveTable(table, data);
  return withTimestamps;
}

export function updateWhere<T extends TableName>(
  table: T,
  where: Partial<TableSchemas[T]>,
  updates: Partial<TableSchemas[T]>
): TableSchemas[T][] {
  const data = loadTable(table);
  const updated: TableSchemas[T][] = [];
  const now = new Date().toISOString();

  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    const matches = Object.entries(where).every(([key, value]) => {
      if (value === undefined) return true;
      return (item as unknown as Record<string, unknown>)[key] === value;
    });
    if (matches) {
      const updatedItem = { ...item, ...updates } as unknown as Record<string, unknown>;
      if (tableHasUpdatedAt(table)) updatedItem.updated_at = now;
      data[i] = updatedItem as unknown as TableSchemas[T];
      updated.push(data[i]);
    }
  }

  if (updated.length > 0) {
    saveTable(table, data);
  }
  return updated;
}

export function updateOne<T extends TableName>(
  table: T,
  where: Partial<TableSchemas[T]>,
  updates: Partial<TableSchemas[T]>
): TableSchemas[T] | null {
  const results = updateWhere(table, where, updates);
  return results.length > 0 ? results[0] : null;
}

export function deleteWhere<T extends TableName>(
  table: T,
  where: Partial<TableSchemas[T]>
): number {
  const data = loadTable(table);
  const newData = data.filter((item) =>
    !Object.entries(where).every(([key, value]) => {
      if (value === undefined) return true;
      return (item as unknown as Record<string, unknown>)[key] === value;
    })
  );
  const deletedCount = data.length - newData.length;
  if (deletedCount > 0) {
    saveTable(table, newData as TableData<T>);
  }
  return deletedCount;
}

// 排序工具
export function orderBy<T>(
  data: T[],
  field: keyof T & string,
  direction: 'asc' | 'desc' = 'asc'
): T[] {
  return [...data].sort((a, b) => {
    const av = a[field];
    const bv = b[field];
    if (av == null && bv == null) return 0;
    if (av == null) return direction === 'asc' ? -1 : 1;
    if (bv == null) return direction === 'asc' ? 1 : -1;
    if (av < bv) return direction === 'asc' ? -1 : 1;
    if (av > bv) return direction === 'asc' ? 1 : -1;
    return 0;
  });
}

// 便捷别名
export function findOne<T extends TableName>(
  table: T,
  where: Partial<TableSchemas[T]>
): TableSchemas[T] | null {
  return selectOne(table, where);
}

export function findById<T extends TableName>(
  table: T,
  id: string
): TableSchemas[T] | null {
  return selectOne(table, { id } as Partial<TableSchemas[T]>);
}

export function updateById<T extends TableName>(
  table: T,
  id: string,
  updates: Partial<TableSchemas[T]>
): TableSchemas[T] | null {
  return updateOne(table, { id } as Partial<TableSchemas[T]>, updates);
}

function tableHasUpdatedAt(_table: TableName): boolean {
  return true;
}

// 余弦相似度（向量检索）
export function cosineSimilarity(a: number[], b: (number[] | null)): number {
  if (!b || a.length !== b.length || a.length === 0) return 0;
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

// 向量检索：在 document_chunks 中搜索最相似的 top_k 条
export function vectorSearch(
  queryEmbedding: number[],
  knowledgeBaseId: string,
  topK = 5
): { chunk: DocumentChunkRecord; score: number }[] {
  const allChunks = selectWhere('document_chunks', {
    knowledge_base_id: knowledgeBaseId,
  } as Partial<DocumentChunkRecord>);

  const withScores = allChunks
    .filter((c) => c.embedding != null)
    .map((chunk) => ({
      chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return withScores;
}
