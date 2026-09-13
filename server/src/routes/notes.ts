import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getSupabaseClient } from '../storage/database/supabase-client.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router: import("express").Router = Router();
router.use(authMiddleware);

// 获取笔记列表（支持搜索和标签过滤）
router.get('/', async (req: AuthRequest, res) => {
  try {
    const user_id = req.userId;
    const { search, tag, sort_by = 'updated_at', order = 'desc' } = req.query;
    const supabase = getSupabaseClient();

    let query = supabase.from('notes').select('*').eq('user_id', user_id);

    if (search) {
      query = query.or(`title.ilike.%${search}%,content.ilike.%${search}%`);
    }

    if (tag) {
      query = query.contains('tags', [tag]);
    }

    const { data, error } = await query
      .order(sort_by as string, { ascending: order === 'asc' })
      .order('is_pinned', { ascending: false });

    if (error) throw error;

    res.json({ notes: data || [] });
  } catch (err) {
    console.error('Get notes error:', err);
    res.status(500).json({ error: 'Failed to get notes' });
  }
});

// 获取所有标签
router.get('/tags', async (req: AuthRequest, res) => {
  try {
    const user_id = req.userId;
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('notes')
      .select('tags')
      .eq('user_id', user_id);

    if (error) throw error;

    const tagSet = new Set<string>();
    (data || []).forEach((note: any) => {
      (note.tags || []).forEach((tag: string) => tagSet.add(tag));
    });

    res.json({ tags: Array.from(tagSet).sort() });
  } catch (err) {
    console.error('Get tags error:', err);
    res.status(500).json({ error: 'Failed to get tags' });
  }
});

// 获取单条笔记
router.get('/:id', async (req: AuthRequest, res) => {
  try {
    const user_id = req.userId;
    const { id } = req.params;
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('notes')
      .select('*')
      .eq('id', id)
      .eq('user_id', user_id)
      .single();

    if (error) throw error;
    if (!data) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }

    res.json({ note: data });
  } catch (err) {
    console.error('Get note error:', err);
    res.status(500).json({ error: 'Failed to get note' });
  }
});

// 创建笔记
router.post('/', async (req: AuthRequest, res) => {
  try {
    const user_id = req.userId;
    const { title, content, tags, is_pinned } = req.body;
    const supabase = getSupabaseClient();

    const id = uuidv4();
    const { data, error } = await supabase
      .from('notes')
      .insert({
        id,
        user_id,
        title: title || '无标题笔记',
        content: content || '',
        tags: tags || [],
        is_pinned: is_pinned || false,
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ note: data });
  } catch (err) {
    console.error('Create note error:', err);
    res.status(500).json({ error: 'Failed to create note' });
  }
});

// 更新笔记
router.put('/:id', async (req: AuthRequest, res) => {
  try {
    const user_id = req.userId;
    const { id } = req.params;
    const { title, content, tags, is_pinned } = req.body;
    const supabase = getSupabaseClient();

    const updateData: any = { updated_at: new Date().toISOString() };
    if (title !== undefined) updateData.title = title;
    if (content !== undefined) updateData.content = content;
    if (tags !== undefined) updateData.tags = tags;
    if (is_pinned !== undefined) updateData.is_pinned = is_pinned;

    const { data, error } = await supabase
      .from('notes')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', user_id)
      .select()
      .single();

    if (error) throw error;

    res.json({ note: data });
  } catch (err) {
    console.error('Update note error:', err);
    res.status(500).json({ error: 'Failed to update note' });
  }
});

// 删除笔记
router.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const user_id = req.userId;
    const { id } = req.params;
    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from('notes')
      .delete()
      .eq('id', id)
      .eq('user_id', user_id);

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.error('Delete note error:', err);
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

// 批量删除
router.post('/batch-delete', async (req: AuthRequest, res) => {
  try {
    const user_id = req.userId;
    const { ids } = req.body;
    const supabase = getSupabaseClient();

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'No ids provided' });
      return;
    }

    const { error } = await supabase
      .from('notes')
      .delete()
      .in('id', ids)
      .eq('user_id', user_id);

    if (error) throw error;

    res.json({ success: true, deleted_count: ids.length });
  } catch (err) {
    console.error('Batch delete notes error:', err);
    res.status(500).json({ error: 'Failed to delete notes' });
  }
});

export default router;
