import { Router } from 'express';
import { LLMClient, Config, HeaderUtils, EmbeddingClient } from 'coze-coding-dev-sdk';
import { getSupabaseClient } from '../storage/database/supabase-client.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { v4 as uuidv4 } from 'uuid';
import { splitTextIntoChunks } from '../utils/text.js';

const router: import("express").Router = Router();
const config = new Config();

export const AVAILABLE_MODELS = [
  { id: 'doubao-seed-2-0-pro-260215', name: '豆包 Pro', provider: 'doubao' },
  { id: 'doubao-seed-2-0-lite-260215', name: '豆包 Lite', provider: 'doubao' },
  { id: 'doubao-seed-2-0-mini-260215', name: '豆包 Mini', provider: 'doubao' },
  { id: 'minimax-m2-7-260318', name: 'MiniMax M2.7', provider: 'minimax' },
  { id: 'qwen-3-5-plus-260215', name: '通义千问 Qwen3.5', provider: 'qwen' },
  { id: 'glm-5-0-260211', name: '智谱 GLM-5', provider: 'glm' },
];

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// Get available models
router.get('/models', (_req, res) => {
  res.json({ models: AVAILABLE_MODELS });
});

// Get conversation list
router.get('/conversations', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('conversations')
      .select('id, title, model, created_at, updated_at')
      .eq('user_id', req.userId)
      .order('updated_at', { ascending: false });

    if (error) throw error;
    res.json({ conversations: data || [] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get conversations' });
  }
});

// Create new conversation
router.post('/conversations', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { title, model } = req.body;
    const supabase = getSupabaseClient();
    const id = uuidv4();

    const { data, error } = await supabase
      .from('conversations')
      .insert({
        id,
        user_id: req.userId,
        title: title || '新对话',
        model: model || 'doubao-seed-2-0-pro-260215',
      })
      .select()
      .single();

    if (error) throw error;
    res.json({ conversation: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create conversation' });
  }
});

// Get conversation messages
router.get('/conversations/:id/messages', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json({ messages: data || [] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

// Delete conversation
router.delete('/conversations/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from('conversations')
      .delete()
      .eq('id', id)
      .eq('user_id', req.userId);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete conversation' });
  }
});

// Update conversation title
router.patch('/conversations/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { title, model } = req.body;
    const supabase = getSupabaseClient();

    const updates: Record<string, unknown> = {};
    if (title !== undefined) updates.title = title;
    if (model !== undefined) updates.model = model;

    const { data, error } = await supabase
      .from('conversations')
      .update(updates)
      .eq('id', id)
      .eq('user_id', req.userId)
      .select()
      .single();

    if (error) throw error;
    res.json({ conversation: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update conversation' });
  }
});

// Streaming chat
router.post('/stream', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { messages, model, conversation_id, system_prompt } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'Messages array is required' });
      return;
    }

    const customHeaders = HeaderUtils.extractForwardHeaders(req.headers as Record<string, string>);
    const client = new LLMClient(config, customHeaders);

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

    try {
      const stream = client.stream(formattedMessages, {
        model: model || 'doubao-seed-2-0-pro-260215',
        temperature: 0.7,
      });

      for await (const chunk of stream) {
          const text = chunk.content?.toString() || '';
          if (text) {
            fullResponse += text;
            res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
          }
        }
      

      // Save to database
      if (conversation_id && fullResponse) {
        const supabase = getSupabaseClient();
        // Save user message
        const lastUserMsg = messages.filter((m: Message) => m.role === 'user').pop();
        if (lastUserMsg) {
          await supabase.from('messages').insert({
            conversation_id,
            role: 'user',
            content: lastUserMsg.content,
          });
        }
        // Save assistant message
        await supabase.from('messages').insert({
          conversation_id,
          role: 'assistant',
          content: fullResponse,
        });
        // Update conversation updated_at
        await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversation_id);
      }

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (streamError) {
      console.error('Stream error:', streamError);
      res.write(`data: ${JSON.stringify({ error: 'Stream error' })}\n\n`);
      res.end();
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to start chat stream' });
  }
});

// Non-streaming chat
router.post('/send', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { messages, model, conversation_id, system_prompt } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'Messages array is required' });
      return;
    }

    const customHeaders = HeaderUtils.extractForwardHeaders(req.headers as Record<string, string>);
    const client = new LLMClient(config, customHeaders);

    const formattedMessages: Message[] = [];
    if (system_prompt) {
      formattedMessages.push({ role: 'system', content: system_prompt });
    }
    formattedMessages.push(...messages);

    const response = await client.invoke(formattedMessages, {
      model: model || 'doubao-seed-2-0-pro-260215',
      temperature: 0.7,
    });

    // Save to database
    if (conversation_id && response.content) {
      const supabase = getSupabaseClient();
      const lastUserMsg = messages.filter((m: Message) => m.role === 'user').pop();
      if (lastUserMsg) {
        await supabase.from('messages').insert({
          conversation_id,
          role: 'user',
          content: lastUserMsg.content,
        });
      }
      await supabase.from('messages').insert({
        conversation_id,
        role: 'assistant',
        content: response.content,
      });
      await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversation_id);
    }

    res.json({ content: response.content });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Chat failed' });
  }
});

// 将对话内容保存到知识库
router.post('/save-to-knowledge', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const user_id = req.userId;
    const { knowledge_base_id, knowledge_base_name, question, answer, message_id } = req.body;
    const supabase = getSupabaseClient();

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
      baseId = uuidv4();
      const { error: kbError } = await supabase
        .from('knowledge_bases')
        .insert({
          id: baseId,
          user_id,
          name: knowledge_base_name,
          description: '从对话创建的知识库',
        });
      if (kbError) throw kbError;
    } else {
      // 验证知识库归属
      const { data: kb } = await supabase
        .from('knowledge_bases')
        .select('id')
        .eq('id', baseId)
        .eq('user_id', user_id)
        .single();
      if (!kb) {
        res.status(403).json({ error: 'Knowledge base not found or access denied' });
        return;
      }
    }

    // 构造文档内容
    const docTitle = question?.slice(0, 100) || '对话片段';
    const docContent = `Q: ${question || ''}\n\nA: ${answer || ''}`;
    const docId = uuidv4();

    // 创建文档记录
    const { error: docError } = await supabase.from('documents').insert({
      id: docId,
      knowledge_base_id: baseId,
      filename: `${docTitle}.txt`,
      content_preview: docContent.slice(0, 200),
      chunk_count: 1,
      status: 'processing',
    });
    if (docError) throw docError;

    // 异步向量化
    (async () => {
      try {
        const chunks = splitTextIntoChunks(docContent, 500, 50);
        const embeddingClient = new EmbeddingClient({
          customHeaders: HeaderUtils.extractForwardHeaders(req.headers as Record<string, string>),
        } as any);

        for (let i = 0; i < chunks.length; i++) {
          try {
            const chunkId = uuidv4();
            const embedding = await embeddingClient.embedText(chunks[i]);
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
        console.error('Embedding error in save-to-knowledge:', err);
        await supabase.from('documents').update({ status: 'error' }).eq('id', docId);
      }
    })();

    res.json({
      success: true,
      knowledge_base_id: baseId,
      document_id: docId,
      message: 'Saving to knowledge base',
    });
  } catch (err: any) {
    console.error('Save to knowledge error:', err?.message || err);
    res.status(500).json({ error: 'Failed to save to knowledge base' });
  }
});

export default router;
