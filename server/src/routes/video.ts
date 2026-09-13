import { Router } from 'express';
import { VideoGenerationClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { getSupabaseClient } from '../storage/database/supabase-client.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { v4 as uuidv4 } from 'uuid';

const router: import("express").Router = Router();
const config = new Config();

interface VideoTask {
  id: string;
  user_id: string;
  prompt: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  video_url?: string;
  thumbnail_url?: string;
  model: string;
  duration: number;
  ratio: string;
  resolution: string;
  input_type: 'text' | 'image';
  image_url?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
}

// Get video generation tasks
router.get('/tasks', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('video_tasks')
      .select('*')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw error;
    res.json({ tasks: data || [] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get video tasks' });
  }
});

// Get single task
router.get('/tasks/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('video_tasks')
      .select('*')
      .eq('id', id)
      .eq('user_id', req.userId)
      .single();

    if (error) throw error;
    res.json({ task: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get video task' });
  }
});

// Text-to-video generation
router.post('/text-to-video', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { prompt, duration = 5, ratio = '16:9', resolution = '720p', model = 'doubao-seedance-2-0-260128' } = req.body;

    if (!prompt) {
      res.status(400).json({ error: 'Prompt is required' });
      return;
    }

    const taskId = uuidv4();
    const supabase = getSupabaseClient();

    // Create task record
    const { data: taskData, error: taskError } = await supabase
      .from('video_tasks')
      .insert({
        id: taskId,
        user_id: req.userId,
        prompt,
        status: 'queued',
        model,
        duration,
        ratio,
        resolution,
        input_type: 'text',
      })
      .select()
      .single();

    if (taskError) throw taskError;

    // Respond immediately with task ID
    res.json({ task_id: taskId, task: taskData });

    // Generate video in background
    generateVideoAsync(taskId, prompt, model, duration, ratio, resolution, 'text', undefined, req.headers as Record<string, string>);
  } catch (error) {
    console.error('Video generation error:', error);
    res.status(500).json({ error: 'Failed to start video generation' });
  }
});

// Image-to-video generation
router.post('/image-to-video', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { prompt, image_url, duration = 5, ratio = '16:9', resolution = '720p', model = 'doubao-seedance-2-0-260128' } = req.body;

    if (!image_url) {
      res.status(400).json({ error: 'Image URL is required' });
      return;
    }

    const taskId = uuidv4();
    const supabase = getSupabaseClient();

    // Create task record
    const { data: taskData, error: taskError } = await supabase
      .from('video_tasks')
      .insert({
        id: taskId,
        user_id: req.userId,
        prompt: prompt || '',
        status: 'queued',
        model,
        duration,
        ratio,
        resolution,
        input_type: 'image',
        image_url,
      })
      .select()
      .single();

    if (taskError) throw taskError;

    // Respond immediately with task ID
    res.json({ task_id: taskId, task: taskData });

    // Generate video in background
    generateVideoAsync(taskId, prompt || '', model, duration, ratio, resolution, 'image', image_url, req.headers as Record<string, string>);
  } catch (error) {
    console.error('Video generation error:', error);
    res.status(500).json({ error: 'Failed to start video generation' });
  }
});

// Background video generation
async function generateVideoAsync(
  taskId: string,
  prompt: string,
  model: string,
  duration: number,
  ratio: string,
  resolution: string,
  inputType: string,
  imageUrl: string | undefined,
  headers: Record<string, string>
): Promise<void> {
  const supabase = getSupabaseClient();

  try {
    // Update status to running
    await supabase
      .from('video_tasks')
      .update({ status: 'running', updated_at: new Date().toISOString() })
      .eq('id', taskId);

    const customHeaders = HeaderUtils.extractForwardHeaders(headers);
    const client = new VideoGenerationClient(config, customHeaders);

    let content: Array<Record<string, unknown>> = [];

    if (inputType === 'image' && imageUrl) {
      content = [
        {
          type: 'image_url',
          image_url: { url: imageUrl },
          role: 'first_frame',
        },
      ];
      if (prompt) {
        content.push({ type: 'text', text: prompt });
      }
    } else {
      content = [{ type: 'text', text: prompt }];
    }

    const response = await client.videoGeneration(content as any, {
      model,
      duration,
      ratio: ratio as any,
      resolution: resolution as any,
      maxWaitTime: 600,
    });

    if (response.videoUrl) {
      await supabase
        .from('video_tasks')
        .update({
          status: 'succeeded',
          video_url: response.videoUrl,
          thumbnail_url: response.lastFrameUrl,
          updated_at: new Date().toISOString(),
        })
        .eq('id', taskId);
    } else {
      await supabase
        .from('video_tasks')
        .update({
          status: 'failed',
          error_message: response.response?.error_message || 'Generation failed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', taskId);
    }
  } catch (error) {
    console.error('Video generation background error:', error);
    await supabase
      .from('video_tasks')
      .update({
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Unknown error',
        updated_at: new Date().toISOString(),
      })
      .eq('id', taskId);
  }
}

// Delete video task
router.delete('/tasks/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from('video_tasks')
      .delete()
      .eq('id', id)
      .eq('user_id', req.userId);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete video task' });
  }
});

export default router;
