import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import {
  selectWhere, insertOne, findById, updateById, deleteWhere, orderBy,
  VideoTaskRecord,
} from '../storage/json-storage';

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

export default router;
