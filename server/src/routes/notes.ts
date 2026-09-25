import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import {
  selectWhere, insertOne, findById, updateById, deleteWhere, orderBy,
  NoteRecord, DocumentRecord, DocumentChunkRecord,
} from '../storage/json-storage';

const router: import('express').Router = Router();

// 获取笔记列表（支持搜索和标签过滤）
router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { search, tag, sort_by = 'updated_at', order = 'desc' } = req.query;
    let notes = selectWhere('notes', { user_id: req.userId } as Partial<NoteRecord>);

    // 搜索过滤
    if (search && typeof search === 'string') {
      const searchLower = search.toLowerCase();
      notes = notes.filter(
        (note) =>
          note.title?.toLowerCase().includes(searchLower) ||
          note.content?.toLowerCase().includes(searchLower)
      );
    }

    // 标签过滤
    if (tag && typeof tag === 'string') {
      notes = notes.filter(
        (note) => note.tags && Array.isArray(note.tags) && note.tags.includes(tag)
      );
    }

    // 排序
    const sortField = sort_by === 'created_at' ? 'created_at' : 'updated_at';
    const sortOrder = order === 'asc' ? 'asc' : 'desc';
    notes = orderBy(notes, sortField, sortOrder);

    res.json({ notes });
  } catch (err: any) {
    console.error('Get notes error:', err);
    res.status(500).json({ error: 'Failed to get notes', message: err.message });
  }
});

// 获取所有标签
router.get('/tags', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const notes = selectWhere('notes', { user_id: req.userId } as Partial<NoteRecord>);
    const tagSet = new Set<string>();
    notes.forEach((note) => {
      if (note.tags && Array.isArray(note.tags)) {
        note.tags.forEach((tag: string) => tagSet.add(tag));
      }
    });

    res.json({ tags: Array.from(tagSet).sort() });
  } catch (err: any) {
    console.error('Get tags error:', err);
    res.status(500).json({ error: 'Failed to get tags', message: err.message });
  }
});

// 获取单条笔记
router.get('/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const note = findById('notes', id);

    if (!note) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }

    if (note.user_id !== req.userId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    res.json({ note });
  } catch (err: any) {
    console.error('Get note error:', err);
    res.status(500).json({ error: 'Failed to get note', message: err.message });
  }
});

// 创建笔记
router.post('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { title, content, tags, is_pinned } = req.body;
    const now = new Date().toISOString();

    const note = insertOne('notes', {
      id: uuidv4(),
      user_id: req.userId!,
      title: title || '无标题笔记',
      content: content || '',
      tags: tags || [],
      is_pinned: is_pinned || false,
      created_at: now,
      updated_at: now,
    } as NoteRecord);

    res.status(201).json({ note });
  } catch (err: any) {
    console.error('Create note error:', err);
    res.status(500).json({ error: 'Failed to create note', message: err.message });
  }
});

// 更新笔记
router.put('/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { title, content, tags, is_pinned } = req.body;

    const existing = findById('notes', id);
    if (!existing) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }
    if (existing.user_id !== req.userId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const updateData: Partial<NoteRecord> = { updated_at: new Date().toISOString() };
    if (title !== undefined) updateData.title = title;
    if (content !== undefined) updateData.content = content;
    if (tags !== undefined) updateData.tags = tags;
    if (is_pinned !== undefined) updateData.is_pinned = is_pinned;

    const updated = updateById('notes', id, updateData);
    res.json({ note: updated });
  } catch (err: any) {
    console.error('Update note error:', err);
    res.status(500).json({ error: 'Failed to update note', message: err.message });
  }
});

// 删除笔记
router.delete('/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const existing = findById('notes', id);
    if (!existing) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }
    if (existing.user_id !== req.userId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    deleteWhere('notes', { id });
    res.json({ success: true });
  } catch (err: any) {
    console.error('Delete note error:', err);
    res.status(500).json({ error: 'Failed to delete note', message: err.message });
  }
});

// 批量删除笔记
router.post('/batch-delete', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids)) {
      res.status(400).json({ error: 'ids must be an array' });
      return;
    }

    let deletedCount = 0;
    for (const id of ids) {
      const existing = findById('notes', id);
      if (existing && existing.user_id === req.userId) {
        deleteWhere('notes', { id });
        deletedCount++;
      }
    }

    res.json({ success: true, deleted_count: deletedCount });
  } catch (err: any) {
    console.error('Batch delete error:', err);
    res.status(500).json({ error: 'Failed to batch delete notes', message: err.message });
  }
});

// Create note from knowledge document
router.post('/from-document', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { document_id } = req.body;

    if (!document_id) {
      res.status(400).json({ error: 'document_id is required' });
      return;
    }

    const doc = findById('documents', document_id) as DocumentRecord | undefined;
    if (!doc || doc.user_id !== req.userId) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    // Concatenate all chunks to build the content
    const chunks = selectWhere(
      'document_chunks',
      { document_id } as Partial<DocumentChunkRecord>
    ).sort((a: any, b: any) => a.chunk_index - b.chunk_index);

    const content = chunks.map((c: DocumentChunkRecord) => c.content).join('\n\n');

    // Build title and content with source reference
    const title = doc.filename?.replace(/\.[^/.]+$/, '') || '从知识库导入的文档';
    const sourceNote = `\n\n---\n> 来源：知识库文档 - ${doc.filename}`;

    const note = insertOne('notes', {
      id: uuidv4(),
      user_id: req.userId,
      title,
      content: content + sourceNote,
      tags: ['知识库'],
      is_pinned: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as NoteRecord);

    res.status(201).json({ note });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to create note from document', message: err.message });
  }
});

export default router;
