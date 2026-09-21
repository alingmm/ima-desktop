import { Request, Response, Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router: import('express').Router = Router();

// Default Ollama base URL
const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';

function getOllamaUrl(req: AuthRequest): string {
  const fromHeader = (req.headers['x-ollama-url'] as string)?.trim();
  if (fromHeader) return fromHeader;
  return process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL;
}

// Check if Ollama is reachable
router.get('/health', authMiddleware, async (req: AuthRequest, res) => {
  const ollamaUrl = getOllamaUrl(req);
  try {
    const response = await fetch(`${ollamaUrl}/api/tags`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      res.status(502).json({ available: false, error: `Ollama returned ${response.status}`, url: ollamaUrl });
      return;
    }

    const data = await response.json();
    res.json({
      available: true,
      url: ollamaUrl,
      modelCount: data.models?.length || 0,
    });
  } catch (error: any) {
    res.status(502).json({
      available: false,
      error: error.message || 'Failed to connect to Ollama',
      url: ollamaUrl,
      hint: '请确保已安装并启动 Ollama (默认地址 http://127.0.0.1:11434)',
    });
  }
});

// Get local models from Ollama
router.get('/models', authMiddleware, async (req: AuthRequest, res) => {
  const ollamaUrl = getOllamaUrl(req);
  try {
    const response = await fetch(`${ollamaUrl}/api/tags`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      res.status(response.status).json({ error: `Failed to get models: ${response.statusText}` });
      return;
    }

    const data = await response.json();
    const models = (data.models || []).map((m: any) => ({
      id: m.name,
      name: m.name,
      provider: 'ollama',
      size: m.size,
      digest: m.digest,
      modified_at: m.modified_at,
      details: m.details,
    }));

    res.json({ models });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to list models' });
  }
});

// Pull a model from Ollama library
router.post('/pull', authMiddleware, async (req: AuthRequest, res) => {
  const { name } = req.body;
  const ollamaUrl = getOllamaUrl(req);

  if (!name) {
    res.status(400).json({ error: 'Model name is required' });
    return;
  }

  try {
    const response = await fetch(`${ollamaUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, stream: false }),
    });

    if (!response.ok) {
      res.status(response.status).json({ error: `Pull failed: ${response.statusText}` });
      return;
    }

    const data = await response.json();
    res.json({ status: data.status, model: name });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to pull model' });
  }
});

// Streaming chat with local model
router.post('/stream', authMiddleware, async (req: AuthRequest, res) => {
  const ollamaUrl = getOllamaUrl(req);
  const { messages, model, system_prompt, temperature } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: 'Messages array is required' });
    return;
  }

  if (!model) {
    res.status(400).json({ error: 'Model name is required' });
    return;
  }

  const formattedMessages: { role: string; content: string }[] = [];
  if (system_prompt) {
    formattedMessages.push({ role: 'system', content: system_prompt });
  }
  formattedMessages.push(...messages);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    const response = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: formattedMessages,
        stream: true,
        options: temperature !== undefined ? { temperature } : undefined,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      res.status(response.status);
      res.write(`data: ${JSON.stringify({ error: `Ollama error: ${response.statusText}`, detail: errorText })}\n\n`);
      res.end();
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      res.status(500).json({ error: 'No response body' });
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const data = JSON.parse(trimmed);
          const text = data.message?.content || '';
          if (text) {
            res.write(`data: ${JSON.stringify({ content: text, done: false })}\n\n`);
          }
          if (data.done) {
            res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
          }
        } catch {
          // skip invalid JSON lines
        }
      }
    }

    res.end();
  } catch (error: any) {
    console.error('Local model stream error:', error);
    res.write(`data: ${JSON.stringify({ error: error.message || 'Stream error' })}\n\n`);
    res.end();
  }
});

export default router;
