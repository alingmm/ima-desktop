import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { v4 as uuidv4 } from 'uuid';
import {
  selectWhere, insertOne, updateOne, deleteWhere, orderBy,
  ConversationRecord, MessageRecord, KnowledgeBaseRecord, DocumentRecord,
  DocumentChunkRecord, selectOne,
} from '../storage/json-storage';
import { chatCompletion, streamChatCompletion, createEmbedding, cosineSimilarity, API_ERRORS } from '../services/ai';
import { loadConfig } from '../config';
import { splitTextIntoChunks } from '../utils/text';

const router: import('express').Router = Router();

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

function apiError(res: any, status: number, code: string, message: string) {
  res.status(status).json({ error: code, message });
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
        // 保存消息
        if (conversation_id && content) {
          try {
            const lastUserMsg = messages.filter((m: Message) => m.role === 'user').pop();
            if (lastUserMsg) {
              insertOne('messages', {
                id: uuidv4(),
                conversation_id,
                role: 'user',
                content: lastUserMsg.content,
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
          content: lastUserMsg.content,
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
      filename: `${title}.txt`,
      content_preview: content.slice(0, 500),
      chunk_count: 1,
      status: 'processed',
      created_at: new Date().toISOString(),
    } as DocumentRecord);

    // 尝试向量化
    try {
      const chunks = splitTextIntoChunks(content, 800);
      const chunkRecords: DocumentChunkRecord[] = [];
      for (let i = 0; i < Math.min(chunks.length, 50); i++) {
        try {
          const embedding = await createEmbedding(chunks[i]);
          chunkRecords.push({
            id: uuidv4(),
            document_id: docId,
            knowledge_base_id: baseId,
            chunk_index: i,
            content: chunks[i],
            embedding,
            created_at: new Date().toISOString(),
          });
        } catch (embErr: any) {
          // embedding 失败也保存纯文本
          chunkRecords.push({
            id: uuidv4(),
            document_id: docId,
            knowledge_base_id: baseId,
            chunk_index: i,
            content: chunks[i],
            embedding: null,
            created_at: new Date().toISOString(),
          });
        }
      }
      for (const cr of chunkRecords) {
        insertOne('document_chunks', cr);
      }
    } catch (embErr: any) {
      console.warn('Embedding for saved chat failed:', embErr.message);
    }

    res.json({ success: true, document: doc, base_id: baseId });
  } catch (error: any) {
    console.error('Save to knowledge error:', error.message);
    res.status(500).json({ error: 'Failed to save to knowledge', message: error.message });
  }
});

export default router;
