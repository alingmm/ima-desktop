import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { v4 as uuidv4 } from 'uuid';
import {
  selectWhere, insertOne, insertMany, updateOne, deleteWhere, orderBy,
  ConversationRecord, MessageRecord, KnowledgeBaseRecord, DocumentRecord,
  DocumentChunkRecord, selectOne,
} from '../storage/json-storage';
import { chatCompletion, streamChatCompletion, createEmbedding, createEmbeddingsBatch, cosineSimilarity, API_ERRORS, type ChatContentPart } from '../services/ai';
import { recallMemories, extractMemoryFromConversation } from '../services/memory';
import { loadConfig } from '../config';
import { splitTextIntoChunks } from '../utils/text';

const router: import('express').Router = Router();

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string | ChatContentPart[];
}

function apiError(res: any, status: number, code: string, message: string) {
  res.status(status).json({ error: code, message });
}

/** 把任意消息 content 收敛为纯文本（用于落库 / 记忆提取 / 标题） */
function contentToText(content: string | ChatContentPart[]): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (p.type === 'text' ? p.text : '[图片]'))
      .join('\n');
  }
  return '';
}

// Get available models (from config)
router.get('/models', (_req, res) => {
  const config = loadConfig();
  const modelId = config.chatModel || 'gpt-4o-mini';
  const models = [
    { id: modelId, name: modelId, provider: 'openai-compatible' },
  ];
  res.json({ models });
});

// Get conversation list
router.get('/conversations', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const convs = selectWhere('conversations', { user_id: req.userId } as Partial<ConversationRecord>);
    const sorted = orderBy(convs, 'updated_at', 'desc');
    res.json({ conversations: sorted });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get conversations', message: error.message });
  }
});

// Create new conversation
router.post('/conversations', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { title, model } = req.body;
    const id = uuidv4();
    const now = new Date().toISOString();
    const conv = insertOne('conversations', {
      id,
      user_id: req.userId!,
      title: title || '新对话',
      model: model || 'doubao-seed-2-0-pro-260215',
      created_at: now,
      updated_at: now,
    } as ConversationRecord);
    res.json({ conversation: conv });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create conversation', message: error.message });
  }
});

// Get conversation messages
router.get('/conversations/:id/messages', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const msgs = selectWhere('messages', { conversation_id: id } as Partial<MessageRecord>);
    const sorted = orderBy(msgs, 'created_at', 'asc');
    res.json({ messages: sorted });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get messages', message: error.message });
  }
});

// Delete conversation
router.delete('/conversations/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    // 删除关联消息
    deleteWhere('messages', { conversation_id: id } as Partial<MessageRecord>);
    // 删除会话
    const count = deleteWhere('conversations', { id, user_id: req.userId } as Partial<ConversationRecord>);
    if (count === 0) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete conversation', message: error.message });
  }
});

// Update conversation title
router.patch('/conversations/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { title, model } = req.body;

    const updates: Partial<ConversationRecord> = {};
    if (title !== undefined) updates.title = title;
    if (model !== undefined) updates.model = model;

    const updated = updateOne('conversations', { id, user_id: req.userId } as Partial<ConversationRecord>, updates);
    if (!updated) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }
    res.json({ conversation: updated });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update conversation', message: error.message });
  }
});

// Streaming chat
router.post('/stream', authMiddleware, async (req: AuthRequest, res) => {
  const { messages, model, conversation_id, system_prompt } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: 'Messages array is required' });
    return;
  }

  const formattedMessages: Message[] = [];
  if (system_prompt) {
    formattedMessages.push({ role: 'system', content: system_prompt });
  }
  formattedMessages.push(...messages);

  // 记忆召回：从用户上一句提取关键词，把匹配的记忆注入上下文
  try {
    const lastUser = [...messages].filter((m) => m.role === 'user').pop();
    if (lastUser) {
      const recalled = recallMemories(req.userId!, contentToText(lastUser.content), 5);
      if (recalled.length > 0) {
        const memText = recalled
          .map((m) => `- （${m.category}）${m.content}`)
          .join('\n');
        formattedMessages.push({
          role: 'system',
          content: `以下是与用户相关的长期记忆，请在与用户交流时自然地记住并参考这些信息（若与当前问题无关可忽略）：\n${memText}`,
        });
      }
    }
  } catch (e) {
    // 记忆召回失败不影响对话
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  let fullResponse = '';

  streamChatCompletion(
    formattedMessages,
    {
      onContent: (text: string) => {
        fullResponse += text;
        res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
      },
      onDone: async (content: string) => {
        // 自动记忆：从本次对话提炼长期值得记住的信息（异步，不阻塞）
        const lastUser = [...messages].filter((m) => m.role === 'user').pop();
        if (lastUser && content) {
          setTimeout(() => {
            extractMemoryFromConversation(
              req.userId!,
              contentToText(lastUser.content),
              content,
            ).catch(() => {});
          }, 0);
        }
        // 保存消息
        if (conversation_id && content) {
          try {
            const lastUserMsg = messages.filter((m: Message) => m.role === 'user').pop();
            if (lastUserMsg) {
              insertOne('messages', {
                id: uuidv4(),
                conversation_id,
                role: 'user',
                content: contentToText(lastUserMsg.content),
                created_at: new Date().toISOString(),
              } as MessageRecord);
            }
            insertOne('messages', {
              id: uuidv4(),
              conversation_id,
              role: 'assistant',
              content,
              created_at: new Date().toISOString(),
            } as MessageRecord);
            updateOne('conversations', { id: conversation_id } as Partial<ConversationRecord>, { updated_at: new Date().toISOString() });
          } catch {
            // ignore save errors
          }
        }
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
      },
      onError: (err: Error & { code?: string }) => {
        console.error('Stream error:', err.message);
        const code = err.code || 'STREAM_ERROR';
        res.write(`data: ${JSON.stringify({ error: code, message: err.message })}\n\n`);
        res.end();
      },
    },
    { model: model || undefined }
  );
});

// Non-streaming chat
router.post('/send', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { messages, model, conversation_id, system_prompt } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'Messages array is required' });
      return;
    }

    const formattedMessages: Message[] = [];
    if (system_prompt) {
      formattedMessages.push({ role: 'system', content: system_prompt });
    }
    formattedMessages.push(...messages);

    const response = await chatCompletion(formattedMessages, {
      model: model || undefined,
      temperature: 0.7,
    });

    // Save to database
    if (conversation_id && response.content) {
      const lastUserMsg = messages.filter((m: Message) => m.role === 'user').pop();
      if (lastUserMsg) {
        insertOne('messages', {
          id: uuidv4(),
          conversation_id,
          role: 'user',
          content: contentToText(lastUserMsg.content),
          created_at: new Date().toISOString(),
        } as MessageRecord);
      }
      insertOne('messages', {
        id: uuidv4(),
        conversation_id,
        role: 'assistant',
        content: response.content,
        created_at: new Date().toISOString(),
      } as MessageRecord);
      updateOne('conversations', { id: conversation_id } as Partial<ConversationRecord>, {
        updated_at: new Date().toISOString(),
      });
    }

    res.json({ content: response.content });
  } catch (error: any) {
    console.error('Chat error:', error.message);
    if (error.code === API_ERRORS.API_KEY_NOT_CONFIGURED) {
      res.status(400).json({ error: API_ERRORS.API_KEY_NOT_CONFIGURED, message: error.message });
    } else if (error.code === 'MODEL_NOT_VISION') {
      res.status(400).json({ error: 'MODEL_NOT_VISION', message: error.message });
    } else {
      res.status(500).json({ error: 'Chat failed', message: error.message });
    }
  }
});

// 将对话内容保存到知识库
router.post('/save-to-knowledge', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const user_id = req.userId!;
    const { knowledge_base_id, knowledge_base_name, question, answer } = req.body;

    if (!question && !answer) {
      res.status(400).json({ error: 'Question and answer cannot both be empty' });
      return;
    }

    let baseId = knowledge_base_id;

    // 如果没有指定知识库，创建一个新的
    if (!baseId) {
      if (!knowledge_base_name) {
        res.status(400).json({ error: 'knowledge_base_id or knowledge_base_name is required' });
        return;
      }
      const id = uuidv4();
      const now = new Date().toISOString();
      const base = insertOne('knowledge_bases', {
        id,
        user_id,
        name: knowledge_base_name,
        description: '',
        created_at: now,
        updated_at: now,
      } as KnowledgeBaseRecord);
      baseId = base.id;
    } else {
      // 验证知识库归属
      const kb = selectOne('knowledge_bases', { id: baseId, user_id } as Partial<KnowledgeBaseRecord>);
      if (!kb) {
        res.status(403).json({ error: 'Knowledge base not found or access denied' });
        return;
      }
    }

    // 生成文档
    const docId = uuidv4();
    const content = `问题：${question}\n\n回答：${answer}`;
    const title = question.slice(0, 100) || '对话保存';

    const doc = insertOne('documents', {
      id: docId,
      knowledge_base_id: baseId,
      user_id,
      filename: `${title}.txt`,
      content_preview: content.slice(0, 500),
      chunk_count: 1,
      status: 'processed',
      created_at: new Date().toISOString(),
    } as DocumentRecord);

    // 尝试向量化（受控并发 + 超时 + 批量一次写入，失败降级为纯文本，绝不冒泡）
    let embeddingReady = false;
    let embedErrorCode: string | null = null;
    let embedErrorMessage: string | null = null;
    try {
      const chunks = splitTextIntoChunks(content, 800).slice(0, 100);
      const batch = await createEmbeddingsBatch(chunks, 3, 30_000);
      const chunkRecords: DocumentChunkRecord[] = chunks.map((text, i) => ({
        id: uuidv4(),
        document_id: docId,
        knowledge_base_id: baseId,
        chunk_index: i,
        content: text,
        embedding: batch.embeddings[i],
        created_at: new Date().toISOString(),
      }));
      if (chunkRecords.length > 0) {
        insertMany('document_chunks', chunkRecords);
      }
      embeddingReady = batch.failedCount === 0;
      if (!embeddingReady) {
        embedErrorCode = batch.firstError?.code || 'EMBEDDING_ERROR';
        embedErrorMessage = batch.firstError?.message || `部分向量生成失败（${batch.failedCount}/${chunks.length}）`;
      }
    } catch (embErr: any) {
      console.warn('Embedding for saved chat failed:', embErr.message);
      embedErrorCode = embErr.code || 'EMBEDDING_ERROR';
      embedErrorMessage = embErr.message || '向量生成失败';
      // 兜底：保存纯文本分块
      try {
        const chunks = splitTextIntoChunks(content, 800).slice(0, 100);
        const chunkRecords: DocumentChunkRecord[] = chunks.map((text, i) => ({
          id: uuidv4(),
          document_id: docId,
          knowledge_base_id: baseId,
          chunk_index: i,
          content: text,
          embedding: null,
          created_at: new Date().toISOString(),
        }));
        if (chunkRecords.length > 0) {
          insertMany('document_chunks', chunkRecords);
        }
      } catch (saveErr: any) {
        console.error('Failed to save chat chunks:', saveErr.message);
      }
    }

    res.json({ success: true, document: doc, base_id: baseId, embedding_ready: embeddingReady, embed_error_code: embedErrorCode, embed_error_message: embedErrorMessage });
  } catch (error: any) {
    console.error('Save to knowledge error:', error.message);
    res.status(500).json({ error: 'Failed to save to knowledge', message: error.message });
  }
});

export default router;
