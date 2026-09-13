import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { EmbeddingClient, LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { getSupabaseClient } from '../storage/database/supabase-client.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { splitTextIntoChunks } from '../utils/text.js';

const router: import("express").Router = Router();
const config = new Config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.resolve(__dirname, '../../uploads');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

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

// Knowledge base CRUD
router.get('/bases', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('knowledge_bases')
      .select('*')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ bases: data || [] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get knowledge bases' });
  }
});

router.post('/bases', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { name, description } = req.body;
    const supabase = getSupabaseClient();
    const id = uuidv4();

    const { data, error } = await supabase
      .from('knowledge_bases')
      .insert({
        id,
        user_id: req.userId,
        name,
        description: description || '',
      })
      .select()
      .single();

    if (error) throw error;
    res.json({ base: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create knowledge base' });
  }
});

router.patch('/bases/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;
    const supabase = getSupabaseClient();

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;

    const { data, error } = await supabase
      .from('knowledge_bases')
      .update(updates)
      .eq('id', id)
      .eq('user_id', req.userId)
      .select()
      .single();

    if (error) throw error;
    res.json({ base: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update knowledge base' });
  }
});

router.delete('/bases/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from('knowledge_bases')
      .delete()
      .eq('id', id)
      .eq('user_id', req.userId);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete knowledge base' });
  }
});

// Documents in a knowledge base
router.get('/bases/:id/documents', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .eq('knowledge_base_id', id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ documents: data || [] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get documents' });
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

    // Extract text content based on file type
    let content = '';
    try {
      if (fileExt === '.txt' || fileExt === '.md') {
        content = fs.readFileSync(filePath, 'utf-8');
      } else if (fileExt === '.pdf') {
        // Dynamic import for pdf-parse
        const { default: pdfParse } = await import('pdf-parse');
        const dataBuffer = fs.readFileSync(filePath);
        const pdfData = await pdfParse(dataBuffer);
        content = pdfData.text;
      } else if (fileExt === '.docx' || fileExt === '.doc') {
        // Simple text extraction - in production use mammoth or officeparser
        content = `[${fileName}] - Word document uploaded. Text extraction for .docx requires additional processing.`;
      } else {
        content = `[${fileName}] - File uploaded.`;
      }
    } catch (extractError) {
      console.error('Text extraction error:', extractError);
      content = `[${fileName}] - Content extraction failed.`;
    }

    // Chunk the content
    const chunks = chunkText(content, 800);

    // Generate embeddings for chunks
    const customHeaders = HeaderUtils.extractForwardHeaders(req.headers as Record<string, string>);
    const embeddingClient = new EmbeddingClient({ customHeaders } as any);

    const embeddings: number[][] = [];
    for (const chunk of chunks.slice(0, 50)) { // Limit to 50 chunks for now
      try {
        const embedding = await embeddingClient.embedText(chunk);
        embeddings.push(embedding);
      } catch (e) {
        console.error('Embedding error:', e);
      }
    }

    const supabase = getSupabaseClient();
    const docId = uuidv4();

    // Save document record
    const { data: docData, error: docError } = await supabase
      .from('documents')
      .insert({
        id: docId,
        knowledge_base_id: baseId,
        filename: fileName,
        file_path: filePath,
        file_size: file.size,
        content_preview: content.slice(0, 500),
        chunk_count: chunks.length,
        status: 'processed',
      })
      .select()
      .single();

    if (docError) throw docError;

    // Save chunks with embeddings
    const chunkRecords = chunks.map((chunk, i) => ({
      id: uuidv4(),
      document_id: docId,
      knowledge_base_id: baseId,
      chunk_index: i,
      content: chunk,
      embedding: embeddings[i] || null,
    }));

    if (chunkRecords.length > 0) {
      const { error: chunkError } = await supabase
        .from('document_chunks')
        .insert(chunkRecords);

      if (chunkError) console.error('Chunk insert error:', chunkError);
    }

    // Clean up uploaded file
    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      // ignore
    }

    res.json({ document: docData, chunks_processed: chunkRecords.length });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to upload document' });
  }
});

// Delete document
router.delete('/documents/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from('documents')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

// RAG query
router.post('/bases/:id/query', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id: baseId } = req.params;
    const { query, top_k = 5, model } = req.body;

    if (!query) {
      res.status(400).json({ error: 'Query is required' });
      return;
    }

    const customHeaders = HeaderUtils.extractForwardHeaders(req.headers as Record<string, string>);
    const embeddingClient = new EmbeddingClient({ customHeaders } as any);
    const supabase = getSupabaseClient();

    // Generate query embedding
    const queryEmbedding = await embeddingClient.embedText(query);

    // Search for relevant chunks using pgvector
    const { data: chunks, error } = await supabase.rpc('match_document_chunks', {
      query_embedding: queryEmbedding,
      knowledge_base_id_param: baseId,
      match_threshold: 0.5,
      match_count: top_k,
    });

    if (error) {
      console.error('Vector search error:', error);
      // Fallback: return empty results
      res.json({ results: [], answer: null });
      return;
    }

    const relevantChunks = (chunks || []).map((c: { content: string; document_id: string; similarity: number }) => ({
      content: c.content,
      document_id: c.document_id,
      similarity: c.similarity,
    }));

    // Generate answer using LLM with context
    const context = relevantChunks.map((c: { content: string }, i: number) => `[${i + 1}] ${c.content}`).join('\n\n');
    const systemPrompt = `你是一个知识库助手。请基于以下参考资料回答用户的问题。
如果参考资料中没有相关信息，请如实告诉用户"未找到相关信息"，不要编造答案。

参考资料：
${context}`;

    const llmClient = new LLMClient(config, customHeaders);
    const response = await llmClient.invoke(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: query },
      ],
      {
        model: model || 'doubao-seed-2-0-pro-260215',
        temperature: 0.3,
      }
    );

    res.json({
      results: relevantChunks,
      answer: response.content,
    });
  } catch (error) {
    console.error('RAG query error:', error);
    res.status(500).json({ error: 'Query failed' });
  }
});

// Knowledge base sharing
router.get('/bases/:id/share', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id: baseId } = req.params;
    const supabase = getSupabaseClient();

    const { data: shareLinks, error: shareError } = await supabase
      .from('knowledge_shares')
      .select('*')
      .eq('knowledge_base_id', baseId);

    const { data: collaborators, error: collabError } = await supabase
      .from('knowledge_collaborators')
      .select('*')
      .eq('knowledge_base_id', baseId);

    if (shareError || collabError) {
      throw shareError || collabError;
    }

    res.json({ shareLinks: shareLinks || [], collaborators: collaborators || [] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get share info' });
  }
});

router.post('/bases/:id/share', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id: baseId } = req.params;
    const { expires_at, permission } = req.body;
    const supabase = getSupabaseClient();
    const shareToken = uuidv4();

    const { data, error } = await supabase
      .from('knowledge_shares')
      .insert({
        id: uuidv4(),
        knowledge_base_id: baseId,
        share_token: shareToken,
        created_by: req.userId,
        permission: permission || 'read',
        expires_at: expires_at || null,
      })
      .select()
      .single();

    if (error) throw error;
    res.json({ share: data, share_url: `/share/${shareToken}` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create share link' });
  }
});

// Add collaborator
router.post('/bases/:id/collaborators', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id: baseId } = req.params;
    const { email, permission } = req.body;
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('knowledge_collaborators')
      .insert({
        id: uuidv4(),
        knowledge_base_id: baseId,
        user_email: email,
        permission: permission || 'read',
        invited_by: req.userId,
      })
      .select()
      .single();

    if (error) throw error;
    res.json({ collaborator: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add collaborator' });
  }
});

router.delete('/collaborators/:id', authMiddleware, async (_req: AuthRequest, res) => {
  try {
    const { id } = _req.params;
    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from('knowledge_collaborators')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove collaborator' });
  }
});

// Helper functions
function chunkText(text: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  const sentences = text.split(/[。！？.!?\n]+/).filter(s => s.trim().length > 0);

  let currentChunk = '';
  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > chunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk += (currentChunk ? '。' : '') + sentence;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

// 从 URL 添加网页到知识库
router.post('/add-from-url', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { baseId, url, title: customTitle } = req.body;

    if (!baseId || !url) {
      res.status(400).json({ error: 'baseId and url are required' });
      return;
    }

    const supabase = getSupabaseClient();

    // 验证知识库归属
    const { data: kb, error: kbError } = await supabase
      .from('knowledge_bases')
      .select('*')
      .eq('id', baseId)
      .eq('user_id', req.userId)
      .single();

    if (kbError || !kb) {
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
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        res.status(400).json({ error: `Failed to fetch URL: ${response.statusText}` });
        return;
      }

      const html = await response.text();

      // 提取标题
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      pageTitle = customTitle || (titleMatch ? titleMatch[1].trim() : url);

      // 提取正文
      pageContent = html
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
        .trim()
        .slice(0, 50000);
    } catch (fetchErr: any) {
      res.status(400).json({ error: `Failed to fetch URL: ${fetchErr?.message || fetchErr}` });
      return;
    }

    // 创建文档
    const docId = uuidv4();
    const { error: docError } = await supabase.from('documents').insert({
      id: docId,
      knowledge_base_id: baseId,
      filename: `${pageTitle || url}.html`,
      file_path: url,
      file_size: pageContent.length,
      content_preview: pageContent.slice(0, 200),
      chunk_count: 0,
      status: 'processing',
    });

    if (docError) throw docError;

    // 异步向量化
    (async () => {
      try {
        const chunks = splitTextIntoChunks(pageContent, 500, 50);

        const customHeaders = HeaderUtils.extractForwardHeaders(req.headers as Record<string, string>);
        const embedClient = new EmbeddingClient({ customHeaders } as any);

        for (let i = 0; i < chunks.length; i++) {
          try {
            const chunkId = uuidv4();
            const embedding = await embedClient.embedText(chunks[i]);
            if (embedding) {
              await supabase.from('document_chunks').insert({
                id: chunkId,
                document_id: docId,
                knowledge_base_id: baseId,
                chunk_index: i,
                content: chunks[i],
                embedding: JSON.stringify(embedding),
              });
            }
          } catch (chunkErr) {
            console.error('Chunk embedding error:', chunkErr);
          }
        }

        await supabase.from('documents').update({
          chunk_count: chunks.length,
          status: 'completed',
        }).eq('id', docId);
      } catch (err) {
        console.error('Embedding error for URL document:', err);
        await supabase.from('documents').update({ status: 'error' }).eq('id', docId);
      }
    })();

    res.json({
      document_id: docId,
      title: pageTitle,
      content_preview: pageContent.slice(0, 200),
      status: 'processing',
    });
  } catch (error: any) {
    console.error('Add from URL error:', error);
    res.status(500).json({ error: error?.message || 'Failed to add from URL' });
  }
});

export default router;
