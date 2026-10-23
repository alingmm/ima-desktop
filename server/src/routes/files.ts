import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { insertOne, NoteRecord } from '../storage/json-storage';
import { extractTextFromFile, clampText } from '../utils/document';
import { getUploadsDir, ensureDir } from '../config';

const router: import('express').Router = Router();

const uploadDir = getUploadsDir();
ensureDir(uploadDir);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

// 仅抽取文本（不落库）：用于对话附件解析、上传前预览
router.post('/extract', authMiddleware, upload.single('file'), async (req: AuthRequest, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: 'NO_FILE', message: '请先选择要上传的文件' });
    return;
  }
  const filePath = file.path;
  const fileName = file.originalname;
  try {
    const extracted = await extractTextFromFile(filePath, fileName);
    if (!extracted.supported || !extracted.content) {
      res.status(400).json({
        error: extracted.supported ? 'EMPTY_TEXT_CONTENT' : 'UNSUPPORTED_FILE_TYPE',
        message: extracted.unsupportedReason || '未能从文件中读取到文字内容',
      });
      return;
    }
    const { text, truncated } = clampText(extracted.content, 30000);
    res.json({
      filename: fileName,
      content: text,
      char_count: text.length,
      truncated: truncated || !!extracted.truncated,
    });
  } catch (error: any) {
    console.error('File extract error:', error?.message);
    res.status(500).json({
      error: 'EXTRACT_FAILED',
      message: '文件读取失败，请确认文件没有损坏后重试',
    });
  } finally {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // ignore
    }
  }
});

// 上传文档直接存为一条笔记
router.post('/to-note', authMiddleware, upload.single('file'), async (req: AuthRequest, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: 'NO_FILE', message: '请先选择要上传的文件' });
    return;
  }
  const filePath = file.path;
  const fileName = file.originalname;
  try {
    const extracted = await extractTextFromFile(filePath, fileName);
    if (!extracted.supported || !extracted.content) {
      res.status(400).json({
        error: extracted.supported ? 'EMPTY_TEXT_CONTENT' : 'UNSUPPORTED_FILE_TYPE',
        message: extracted.unsupportedReason || '未能从文件中读取到文字内容',
      });
      return;
    }
    const { text, truncated } = clampText(extracted.content, 100000);
    const baseName = path.basename(fileName, path.extname(fileName));
    const now = new Date().toISOString();
    const note = insertOne('notes', {
      id: uuidv4(),
      user_id: req.userId!,
      title: baseName || '外部文档',
      content: text,
      tags: ['外部文档'],
      is_pinned: false,
      created_at: now,
      updated_at: now,
    } as NoteRecord);

    res.status(201).json({
      success: true,
      note,
      char_count: text.length,
      truncated: truncated || !!extracted.truncated,
    });
  } catch (error: any) {
    console.error('File to-note error:', error?.message);
    res.status(500).json({
      error: 'TO_NOTE_FAILED',
      message: '保存到笔记失败，请稍后重试',
    });
  } finally {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // ignore
    }
  }
});

export default router;
