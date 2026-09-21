import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import {
  findById, updateById, selectWhere, findOne, insertOne,
  UserRecord, UserSettingRecord,
  ConversationRecord, KnowledgeBaseRecord, VideoTaskRecord, DocumentRecord,
} from '../storage/json-storage';

const router: import('express').Router = Router();

// Get user profile
router.get('/profile', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const user = findById('users', req.userId!);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({ user });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get profile', message: error.message });
  }
});

// Update user profile
router.put('/profile', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { name, avatar_url } = req.body;

    const updates: Partial<UserRecord> = {};
    if (name !== undefined) updates.name = name;
    if (avatar_url !== undefined) updates.avatar_url = avatar_url;

    const updated = updateById('users', req.userId!, updates);
    res.json({ user: updated });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update profile', message: error.message });
  }
});

// Get user stats
router.get('/stats', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const conversationCount = selectWhere('conversations', { user_id: req.userId } as Partial<ConversationRecord>).length;
    const kbCount = selectWhere('knowledge_bases', { user_id: req.userId } as Partial<KnowledgeBaseRecord>).length;
    const videoCount = selectWhere('video_tasks', { user_id: req.userId } as Partial<VideoTaskRecord>).length;
    const docCount = selectWhere('documents', { user_id: req.userId } as Partial<DocumentRecord>).length;

    res.json({
      stats: {
        conversations: conversationCount,
        knowledge_bases: kbCount,
        video_tasks: videoCount,
        documents: docCount,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get user stats', message: error.message });
  }
});

// Get user settings
router.get('/settings', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const settings = findOne('user_settings', { user_id: req.userId } as Partial<UserSettingRecord>);

    if (!settings) {
      // Return default settings
      res.json({
        settings: {
          user_id: req.userId,
          default_model: 'gpt-4o-mini',
          theme: 'dark',
          language: 'zh-CN',
          stream_output: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      });
      return;
    }

    res.json({ settings });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get settings', message: error.message });
  }
});

// Update user settings
router.put('/settings', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { default_model, theme, language, stream_output } = req.body;

    const existing = findOne('user_settings', { user_id: req.userId } as Partial<UserSettingRecord>);
    const now = new Date().toISOString();

    if (existing) {
      const updates: Partial<UserSettingRecord> = { updated_at: now };
      if (default_model !== undefined) updates.default_model = default_model;
      if (theme !== undefined) updates.theme = theme;
      if (language !== undefined) updates.language = language;
      if (stream_output !== undefined) updates.stream_output = stream_output;

      const updated = updateById('user_settings', existing.id, updates);
      res.json({ settings: updated });
    } else {
      const settings = insertOne('user_settings', {
        id: `settings-${req.userId}`,
        user_id: req.userId!,
        default_model: default_model || 'gpt-4o-mini',
        theme: theme || 'dark',
        language: language || 'zh-CN',
        stream_output: stream_output !== undefined ? stream_output : true,
        created_at: now,
        updated_at: now,
      } as UserSettingRecord);
      res.json({ settings });
    }
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update settings', message: error.message });
  }
});

export default router;
