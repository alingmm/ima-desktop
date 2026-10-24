import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import {
  selectAll, insertOne, updateOne, deleteWhere, orderBy,
  MemoryRecord, MemoryCategory,
} from '../storage/json-storage';
import { extractMemoryFromConversation } from '../services/memory';

const router: import('express').Router = Router();

const VALID_CATEGORIES: MemoryCategory[] = ['偏好', '事实', '结论', '任务'];

// 获取记忆列表（支持关键词筛选 ?q=）
router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { q } = req.query;
    let memories = selectAll('memories').filter(
      (m) => m.user_id === req.userId,
    );

    if (q && typeof q === 'string') {
      const ql = q.toLowerCase();
      memories = memories.filter(
        (m) =>
          m.content?.toLowerCase().includes(ql) ||
          (m.tags || []).some((t) => t.toLowerCase().includes(ql)),
      );
    }

    const sorted = orderBy(memories, 'created_at', 'desc');
    res.json({ memories: sorted });
  } catch (err: any) {
    console.error('Get memories error:', err);
    res.status(500).json({ error: '获取记忆失败', message: err.message });
  }
});

// 手动添加记忆
router.post('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { content, category = '事实', tags } = req.body;
    if (!content || typeof content !== 'string' || !content.trim()) {
      res.status(400).json({ error: '记忆内容不能为空', message: '请输入记忆内容' });
      return;
    }
    const cat: MemoryCategory = VALID_CATEGORIES.includes(category)
      ? category
      : '事实';
    const tagArr: string[] = Array.isArray(tags)
      ? tags.filter((t: unknown) => typeof t === 'string').slice(0, 10)
      : [];

    const now = new Date().toISOString();
    const memory = insertOne('memories', {
      id: uuidv4(),
      user_id: req.userId!,
      content: content.trim(),
      category: cat,
      tags: tagArr.length ? tagArr : [cat],
      source: 'manual',
      created_at: now,
      updated_at: now,
    });
    res.status(201).json({ memory });
  } catch (err: any) {
    console.error('Create memory error:', err);
    res.status(500).json({ error: '创建记忆失败', message: err.message });
  }
});

// 编辑记忆
router.put('/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const mem = selectAll('memories').find(
      (m) => m.id === req.params.id && m.user_id === req.userId,
    ) as MemoryRecord | undefined;
    if (!mem) {
      res.status(404).json({ error: '记忆不存在' });
      return;
    }

    const { content, category, tags } = req.body;
    if (content !== undefined && (typeof content !== 'string' || !content.trim())) {
      res.status(400).json({ error: '记忆内容不能为空', message: '请输入记忆内容' });
      return;
    }

    const patch: Partial<MemoryRecord> = { updated_at: new Date().toISOString() };
    if (typeof content === 'string') patch.content = content.trim();
    if (VALID_CATEGORIES.includes(category)) patch.category = category;
    if (Array.isArray(tags)) {
      patch.tags = tags.filter((t: unknown) => typeof t === 'string').slice(0, 10);
    }

    updateOne('memories', { id: req.params.id } as Partial<MemoryRecord>, patch);
    const updated = selectAll('memories').find((m) => m.id === req.params.id);
    res.json({ memory: updated });
  } catch (err: any) {
    console.error('Update memory error:', err);
    res.status(500).json({ error: '更新记忆失败', message: err.message });
  }
});

// 从一段对话一键提炼为记忆（「记住这条」按钮）
router.post('/extract-from-chat', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { user_text, assistant_text } = req.body;
    if (!user_text || !assistant_text) {
      res.status(400).json({ error: '缺少对话内容', message: '没有可提炼的对话内容' });
      return;
    }
    const result = await extractMemoryFromConversation(
      req.userId!,
      String(user_text),
      String(assistant_text),
      'chat',
    );
    res.json({
      saved: result.reason === 'saved',
      reason: result.reason,
      memory: result.memory,
    });
  } catch (err: any) {
    console.error('Extract-from-chat error:', err);
    res.status(500).json({ error: '提炼记忆失败', message: err.message });
  }
});

// 删除记忆
router.delete('/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const mem = selectAll('memories').find(
      (m) => m.id === req.params.id && m.user_id === req.userId,
    ) as MemoryRecord | undefined;
    if (!mem) {
      res.status(404).json({ error: '记忆不存在' });
      return;
    }
    deleteWhere('memories', { id: req.params.id });
    res.json({ success: true });
  } catch (err: any) {
    console.error('Delete memory error:', err);
    res.status(500).json({ error: '删除记忆失败', message: err.message });
  }
});

export default router;