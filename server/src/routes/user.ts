import { Router } from 'express';
import { getSupabaseClient } from '../storage/database/supabase-client.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router: import("express").Router = Router();

// Get user profile
router.get('/profile', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', req.userId)
      .single();

    if (error) {
      // Return default user if not found
      res.json({
        user: {
          id: req.userId,
          email: req.userEmail,
          name: 'User',
          avatar_url: null,
          created_at: new Date().toISOString(),
        },
      });
      return;
    }

    res.json({ user: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get user profile' });
  }
});

// Update user profile
router.put('/profile', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { name, avatar_url } = req.body;
    const supabase = getSupabaseClient();

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (avatar_url !== undefined) updates.avatar_url = avatar_url;

    const { data, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', req.userId)
      .select()
      .single();

    if (error) throw error;
    res.json({ user: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Get user stats
router.get('/stats', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const supabase = getSupabaseClient();

    // Count conversations
    const { count: conversationCount, error: convError } = await supabase
      .from('conversations')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', req.userId);

    // Count knowledge bases
    const { count: kbCount, error: kbError } = await supabase
      .from('knowledge_bases')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', req.userId);

    // Count video tasks
    const { count: videoCount, error: videoError } = await supabase
      .from('video_tasks')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', req.userId);

    // Count documents
    const { count: docCount, error: docError } = await supabase
      .from('documents')
      .select('*', { count: 'exact', head: true });

    res.json({
      stats: {
        conversations: conversationCount || 0,
        knowledge_bases: kbCount || 0,
        video_tasks: videoCount || 0,
        documents: docCount || 0,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get user stats' });
  }
});

// Get user settings
router.get('/settings', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', req.userId)
      .single();

    if (error || !data) {
      // Return default settings
      res.json({
        settings: {
          default_model: 'doubao-seed-2-0-pro-260215',
          theme: 'dark',
          language: 'zh-CN',
          stream_output: true,
        },
      });
      return;
    }

    res.json({ settings: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

// Update user settings
router.put('/settings', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { default_model, theme, language, stream_output } = req.body;
    const supabase = getSupabaseClient();

    const updates: Record<string, unknown> = {};
    if (default_model !== undefined) updates.default_model = default_model;
    if (theme !== undefined) updates.theme = theme;
    if (language !== undefined) updates.language = language;
    if (stream_output !== undefined) updates.stream_output = stream_output;

    // Try update, if not exists insert
    const { data, error } = await supabase
      .from('user_settings')
      .upsert(
        { user_id: req.userId, ...updates },
        { onConflict: 'user_id' }
      )
      .select()
      .single();

    if (error) throw error;
    res.json({ settings: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

export default router;
