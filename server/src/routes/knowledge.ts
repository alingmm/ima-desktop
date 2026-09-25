import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import {
  selectWhere, insertOne, updateOne, deleteWhere, orderBy, selectOne, insertMany,
  findById, updateById,
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
    let embeddingFailed = false;
    let embeddingErrorCode: string | null = null;
    let embeddingErrorMessage: string | null = null;

    for (const chunk of limitedChunks) {
      try {
        const embedding = await createEmbedding(chunk);
        embeddings.push(embedding);
      } catch (e: any) {
        embeddingFailed = true;
        embeddingErrorCode = e.code || 'EMBEDDING_ERROR';
        embeddingErrorMessage = e.message || '向量生成失败';
        // 所有剩余的都设为 null
        for (let i = embeddings.length; i < limitedChunks.length; i++) {
          embeddings.push(null);
        }
        break;
      }
    }

    const docId = uuidv4();
    const now = new Date().toISOString();

    // Save document record
    const finalStatus = embeddingFailed ? 'failed' : 'processed';
    const doc = insertOne('documents', {
      id: docId,
      knowledge_base_id: baseId,
      filename: fileName,
      file_path: filePath,
      file_size: file.size,
      content_preview: content.slice(0, 500),
      chunk_count: chunks.length,
      status: finalStatus,
      error_code: embeddingErrorCode,
      error_message: embeddingErrorMessage,
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

    if (embeddingFailed) {
      res.status(400).json({
        error: embeddingErrorCode,
        message: embeddingErrorMessage + '（文档已保存但未向量化，配置 API Key 后可重新向量化）',
        document: doc,
        chunks_processed: chunkRecords.length,
        embedding_ready: false,
      });
      return;
    }

    res.json({ document: doc, chunks_processed: chunkRecords.length, embedding_ready: true });
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

// Get document full content (concatenate all chunks)
router.get('/documents/:id/content', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const doc = findById('documents', id) as DocumentRecord | undefined;
    if (!doc || doc.user_id !== req.userId) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    const rawChunks = selectWhere('document_chunks', { document_id: id } as Partial<DocumentChunkRecord>);
    const chunks = orderBy(rawChunks as DocumentChunkRecord[], 'chunk_index', 'asc');
    const content = chunks.map((c) => c.content).join('\n\n');
    res.json({ content, filename: doc.filename, chunk_count: chunks.length });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get document content', message: error.message });
  }
});

// Update document content (re-chunk + re-embed)
router.patch('/documents/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { content, filename } = req.body;

    const doc = findById('documents', id) as DocumentRecord | undefined;
    if (!doc || doc.user_id !== req.userId) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    if (typeof content !== 'string' || content.trim().length === 0) {
      res.status(400).json({ error: 'Content is required' });
      return;
    }

    // 1. Remove old chunks
    deleteWhere('document_chunks', { document_id: id } as Partial<DocumentChunkRecord>);

    // 2. Re-chunk
    const textChunks = splitTextIntoChunks(content, 800);

    // 3. Try embedding
    let embeddingReady = false;
    let embedError: string | null = null;
    let embedErrorCode: string | null = null;
    const embeddings: (number[] | null)[] = new Array(textChunks.length).fill(null);

    try {
      for (let i = 0; i < textChunks.length; i++) {
        embeddings[i] = await createEmbedding(textChunks[i]);
      }
      textChunks.forEach((text, index) => {
        insertOne('document_chunks', {
          id: uuidv4(),
          document_id: id,
          knowledge_base_id: doc.knowledge_base_id,
          user_id: req.userId,
          chunk_index: index,
          content: text,
          embedding: embeddings[index],
          created_at: new Date().toISOString(),
        } as DocumentChunkRecord);
      });
      embeddingReady = true;
    } catch (embedErr: any) {
      // Save chunks without embeddings, mark as failed
      textChunks.forEach((text, index) => {
        insertOne('document_chunks', {
          id: uuidv4(),
          document_id: id,
          knowledge_base_id: doc.knowledge_base_id,
          user_id: req.userId,
          chunk_index: index,
          content: text,
          embedding: embeddings[index] || null,
          created_at: new Date().toISOString(),
        } as DocumentChunkRecord);
      });
      embedError = embedErr.message || 'Embedding failed';
      embedErrorCode = embedErr.code || 'EMBEDDING_ERROR';
    }

    // 4. Update document metadata
    const updatedDoc = updateById('documents', id, {
      filename: filename || doc.filename,
      chunk_count: textChunks.length,
      file_size: Buffer.byteLength(content, 'utf8'),
      status: embeddingReady ? 'completed' : 'failed',
      error_code: embedErrorCode,
      error_message: embedError,
      updated_at: new Date().toISOString(),
    } as Partial<DocumentRecord>);

    if (!embeddingReady) {
      res.status(400).json({
        error: embedErrorCode,
        message: `${embedError}（文档已保存但未向量化，配置 Embedding 后重新保存即可生效）`,
        document: updatedDoc,
        embedding_ready: false,
      });
      return;
    }

    res.json({ document: updatedDoc, embedding_ready: true, chunk_count: textChunks.length });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update document', message: error.message });
  }
});

// Import note as a knowledge document
router.post('/bases/:id/import-note', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id: baseId } = req.params;
    const { note_id } = req.body;

    const base = findById('knowledge_bases', baseId) as KnowledgeBaseRecord | undefined;
    if (!base || base.user_id !== req.userId) {
      res.status(404).json({ error: 'Knowledge base not found' });
      return;
    }

    if (!note_id) {
      res.status(400).json({ error: 'note_id is required' });
      return;
    }

    const note = findById('notes', note_id) as any;
    if (!note || note.user_id !== req.userId) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }

    const content = note.content || '';
    if (!content.trim()) {
      res.status(400).json({ error: 'Note content is empty' });
      return;
    }

    const docId = uuidv4();
    const chunks = splitTextIntoChunks(content, 800);

    // Insert document placeholder first
    insertOne('documents', {
      id: docId,
      knowledge_base_id: baseId,
      user_id: req.userId,
      filename: note.title || '导入的笔记',
      file_type: 'text/markdown',
      file_size: Buffer.byteLength(content, 'utf8'),
      chunk_count: chunks.length,
      status: 'processing',
      error_code: null,
      error_message: null,
      source: 'note',
      source_note_id: note_id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as DocumentRecord);

    // Try embedding
    let embeddingReady = false;
    let embedError: string | null = null;
    let embedErrorCode: string | null = null;
    const embeddings: (number[] | null)[] = new Array(chunks.length).fill(null);

    try {
      for (let i = 0; i < chunks.length; i++) {
        embeddings[i] = await createEmbedding(chunks[i]);
      }
      chunks.forEach((text, index) => {
        insertOne('document_chunks', {
          id: uuidv4(),
          document_id: docId,
          knowledge_base_id: baseId,
          user_id: req.userId,
          chunk_index: index,
          content: text,
          embedding: embeddings[index],
          created_at: new Date().toISOString(),
        } as DocumentChunkRecord);
      });
      embeddingReady = true;
    } catch (embedErr: any) {
      chunks.forEach((text, index) => {
        insertOne('document_chunks', {
          id: uuidv4(),
          document_id: docId,
          knowledge_base_id: baseId,
          user_id: req.userId,
          chunk_index: index,
          content: text,
          embedding: embeddings[index] || null,
          created_at: new Date().toISOString(),
        } as DocumentChunkRecord);
      });
      embedError = embedErr.message || 'Embedding failed';
      embedErrorCode = embedErr.code || 'EMBEDDING_ERROR';
    }

    const finalDoc = updateById('documents', docId, {
      status: embeddingReady ? 'completed' : 'failed',
      error_code: embedErrorCode,
      error_message: embedError,
      updated_at: new Date().toISOString(),
    } as Partial<DocumentRecord>);

    if (!embeddingReady) {
      res.status(400).json({
        error: embedErrorCode,
        message: `${embedError}（文档已导入但未向量化，配置 Embedding 后重新编辑保存即可生效）`,
        document: finalDoc,
        embedding_ready: false,
      });
      return;
    }

    res.status(201).json({ document: finalDoc, embedding_ready: true, chunk_count: chunks.length });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to import note', message: error.message });
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

    const allChunksWithEmbedding = allChunks.filter(
      (c) => c.embedding && Array.isArray(c.embedding) && c.embedding.length > 0,
    );

    if (allChunksWithEmbedding.length === 0) {
      // 知识库中没有向量化的文档（可能未配置 embedding）
      res.status(400).json({
        error: 'EMBEDDING_NOT_CONFIGURED',
        message: '知识库中没有可检索的向量化文档，请先在设置页配置 Embedding API Key，或重新上传文档以触发向量化',
      });
      return;
    }

    let queryEmbedding: number[];
    try {
      queryEmbedding = await createEmbedding(query);
    } catch (embErr: any) {
      res.status(400).json({
        error: embErr.code === API_ERRORS.API_KEY_NOT_CONFIGURED
          ? 'API_KEY_NOT_CONFIGURED'
          : 'EMBEDDING_ERROR',
        message: embErr.message || '向量检索失败，请检查 API Key 配置',
      });
      return;
    }

    const withSimilarity = allChunksWithEmbedding
      .map((c) => ({
        content: c.content,
        document_id: c.document_id,
        similarity: cosineSimilarity(queryEmbedding, c.embedding!),
      }))
      .filter((c) => c.similarity >= 0.5)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, top_k);
    relevantChunks = withSimilarity;

    // 3. Generate answer using LLM with context
    let answer: string | null = null;
    let llmError: string | null = null;
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
        llmError = llmErr.message || '大模型调用失败';
      }
    }

    res.json({
      results: relevantChunks,
      answer,
      llm_error: llmError,
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

    const allChunksWithEmbedding = allChunks.filter(
      (c) => c.embedding && Array.isArray(c.embedding) && c.embedding.length > 0,
    );

    if (allChunksWithEmbedding.length === 0) {
      res.status(400).json({
        error: 'EMBEDDING_NOT_CONFIGURED',
        message: '知识库中没有可检索的向量化文档，请先在设置页配置 Embedding API Key，或重新上传文档以触发向量化',
      });
      return;
    }

    let queryEmbedding: number[];
    try {
      queryEmbedding = await createEmbedding(query);
    } catch (embErr: any) {
      res.status(400).json({
        error: embErr.code === API_ERRORS.API_KEY_NOT_CONFIGURED
          ? 'API_KEY_NOT_CONFIGURED'
          : 'EMBEDDING_ERROR',
        message: embErr.message || '向量检索失败，请检查 API Key 配置',
      });
      return;
    }

    const relevantChunks = allChunksWithEmbedding
      .map((c) => ({
        content: c.content,
        document_id: c.document_id,
        similarity: cosineSimilarity(queryEmbedding, c.embedding!),
      }))
      .filter((c) => c.similarity >= 0.5)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, top_k);

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

    // 生成 embeddings
    const chunkRecords: DocumentChunkRecord[] = [];
    let embeddingFailed = false;
    let embeddingErrorCode: string | null = null;
    let embeddingErrorMessage: string | null = null;
    const limitedCount = Math.min(chunks.length, 50);

    for (let i = 0; i < limitedCount; i++) {
      let embedding: number[] | null = null;
      try {
        embedding = await createEmbedding(chunks[i]);
      } catch (e: any) {
        embeddingFailed = true;
        embeddingErrorCode = e.code || 'EMBEDDING_ERROR';
        embeddingErrorMessage = e.message || '向量生成失败';
        // 剩余的全部用 null
        for (let j = i; j < limitedCount; j++) {
          chunkRecords.push({
            id: uuidv4(),
            document_id: docId,
            knowledge_base_id: baseId,
            chunk_index: j,
            content: chunks[j],
            embedding: null,
            created_at: now,
          });
        }
        break;
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

    const finalStatus = embeddingFailed ? 'failed' : 'processed';
    const doc = insertOne('documents', {
      id: docId,
      knowledge_base_id: baseId,
      filename: pageTitle || url,
      file_path: url,
      content_preview: pageContent.slice(0, 500),
      chunk_count: chunks.length,
      status: finalStatus,
      error_code: embeddingErrorCode,
      error_message: embeddingErrorMessage,
      created_at: now,
    } as DocumentRecord);

    if (embeddingFailed) {
      res.status(400).json({
        error: embeddingErrorCode,
        message: embeddingErrorMessage + '（网页已保存但未向量化，配置 API Key 后可重新向量化）',
        document: doc,
        chunks_processed: chunkRecords.length,
        embedding_ready: false,
      });
      return;
    }

    res.json({ document: doc, chunks_processed: chunkRecords.length, embedding_ready: true });
  } catch (error: any) {
    console.error('Add from URL error:', error);
    res.status(500).json({ error: 'Failed to add from URL', message: error.message });
  }
});

export default router;
