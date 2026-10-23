import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { insertOne, NoteRecord } from '../storage/json-storage';
import { chatCompletion } from '../services/ai';
import { clampText } from '../utils/document';
import {
  captureWeb,
  captureVideo,
  CaptureError,
  normalizeUrl,
  detectPlatform,
} from '../utils/capture';

const router: Router = Router();
router.use(authMiddleware);

function handleCaptureError(e: any, res: Response) {
  if (e instanceof CaptureError) {
    res.status(e.status >= 400 && e.status < 600 ? e.status : 400).json({
      error: e.code,
      message: e.message,
    });
    return;
  }
  console.error('Capture error:', e?.message || e);
  res.status(500).json({
    error: 'CAPTURE_FAILED',
    message: '抓取失败了，请稍后重试或换一个链接',
  });
}

// 判断链接更像视频页还是普通网页
function looksLikeVideo(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase();
    if (/(bilibili\.com|b23\.tv|youtube\.com|youtu\.be|douyin\.com|kuaishou\.com|ixigua\.com|weibo\.(com|cn))/.test(host)) {
      return true;
    }
    if (/\/(watch|video|videos|shorts|play)\b/.test(path)) return true;
    return false;
  } catch {
    return false;
  }
}

// 抓取普通网页：POST /api/capture/web { url }
router.post('/web', async (req: AuthRequest, res: Response) => {
  const url = req.body?.url;
  try {
    const result = await captureWeb(url);
    res.json(result);
  } catch (e) {
    handleCaptureError(e, res);
  }
});

// 抓取视频元信息：POST /api/capture/video { url }
router.post('/video', async (req: AuthRequest, res: Response) => {
  const url = req.body?.url;
  try {
    const result = await captureVideo(url);
    res.json(result);
  } catch (e) {
    handleCaptureError(e, res);
  }
});

// 自动识别类型抓取：POST /api/capture/fetch { url }
router.post('/fetch', async (req: AuthRequest, res: Response) => {
  const raw = (req.body?.url || '').trim();
  try {
    const u = normalizeUrl(raw);
    const kind = looksLikeVideo(u.toString()) || detectPlatform(u.toString()).id !== 'unknown' ? 'video' : 'web';
    if (kind === 'video') {
      const r = await captureVideo(raw);
      res.json({ kind: 'video', ...r });
    } else {
      const r = await captureWeb(raw);
      res.json({ kind: 'web', ...r });
    }
  } catch (e) {
    handleCaptureError(e, res);
  }
});

interface OrganizeBody {
  kind?: 'web' | 'video';
  title?: string;
  content?: string;
  url?: string;
}

// 大模型一键整理：POST /api/capture/organize
// 网页：把正文整理成「摘要 + 要点 + 结构化大纲」
// 视频：基于已抓到的标题/简介做信息整理（不伪造字幕）
router.post('/organize', async (req: AuthRequest, res: Response) => {
  const { kind = 'web', title = '', content = '', url = '' } = (req.body || {}) as OrganizeBody;
  if (!content || !content.trim()) {
    res.status(400).json({
      error: 'EMPTY_CONTENT',
      message: '没有可整理的内容，请先成功抓取',
    });
    return;
  }

  // 控制送给模型的长度，避免超 token
  const { text: clipped } = clampText(content, 12000);

  const isVideo = kind === 'video';
  const system = isVideo
    ? '你是专业的视频内容整理助手。用户只能提供视频的标题、简介等公开信息（没有字幕）。' +
      '请严格基于这些信息整理，绝不编造视频里没有的情节、台词或数据。输出 Markdown，包含：' +
      '## 视频概览（一两句）、## 已知信息要点、## 可能关注的方向（基于简介合理推测并注明是推测）。'
    : '你是专业的网页内容整理助手。把抓取到的网页正文整理成结构清晰的中文 Markdown 文档，包含：' +
      '## 内容摘要（3-5 句）、## 核心要点（分条列出，保留关键数据）、## 结构梳理（用小标题/列表还原文章脉络）。' +
      '只依据原文，不要添加原文没有的事实。';

  const userContent = isVideo
    ? `视频链接：${url}\n标题：${title}\n以下是可获取的公开信息（简介/描述）：\n\n${clipped}`
    : `网页链接：${url}\n标题：${title}\n以下是网页正文：\n\n${clipped}`;

  try {
    const { content: organized } = await chatCompletion(
      [
        { role: 'system', content: system },
        { role: 'user', content: userContent },
      ],
      { temperature: 0.4 },
    );
    if (!organized || !organized.trim()) {
      res.status(502).json({
        error: 'EMPTY_AI_RESULT',
        message: '大模型没有返回整理结果，请稍后重试',
      });
      return;
    }
    res.json({ title, content: organized.trim(), kind });
  } catch (e: any) {
    console.error('Capture organize error:', e?.message);
    const code = e?.code || 'ORGANIZE_FAILED';
    const noKey = code === 'API_KEY_NOT_CONFIGURED';
    const message = noKey
      ? '还没有配置大模型 API Key，请到「设置」里填写后再使用大模型整理'
      : '大模型整理失败了，请确认设置里的模型可用后重试';
    res.status(noKey ? 400 : 502).json({ error: code, message });
  }
});

interface ToNoteBody {
  kind?: 'web' | 'video';
  title?: string;
  content?: string;
  url?: string;
  author?: string;
  organized?: boolean;
}

// 保存为笔记：POST /api/capture/to-note（复用 notes 表，不新建表）
router.post('/to-note', async (req: AuthRequest, res: Response) => {
  const {
    kind = 'web',
    title = '',
    content = '',
    url = '',
    author,
    organized = false,
  } = (req.body || {}) as ToNoteBody;

  if (!content || !content.trim()) {
    res.status(400).json({ error: 'EMPTY_CONTENT', message: '没有可保存的内容' });
    return;
  }

  // 网页原文不硬塞全文，限制长度并附来源
  const { text: clipped, truncated } = clampText(content, kind === 'video' ? 8000 : 30000);
  const sourceTag = kind === 'video' ? '视频抓取' : '网页抓取';
  const headerLines = [
    `> 来源：[${title || url}](${url})`,
    kind === 'video' && author ? `> 作者：${author}` : '',
    organized ? '> 已由大模型整理' : '',
  ].filter(Boolean);
  const body = `${headerLines.join('\n')}\n\n${clipped}`;

  const now = new Date().toISOString();
  try {
    const note = insertOne('notes', {
      id: uuidv4(),
      user_id: req.userId!,
      title: title || (kind === 'video' ? '抓取的视频' : '抓取的网页'),
      content: body,
      tags: [sourceTag],
      is_pinned: false,
      created_at: now,
      updated_at: now,
    } as NoteRecord);

    res.status(201).json({
      success: true,
      note,
      truncated,
      char_count: body.length,
    });
  } catch (e: any) {
    console.error('Capture to-note error:', e?.message);
    res.status(500).json({ error: 'SAVE_FAILED', message: '保存到笔记失败，请稍后重试' });
  }
});

export default router;
