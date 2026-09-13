import { Router } from 'express';
import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { getSupabaseClient } from '../storage/database/supabase-client.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { v4 as uuidv4 } from 'uuid';

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

export default router;
