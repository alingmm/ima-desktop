import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import {
  selectWhere, insertOne, findById, updateById, deleteWhere, orderBy,
  VideoTaskRecord,
} from '../storage/json-storage';
import { streamChatCompletion, chatCompletion } from '../services/ai';

const router: import('express').Router = Router();

// Video service error codes
const VIDEO_ERRORS = {
  VIDEO_NOT_CONFIGURED: 'VIDEO_NOT_CONFIGURED',
};

// Get task list
router.get('/tasks', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const tasks = selectWhere('video_tasks', { user_id: req.userId } as Partial<VideoTaskRecord>);
    const sorted = orderBy(tasks, 'created_at', 'desc');
    res.json({ tasks: sorted });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get video tasks', message: error.message });
  }
});

// Get task detail
router.get('/tasks/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const task = findById('video_tasks', id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    if (task.user_id !== req.userId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    res.json({ task });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get task detail', message: error.message });
  }
});

// Text-to-video generation — placeholder returns configuration prompt
router.post('/text-to-video', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { prompt, duration = 5, ratio = '16:9', resolution = '720p', model = 'seedance' } = req.body;

    if (!prompt) {
      res.status(400).json({ error: 'Prompt is required' });
      return;
    }

    const taskId = uuidv4();

    // Create task record with failed status (not configured)
    const task = insertOne('video_tasks', {
      id: taskId,
      user_id: req.userId!,
      prompt,
      status: 'failed',
      model,
      duration,
      ratio,
      resolution,
      input_type: 'text',
      error_message: '视频生成服务暂未配置',
      error_code: VIDEO_ERRORS.VIDEO_NOT_CONFIGURED,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as VideoTaskRecord);

    res.status(400).json({
      error: VIDEO_ERRORS.VIDEO_NOT_CONFIGURED,
      message: '视频生成服务暂未配置。当前版本视频生成功能需要后端视频生成 API Key 支持，请关注后续更新。',
      task_id: taskId,
      task,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to start video generation', message: error.message });
  }
});

// Image-to-video generation — same placeholder
router.post('/image-to-video', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { prompt, image_url, duration = 5, ratio = '16:9', resolution = '720p', model = 'seedance' } = req.body;

    if (!image_url) {
      res.status(400).json({ error: 'Image URL is required' });
      return;
    }

    const taskId = uuidv4();

    const task = insertOne('video_tasks', {
      id: taskId,
      user_id: req.userId!,
      prompt: prompt || '',
      status: 'failed',
      model,
      duration,
      ratio,
      resolution,
      input_type: 'image',
      image_url,
      error_message: '视频生成服务暂未配置',
      error_code: VIDEO_ERRORS.VIDEO_NOT_CONFIGURED,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as VideoTaskRecord);

    res.status(400).json({
      error: VIDEO_ERRORS.VIDEO_NOT_CONFIGURED,
      message: '视频生成服务暂未配置。当前版本视频生成功能需要后端视频生成 API Key 支持，请关注后续更新。',
      task_id: taskId,
      task,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to start video generation', message: error.message });
  }
});

// Delete task
router.delete('/tasks/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const task = findById('video_tasks', id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    if (task.user_id !== req.userId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    deleteWhere('video_tasks', { id });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete task', message: error.message });
  }
});

// ============= 视频创作助手 =============

const CREATION_TYPES = {
  script: 'script',
  storyboard: 'storyboard',
  copy: 'copy',
  plan: 'plan',
} as const;

const SYSTEM_PROMPTS: Record<string, string> = {
  script: `你是一位资深视频脚本创作专家。请根据用户提供的主题/创意，生成一份结构清晰的视频脚本。
要求：
1. 格式为 Markdown，使用层级标题
2. 包含以下模块：
   - 🎯 主题定位
   - 🎬 开场白（0-5秒，吸引注意力）
   - 📝 正文内容（分点叙述，每个点说明讲什么）
   - 🔚 结尾引导（行动号召/互动引导）
   - 💬 完整台词（适合口播的全文）
3. 语言生动有感染力，适合短视频
4. 控制在 3-5 分钟视频长度`,

  storyboard: `你是一位专业的分镜师。请根据用户提供的视频主题/创意，生成一份详细的分镜脚本。
要求：
1. 使用 Markdown 表格或编号列表格式
2. 每个镜头包含：
   - 镜头编号
   - 场景（室内/室外/具体地点）
   - 景别（全景/中景/近景/特写等）
   - 画面描述（具体看到什么）
   - 台词/旁白
   - 时长（秒）
   - 运镜方式（推/拉/摇/移/固定等）
   - 音效/音乐提示
3. 至少 8-15 个镜头，覆盖完整视频
4. 适合 1-3 分钟短视频`,

  copy: `你是一位文案创作高手。请根据用户提供的视频主题，创作适用于视频的文案。
要求：
输出包含以下部分（Markdown 格式）：
1. 🎤 口播文案（第一人称，自然口语化，适合对着镜头说）
2. 📱 字幕文案（简洁版，配画面的文字提示）
3. 📝 标题文案（3 个备选，吸引人点击）
4. 💡 金句（2-3 句可以做封面或转场的精彩句子）
5. 🏷️ 话题标签（适合抖音/B站/视频号的标签）

注意：语言要有节奏感，适合短视频节奏，开头3秒必须抓人。`,

  plan: `你是一位视频内容策划总监。请根据用户的创意主题，生成一份完整的视频创作策划方案。
要求：
使用 Markdown 格式，包含以下完整模块：
1. 🎯 主题定位
   - 核心话题
   - 视频类型
   - 目标受众画像
   - 预期时长

2. 📜 视频脚本
   - 开场白
   - 正文结构
   - 结尾引导
   - 完整台词

3. 🎬 分镜脚本
   - 至少 10 个关键镜头
   - 每个镜头含场景/景别/画面/台词/时长/运镜

4. 🎨 制作建议
   - 拍摄场地
   - 服装道具
   - 画面风格
   - 背景音乐风格

5. 📱 发布建议
   - 平台选择及适配
   - 标题与封面
   - 发布时间
   - 互动引导话术

请确保方案完整、可直接落地执行。`,
};

// Video creation assistant (streaming)
router.post('/assist/stream', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { topic, type = 'script' } = req.body;

    if (!topic || !topic.trim()) {
      res.status(400).json({ error: 'Topic is required', message: '请输入视频主题或创意' });
      return;
    }

    const validTypes = Object.values(CREATION_TYPES);
    if (!validTypes.includes(type as any)) {
      res.status(400).json({ error: 'Invalid type', message: `创作类型必须是以下之一：${validTypes.join(' / ')}` });
      return;
    }

    const systemPrompt = SYSTEM_PROMPTS[type] || SYSTEM_PROMPTS.script;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let fullContent = '';

    await streamChatCompletion(
      [{ role: 'system', content: systemPrompt }, { role: 'user', content: topic }],
      {
        onContent: (chunk) => {
          fullContent += chunk;
          res.write(`data: ${JSON.stringify({ content: chunk, full_content: fullContent })}\n\n`);
        },
        onDone: () => {
          res.write(`data: ${JSON.stringify({ done: true, full_content: fullContent, type })}\n\n`);
          res.end();
        },
        onError: (err) => {
          const code = (err as any).code || 'CHAT_ERROR';
          res.write(`data: ${JSON.stringify({ error: code, message: err.message })}\n\n`);
          res.end();
        },
      },
      { temperature: 0.8 }
    );
  } catch (error: any) {
    const code = error.code || 'CHAT_ERROR';
    if (!res.headersSent) {
      res.status(400).json({ error: code, message: error.message });
    } else {
      res.write(`data: ${JSON.stringify({ error: code, message: error.message })}\n\n`);
      res.end();
    }
  }
});

// Non-streaming version (for quick calls)
router.post('/assist', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { topic, type = 'script' } = req.body;

    if (!topic || !topic.trim()) {
      res.status(400).json({ error: 'Topic is required', message: '请输入视频主题或创意' });
      return;
    }

    const validTypes = Object.values(CREATION_TYPES);
    if (!validTypes.includes(type as any)) {
      res.status(400).json({ error: 'Invalid type', message: `创作类型必须是以下之一：${validTypes.join(' / ')}` });
      return;
    }

    const systemPrompt = SYSTEM_PROMPTS[type] || SYSTEM_PROMPTS.script;
    const result = await chatCompletion(
      [{ role: 'system', content: systemPrompt }, { role: 'user', content: topic }],
      { temperature: 0.8 }
    );

    res.json({ content: result, type });
  } catch (error: any) {
    const code = error.code || 'CHAT_ERROR';
    res.status(400).json({ error: code, message: error.message });
  }
});

export default router;
