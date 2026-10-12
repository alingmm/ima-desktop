import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { loadConfig } from '../config';
import { chatCompletion, API_ERRORS } from '../services/ai';
import {
  selectWhere, insertOne, insertMany, deleteWhere, updateById,
  findById, orderBy,
  SearchHistoryRecord,
  DocumentRecord,
  DocumentChunkRecord,
  NoteRecord,
} from '../storage/json-storage';
import { createEmbeddingsBatch } from '../services/ai';
import { splitTextIntoChunks } from '../utils/text';

const router: import('express').Router = Router();

const SEARCH_ERRORS = {
  SEARCH_API_NOT_CONFIGURED: 'SEARCH_API_NOT_CONFIGURED',
  SEARCH_FAILED: 'SEARCH_FAILED',
};

// 确保搜索 API key
function ensureSearchKey(): string {
  const config = loadConfig();
  if (!config.searchApiKey) {
    const err = new Error('请先在设置页配置搜索服务 API Key (Tavily)') as Error & { code: string };
    err.code = SEARCH_ERRORS.SEARCH_API_NOT_CONFIGURED;
    throw err;
  }
  return config.searchApiKey;
}

// 记录搜索历史：同一用户相同 query 去重，仅刷新 created_at（置顶），不重复堆积
function recordSearchHistory(userId: string, query: string, resultCount?: number): void {
  try {
    const q = query.trim();
    if (!q || !userId) return;
    const existing = selectWhere('search_history', { user_id: userId } as Partial<SearchHistoryRecord>)
      .find((h) => h.query === q);
    if (existing) {
      updateById('search_history', existing.id, {
        created_at: new Date().toISOString(),
        ...(typeof resultCount === 'number' ? { result_count: resultCount } : {}),
      } as Partial<SearchHistoryRecord>);
    } else {
      insertOne('search_history', {
        id: uuidv4(),
        user_id: userId,
        query: q,
        result_count: resultCount,
        created_at: new Date().toISOString(),
      } as SearchHistoryRecord);
    }
  } catch (e: any) {
    // 历史记录失败不影响搜索主流程
    console.error('recordSearchHistory error:', e?.message);
  }
}

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score?: number;
  published_date?: string;
  favicon?: string;
}

export async function tavilySearch(query: string, options: { maxResults?: number; searchDepth?: 'basic' | 'advanced'; includeAnswer?: boolean } = {}): Promise<{ results: TavilyResult[]; answer?: string; responseTime?: number }> {
  const apiKey = ensureSearchKey();
  const { maxResults = 10, searchDepth = 'basic', includeAnswer = false } = options;

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults,
      search_depth: searchDepth,
      include_answer: includeAnswer,
      include_images: false,
      include_raw_content: false,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    const err = new Error(`搜索请求失败 (${response.status}): ${errText || response.statusText}`) as Error & { code: string; status: number };
    err.code = SEARCH_ERRORS.SEARCH_FAILED;
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  return {
    results: (data.results || []).map((r: any) => ({
      title: r.title,
      url: r.url,
      content: r.content,
      score: r.score,
      published_date: r.published_date,
      favicon: r.favicon,
    })),
    answer: data.answer,
    responseTime: data.response_time,
  };
}

// Basic web search
router.post('/web', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { query, count = 10, needSummary = true, timeRange, sites } = req.body;

    if (!query) {
      res.status(400).json({ error: 'Query is required' });
      return;
    }

    const response = await tavilySearch(query, {
      maxResults: count,
      searchDepth: 'advanced',
      includeAnswer: needSummary,
    });

    // Save search history（相同 query 去重，仅刷新时间置顶）
    recordSearchHistory(req.userId!, query, response.results.length);

    res.json({
      summary: response.answer || '',
      results: response.results.map((item, i) => ({
        id: `tavily-${i}`,
        title: item.title,
        url: item.url,
        snippet: item.content,
        site_name: (() => { try { return new URL(item.url).hostname; } catch { return ''; } })(),
        publish_time: item.published_date || '',
        logo_url: item.favicon || '',
        rank_score: item.score || 0,
        auth_info_des: '',
        auth_info_level: '',
      })),
    });
  } catch (error: any) {
    console.error('Search error:', error.message);
    if (error.code === SEARCH_ERRORS.SEARCH_API_NOT_CONFIGURED) {
      res.status(400).json({ error: error.code, message: error.message });
    } else {
      res.status(500).json({ error: 'Search failed', message: error.message });
    }
  }
});

// Image search - Tavily 不直接支持图搜，返回友好提示
router.post('/images', authMiddleware, async (_req: AuthRequest, res) => {
  res.status(501).json({
    error: 'NOT_IMPLEMENTED',
    message: '图片搜索暂不支持（当前使用 Tavily 搜索服务）',
  });
});

// AI summary of search results
router.post('/summarize', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { query, results } = req.body;

    if (!query || !results) {
      res.status(400).json({ error: 'Query and results are required' });
      return;
    }

    const context = results
      .slice(0, 5)
      .map((r: { title: string; snippet: string }, i: number) => `[${i + 1}] ${r.title}\n${r.snippet}`)
      .join('\n\n');

    const prompt = `请根据以下搜索结果，用中文为用户的问题"${query}"生成一份结构化的AI总结：

搜索结果：
${context}

要求：
1. 总结要准确、全面，基于搜索结果
2. 分点列出关键信息
3. 标注信息来源（引用序号）
4. 如果搜索结果中有不同观点，客观呈现
5. 不编造搜索结果中没有的信息`;

    try {
      const response = await chatCompletion(
        [{ role: 'user', content: prompt }],
        { temperature: 0.5 }
      );
      res.json({ summary: response.content });
    } catch (llmErr: any) {
      if (llmErr.code === API_ERRORS.API_KEY_NOT_CONFIGURED) {
        res.status(400).json({ error: llmErr.code, message: llmErr.message });
      } else {
        throw llmErr;
      }
    }
  } catch (error: any) {
    console.error('Summarize error:', error.message);
    res.status(500).json({ error: 'Summary generation failed', message: error.message });
  }
});

// Streaming summary
router.post('/summarize/stream', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { query, results } = req.body;

    if (!query || !results) {
      res.status(400).json({ error: 'Query and results are required' });
      return;
    }

    const context = results
      .slice(0, 5)
      .map((r: { title: string; snippet: string }, i: number) => `[${i + 1}] ${r.title}\n${r.snippet}`)
      .join('\n\n');

    const prompt = `请根据以下搜索结果，用中文为用户的问题"${query}"生成一份结构化的AI总结：

搜索结果：
${context}

要求：
1. 总结要准确、全面，基于搜索结果
2. 分点列出关键信息
3. 标注信息来源（引用序号）
4. 如果搜索结果中有不同观点，客观呈现
5. 不编造搜索结果中没有的信息`;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const { streamChatCompletion } = await import('../services/ai');
    streamChatCompletion(
      [{ role: 'user', content: prompt }],
      {
        onContent: (text: string) => {
          res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
        },
        onDone: (fullContent: string) => {
          res.write(`data: ${JSON.stringify({ done: true, summary: fullContent })}\n\n`);
          res.end();
        },
        onError: (err: Error & { code?: string }) => {
          res.write(`data: ${JSON.stringify({ error: err.code || 'STREAM_ERROR', message: err.message })}\n\n`);
          res.end();
        },
      },
      { temperature: 0.5 }
    );
  } catch (error: any) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Stream summary failed', message: error.message });
    }
  }
});

// Get search history（按 created_at 倒序，同 query 兜底去重，仅保留最新一条）
router.get('/history', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const history = selectWhere('search_history', { user_id: req.userId } as Partial<SearchHistoryRecord>);
    const sorted = orderBy(history, 'created_at', 'desc');
    const seen = new Set<string>();
    const deduped = sorted.filter((h) => {
      const key = (h.query || '').trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 50);
    res.json({ history: deduped });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get search history', message: error.message });
  }
});

// Clear all search history（清空当前用户全部历史）
router.delete('/history', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const count = deleteWhere('search_history', { user_id: req.userId } as Partial<SearchHistoryRecord>);
    res.json({ success: true, deleted: count });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to clear search history', message: error.message });
  }
});

// Delete search history
router.delete('/history/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const count = deleteWhere('search_history', { id, user_id: req.userId } as Partial<SearchHistoryRecord>);
    if (count === 0) {
      res.status(404).json({ error: 'History item not found' });
      return;
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete search history', message: error.message });
  }
});

interface ImportItem {
  title?: string;
  url?: string;
  content?: string;
}

// 把搜索结果拼接成一篇文档内容（Markdown）
function buildSearchDoc(title: string, items: ImportItem[]): string {
  const lines: string[] = [`# ${title || '联网搜索结果'}`, ''];
  items.forEach((it, i) => {
    lines.push(`## ${i + 1}. ${it.title || '（无标题）'}`);
    if (it.url) lines.push(`来源：${it.url}`);
    if (it.content) lines.push('', it.content);
    lines.push('', '---', '');
  });
  return lines.join('\n');
}

// 搜索结果导入知识库（复用分块 + createEmbeddingsBatch，未配 embedding 时降级保存无向量文档）
router.post('/import-to-kb', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { base_id, items, title } = req.body as { base_id?: string; items?: ImportItem[]; title?: string };

    if (!base_id) {
      res.status(400).json({ error: 'base_id is required' });
      return;
    }
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'items is required' });
      return;
    }

    const base = findById('knowledge_bases', base_id) as any;
    if (!base || base.user_id !== req.userId) {
      res.status(404).json({ error: 'Knowledge base not found' });
      return;
    }

    const docTitle = (title && title.trim()) || `搜索结果_${new Date().toLocaleString('zh-CN')}`;
    const content = buildSearchDoc(docTitle, items);
    const docId = uuidv4();
    const chunks = splitTextIntoChunks(content, 800).slice(0, 100);

    insertOne('documents', {
      id: docId,
      knowledge_base_id: base_id,
      user_id: req.userId,
      filename: `${docTitle}.md`,
      file_type: 'text/markdown',
      file_size: Buffer.byteLength(content, 'utf8'),
      chunk_count: chunks.length,
      status: 'processing',
      error_code: null,
      error_message: null,
      source: 'search',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as DocumentRecord);

    let embeddingReady = false;
    let embedError: string | null = null;
    let embedErrorCode: string | null = null;

    try {
      const batch = await createEmbeddingsBatch(chunks, 3, 30_000);
      if (chunks.length > 0) {
        const chunkRecords = chunks.map((text, index) => ({
          id: uuidv4(),
          document_id: docId,
          knowledge_base_id: base_id,
          user_id: req.userId!,
          chunk_index: index,
          content: text,
          embedding: batch.embeddings[index],
          created_at: new Date().toISOString(),
        } as DocumentChunkRecord));
        insertMany('document_chunks', chunkRecords);
      }
      embeddingReady = batch.failedCount === 0;
      if (!embeddingReady) {
        embedError = batch.firstError?.message || `部分向量生成失败（${batch.failedCount}/${chunks.length}）`;
        embedErrorCode = batch.firstError?.code || 'EMBEDDING_ERROR';
      }
    } catch (embedErr: any) {
      // 降级：保存无向量纯文本分块，绝不冒泡
      try {
        if (chunks.length > 0) {
          const chunkRecords = chunks.map((text, index) => ({
            id: uuidv4(),
            document_id: docId,
            knowledge_base_id: base_id,
            user_id: req.userId!,
            chunk_index: index,
            content: text,
            embedding: null,
            created_at: new Date().toISOString(),
          } as DocumentChunkRecord));
          insertMany('document_chunks', chunkRecords);
        }
      } catch { /* 忽略文本兜底写入错误 */ }
      embeddingReady = false;
      embedError = embedErr?.message || '向量生成失败';
      embedErrorCode = embedErr?.code || 'EMBEDDING_ERROR';
    }

    updateById('documents', docId, {
      status: embeddingReady ? 'completed' : 'failed',
      chunk_count: chunks.length,
      error_code: embeddingReady ? null : embedErrorCode,
      error_message: embeddingReady ? null : embedError,
      updated_at: new Date().toISOString(),
    } as Partial<DocumentRecord>);

    const doc = findById('documents', docId) as DocumentRecord;
    res.status(201).json({
      success: true,
      document: doc,
      chunk_count: chunks.length,
      embedding_ready: embeddingReady,
      embed_error_code: embedErrorCode,
      embed_error_message: embedError,
    });
  } catch (error: any) {
    console.error('Search import-to-kb error:', error.message);
    res.status(500).json({ error: 'IMPORT_FAILED', message: error.message });
  }
});

// 搜索结果转笔记
router.post('/to-note', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { items, title } = req.body as { items?: ImportItem[]; title?: string };

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'items is required' });
      return;
    }

    const noteTitle = (title && title.trim()) || `联网搜索笔记_${new Date().toLocaleString('zh-CN')}`;
    const content = buildSearchDoc(noteTitle, items);
    const noteId = uuidv4();
    const now = new Date().toISOString();

    insertOne('notes', {
      id: noteId,
      user_id: req.userId,
      title: noteTitle,
      content,
      tags: ['联网搜索'],
      created_at: now,
      updated_at: now,
    } as NoteRecord);

    const note = findById('notes', noteId) as NoteRecord;
    res.status(201).json({ success: true, note });
  } catch (error: any) {
    console.error('Search to-note error:', error.message);
    res.status(500).json({ error: 'TO_NOTE_FAILED', message: error.message });
  }
});

// URL 解析 / 网页内容提取
router.post('/browse', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      res.status(400).json({ error: 'URL is required' });
      return;
    }

    try {
      new URL(url);
    } catch {
      res.status(400).json({ error: 'Invalid URL format' });
      return;
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AI-Workbench/1.0)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      res.status(response.status).json({ error: `Failed to fetch URL: ${response.statusText}` });
      return;
    }

    const html = await response.text();

    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';

    const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
                      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
    const description = descMatch ? descMatch[1].trim() : '';

    let text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();

    const maxLength = 50000;
    const isTruncated = text.length > maxLength;
    if (isTruncated) text = text.slice(0, maxLength);

    res.json({
      url,
      title,
      description,
      content: text,
      content_length: text.length,
      is_truncated: isTruncated,
      status: response.status,
    });
  } catch (error: any) {
    console.error('Browse error:', error?.message || error);
    res.status(500).json({ error: error?.message || 'Failed to browse URL' });
  }
});

export default router;
