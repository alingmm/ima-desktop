import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import {
  selectWhere, insertOne, updateOne, deleteWhere, orderBy, selectOne, insertMany,
  KnowledgeBaseRecord, DocumentRecord, DocumentChunkRecord,
  KnowledgeShareRecord, KnowledgeCollaboratorRecord,
} from '../storage/json-storage';
import { createEmbedding, chatCompletion, cosineSimilarity, API_ERRORS } from '../services/ai';
import { splitTextIntoChunks } from '../utils/text';
import { getUploadsDir, ensureDir } from '../config';

const router: import('express').Router = Router();

const uploadDir = getUploadsDir();
ensureDir(uploadDir);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

// ========== Knowledge Base CRUD ==========
router.get('/bases', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const bases = selectWhere('knowledge_bases', { user_id: req.userId } as Partial<KnowledgeBaseRecord>);
    const sorted = orderBy(bases, 'created_at', 'desc');
    res.json({ bases: sorted });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get knowledge bases', message: error.message });
  }
});

router.post('/bases', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { name, description } = req.body;
    if (!name) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }
    const id = uuidv4();
    const now = new Date().toISOString();
    const base = insertOne('knowledge_bases', {
      id,
      user_id: req.userId!,
      name,
      description: description || '',
      created_at: now,
      updated_at: now,
    } as KnowledgeBaseRecord);
    res.json({ base });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create knowledge base', message: error.message });
  }
});

router.patch('/bases/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    const updates: Partial<KnowledgeBaseRecord> = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;

    const updated = updateOne(
      'knowledge_bases',
      { id, user_id: req.userId } as Partial<KnowledgeBaseRecord>,
      updates
    );
    if (!updated) {
      res.status(404).json({ error: 'Knowledge base not found' });
      return;
    }
    res.json({ base: updated });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update knowledge base', message: error.message });
  }
});

router.delete('/bases/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    // 级联删除文档和chunks
    const docs = selectWhere('documents', { knowledge_base_id: id } as Partial<DocumentRecord>);
    for (const doc of docs) {
      deleteWhere('document_chunks', { document_id: doc.id } as Partial<DocumentChunkRecord>);
    }
    deleteWhere('documents', { knowledge_base_id: id } as Partial<DocumentRecord>);
    deleteWhere('knowledge_shares', { knowledge_base_id: id } as Partial<KnowledgeShareRecord>);
    deleteWhere('knowledge_collaborators', { knowledge_base_id: id } as Partial<KnowledgeCollaboratorRecord>);

    const count = deleteWhere('knowledge_bases', { id, user_id: req.userId } as Partial<KnowledgeBaseRecord>);
    if (count === 0) {
      res.status(404).json({ error: 'Knowledge base not found' });
      return;
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete knowledge base', message: error.message });
  }
});

// ========== Documents ==========
router.get('/bases/:id/documents', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const docs = selectWhere('documents', { knowledge_base_id: id } as Partial<DocumentRecord>);
    const sorted = orderBy(docs, 'created_at', 'desc');
    res.json({ documents: sorted });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get documents', message: error.message });
  }
});

// Upload document
router.post('/bases/:id/upload', authMiddleware, upload.single('file'), async (req: AuthRequest, res) => {
  try {
    const { id: baseId } = req.params;
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const filePath = file.path;
    const fileName = file.originalname;
    const fileExt = path.extname(fileName).toLowerCase();

    // Extract text content
    let content = '';
    try {
      if (fileExt === '.txt' || fileExt === '.md') {
        content = fs.readFileSync(filePath, 'utf-8');
      } else if (fileExt === '.pdf') {
        const { default: pdfParse } = await import('pdf-parse');
        const dataBuffer = fs.readFileSync(filePath);
        const pdfData = await pdfParse(dataBuffer);
        content = pdfData.text;
      } else if (fileExt === '.docx' || fileExt === '.doc') {
        content = `[${fileName}] - Word document uploaded. Text extraction for .docx requires additional processing.`;
      } else {
        content = `[${fileName}] - File uploaded.`;
      }
    } catch (extractError) {
      console.error('Text extraction error:', extractError);
      content = `[${fileName}] - Content extraction failed.`;
    }

    // Chunk the content
    const chunks = splitTextIntoChunks(content, 800);

    // Generate embeddings for chunks
    const embeddings: (number[] | null)[] = [];
    const limitedChunks = chunks.slice(0, 50);

    for (const chunk of limitedChunks) {
      try {
        const embedding = await createEmbedding(chunk);
        embeddings.push(embedding);
      } catch (e: any) {
        if (e.code === API_ERRORS.API_KEY_NOT_CONFIGURED) {
          // 没有配置API Key，全部不向量化
          for (let i = embeddings.length; i < limitedChunks.length; i++) {
            embeddings.push(null);
          }
          break;
        }
        console.error('Embedding error:', e);
        embeddings.push(null);
      }
    }

    const docId = uuidv4();
    const now = new Date().toISOString();

    // Save document record
    const doc = insertOne('documents', {
      id: docId,
      knowledge_base_id: baseId,
      filename: fileName,
      file_path: filePath,
      file_size: file.size,
      content_preview: content.slice(0, 500),
      chunk_count: chunks.length,
      status: 'processed',
      created_at: now,
    } as DocumentRecord);

    // Save chunks with embeddings
    const chunkRecords = limitedChunks.map((chunk, i) => ({
      id: uuidv4(),
      document_id: docId,
      knowledge_base_id: baseId,
      chunk_index: i,
      content: chunk,
      embedding: embeddings[i] || null,
      created_at: now,
    }));

    if (chunkRecords.length > 0) {
      insertMany('document_chunks', chunkRecords);
    }

    // Clean up uploaded file
    try {
      fs.unlinkSync(filePath);
    } catch {
      // ignore
    }

    res.json({ document: doc, chunks_processed: chunkRecords.length });
  } catch (error: any) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to upload document', message: error.message });
  }
});

// Delete document
router.delete('/documents/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    deleteWhere('document_chunks', { document_id: id } as Partial<DocumentChunkRecord>);
    const count = deleteWhere('documents', { id } as Partial<DocumentRecord>);
    if (count === 0) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete document', message: error.message });
  }
});

// ========== RAG Query ==========
router.post('/bases/:id/query', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id: baseId } = req.params;
    const { query, top_k = 5, model } = req.body;

    if (!query) {
      res.status(400).json({ error: 'Query is required' });
      return;
    }

    // 1. 获取知识库的所有 chunks
    const allChunks = selectWhere('document_chunks', { knowledge_base_id: baseId } as Partial<DocumentChunkRecord>);

    // 2. 生成 query embedding 并检索
    let relevantChunks: Array<{ content: string; document_id: string; similarity: number }> = [];

    try {
      const queryEmbedding = await createEmbedding(query);
      const withSimilarity = allChunks
        .filter((c) => c.embedding && Array.isArray(c.embedding))
        .map((c) => ({
          content: c.content,
          document_id: c.document_id,
          similarity: cosineSimilarity(queryEmbedding, c.embedding!),
        }))
        .filter((c) => c.similarity >= 0.5)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, top_k);
      relevantChunks = withSimilarity;
    } catch (embErr: any) {
      console.warn('RAG embedding search failed, falling back to keyword search:', embErr.message);
      // fallback: 关键词匹配
      const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
      const scored = allChunks.map((c) => {
        const lower = c.content.toLowerCase();
        let score = 0;
        for (const kw of keywords) {
          if (lower.includes(kw)) score++;
        }
        return { content: c.content, document_id: c.document_id, similarity: score / Math.max(keywords.length, 1) };
      });
      relevantChunks = scored
        .filter((c) => c.similarity > 0)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, top_k);
    }

    // 3. Generate answer using LLM with context
    let answer: string | null = null;
    if (relevantChunks.length > 0) {
      const context = relevantChunks.map((c, i) => `[${i + 1}] ${c.content}`).join('\n\n');
      const systemPrompt = `你是一个知识库助手。请基于以下参考资料回答用户的问题。
如果参考资料中没有相关信息，请如实告诉用户"未找到相关信息"，不要编造答案。

参考资料：
${context}`;

      try {
        const response = await chatCompletion(
          [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: query },
          ],
          { model: model || undefined, temperature: 0.3 }
        );
        answer = response.content;
      } catch (llmErr: any) {
        console.error('RAG LLM error:', llmErr.message);
        // 如果 LLM 不可用，只返回相关片段
      }
    }

    res.json({
      results: relevantChunks,
      answer,
    });
  } catch (error: any) {
    console.error('RAG query error:', error);
    res.status(500).json({ error: 'Query failed', message: error.message });
  }
});

// RAG streaming search
router.post('/bases/:id/search/stream', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id: baseId } = req.params;
    const { query, top_k = 5 } = req.body;

    if (!query) {
      res.status(400).json({ error: 'Query is required' });
      return;
    }

    const allChunks = selectWhere('document_chunks', { knowledge_base_id: baseId } as Partial<DocumentChunkRecord>);

    let relevantChunks: Array<{ content: string; document_id: string; similarity: number }> = [];
    try {
      const queryEmbedding = await createEmbedding(query);
      relevantChunks = allChunks
        .filter((c) => c.embedding && Array.isArray(c.embedding))
        .map((c) => ({
          content: c.content,
          document_id: c.document_id,
          similarity: cosineSimilarity(queryEmbedding, c.embedding!),
        }))
        .filter((c) => c.similarity >= 0.5)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, top_k);
    } catch {
      // fallback keyword
      const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
      relevantChunks = allChunks
        .map((c) => {
          const lower = c.content.toLowerCase();
          let score = 0;
          for (const kw of keywords) if (lower.includes(kw)) score++;
          return { content: c.content, document_id: c.document_id, similarity: score / Math.max(keywords.length, 1) };
        })
        .filter((c) => c.similarity > 0)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, top_k);
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // 先发送检索结果
    res.write(`data: ${JSON.stringify({ type: 'results', results: relevantChunks })}\n\n`);

    if (relevantChunks.length === 0) {
      res.write(`data: ${JSON.stringify({ done: true, answer: null })}\n\n`);
      res.end();
      return;
    }

    // 然后流式生成回答
    const context = relevantChunks.map((c, i) => `[${i + 1}] ${c.content}`).join('\n\n');
    const systemPrompt = `你是一个知识库助手。请基于以下参考资料回答用户的问题。
如果参考资料中没有相关信息，请如实告诉用户"未找到相关信息"，不要编造答案。

参考资料：
${context}`;

    const { streamChatCompletion } = await import('../services/ai');
    streamChatCompletion(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: query },
      ],
      {
        onContent: (text: string) => {
          res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
        },
        onDone: (fullContent: string) => {
          res.write(`data: ${JSON.stringify({ done: true, answer: fullContent })}\n\n`);
          res.end();
        },
        onError: (err: Error) => {
          res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
          res.end();
        },
      }
    );
  } catch (error: any) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Search stream failed', message: error.message });
    }
  }
});

// ========== Knowledge base sharing ==========
router.get('/bases/:id/share', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id: baseId } = req.params;
    const shareLinks = selectWhere('knowledge_shares', { knowledge_base_id: baseId } as Partial<KnowledgeShareRecord>);
    const collaborators = selectWhere('knowledge_collaborators', { knowledge_base_id: baseId } as Partial<KnowledgeCollaboratorRecord>);
    res.json({ shareLinks, collaborators });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get share info', message: error.message });
  }
});

router.post('/bases/:id/share', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id: baseId } = req.params;
    const { expires_at, permission } = req.body;
    const shareToken = uuidv4();

    const share = insertOne('knowledge_shares', {
      id: uuidv4(),
      knowledge_base_id: baseId,
      share_token: shareToken,
      created_by: req.userId!,
      permission: permission || 'read',
      expires_at: expires_at || null,
      created_at: new Date().toISOString(),
    } as KnowledgeShareRecord);

    res.json({ share, share_url: `/share/${shareToken}` });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create share link', message: error.message });
  }
});

// Add collaborator
router.post('/bases/:id/collaborators', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id: baseId } = req.params;
    const { email, permission } = req.body;

    if (!email) {
      res.status(400).json({ error: 'Email is required' });
      return;
    }

    const collaborator = insertOne('knowledge_collaborators', {
      id: uuidv4(),
      knowledge_base_id: baseId,
      user_email: email,
      permission: permission || 'read',
      invited_by: req.userId!,
      created_at: new Date().toISOString(),
    } as KnowledgeCollaboratorRecord);

    res.json({ collaborator });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to add collaborator', message: error.message });
  }
});

router.delete('/collaborators/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const count = deleteWhere('knowledge_collaborators', { id } as Partial<KnowledgeCollaboratorRecord>);
    if (count === 0) {
      res.status(404).json({ error: 'Collaborator not found' });
      return;
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to remove collaborator', message: error.message });
  }
});

// 从 URL 添加网页到知识库
router.post('/add-from-url', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { baseId, url, title: customTitle } = req.body;

    if (!baseId || !url) {
      res.status(400).json({ error: 'baseId and url are required' });
      return;
    }

    // 验证知识库归属
    const kb = selectOne('knowledge_bases', { id: baseId, user_id: req.userId } as Partial<KnowledgeBaseRecord>);
    if (!kb) {
      res.status(403).json({ error: 'Knowledge base not found or access denied' });
      return;
    }

    // 获取网页内容
    let pageTitle = '';
    let pageContent = '';

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; AI-Workbench/1.0)',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        res.status(400).json({ error: `Failed to fetch URL: ${response.statusText}` });
        return;
      }

      const html = await response.text();
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      pageTitle = customTitle || (titleMatch ? titleMatch[1].trim() : url);

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
      if (text.length > maxLength) text = text.slice(0, maxLength);
      pageContent = text;
    } catch (fetchErr: any) {
      res.status(400).json({ error: `Failed to fetch URL: ${fetchErr.message}` });
      return;
    }

    const docId = uuidv4();
    const now = new Date().toISOString();
    const chunks = splitTextIntoChunks(pageContent, 800);

    const doc = insertOne('documents', {
      id: docId,
      knowledge_base_id: baseId,
      filename: pageTitle || url,
      file_path: url,
      content_preview: pageContent.slice(0, 500),
      chunk_count: chunks.length,
      status: 'processed',
      created_at: now,
    } as DocumentRecord);

    // 生成 embeddings
    const chunkRecords: DocumentChunkRecord[] = [];
    for (let i = 0; i < Math.min(chunks.length, 50); i++) {
      let embedding: number[] | null = null;
      try {
        embedding = await createEmbedding(chunks[i]);
      } catch {
        // ignore
      }
      chunkRecords.push({
        id: uuidv4(),
        document_id: docId,
        knowledge_base_id: baseId,
        chunk_index: i,
        content: chunks[i],
        embedding,
        created_at: now,
      });
    }
    if (chunkRecords.length > 0) {
      insertMany('document_chunks', chunkRecords);
    }

    res.json({ document: doc, chunks_processed: chunkRecords.length });
  } catch (error: any) {
    console.error('Add from URL error:', error);
    res.status(500).json({ error: 'Failed to add from URL', message: error.message });
  }
});

export default router;
