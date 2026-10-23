import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { getAgentPrivacy, saveAgentPrivacy } from '../services/agent-privacy';
import { checkOllamaHealth } from '../services/local-llm';

const router: import('express').Router = Router();

// 读取自主执行与隐私设置
router.get('/privacy', authMiddleware, (req: AuthRequest, res) => {
  try {
    const settings = getAgentPrivacy(req.userId!);
    res.json({ settings });
  } catch (error: any) {
    console.error('Get agent privacy settings error:', error);
    res.status(500).json({ error: '读取自主执行设置失败', message: error?.message });
  }
});

// 保存自主执行与隐私设置
router.put('/privacy', authMiddleware, (req: AuthRequest, res) => {
  try {
    const {
      allow_web_search,
      allow_web_capture,
      allow_external_tools,
      model_preference,
      local_model,
    } = req.body || {};

    const patch: Record<string, unknown> = {};
    if (typeof allow_web_search === 'boolean') patch.allow_web_search = allow_web_search;
    if (typeof allow_web_capture === 'boolean') patch.allow_web_capture = allow_web_capture;
    if (typeof allow_external_tools === 'boolean') patch.allow_external_tools = allow_external_tools;
    if (model_preference === 'default' || model_preference === 'local') {
      patch.model_preference = model_preference;
    }
    if (typeof local_model === 'string') patch.local_model = local_model.trim();

    const settings = saveAgentPrivacy(req.userId!, patch);
    res.json({ settings });
  } catch (error: any) {
    console.error('Save agent privacy settings error:', error);
    res.status(500).json({ error: '保存自主执行设置失败', message: error?.message });
  }
});

// 查询本地模型可用性与已安装模型（供设置页展示）
router.get('/local-models', authMiddleware, async (_req: AuthRequest, res) => {
  try {
    const health = await checkOllamaHealth();
    res.json({
      available: health.available,
      models: health.models,
      url: health.url,
      error: health.error,
    });
  } catch (error: any) {
    res.json({ available: false, models: [], error: error?.message || '本地模型检测失败' });
  }
});

export default router;
