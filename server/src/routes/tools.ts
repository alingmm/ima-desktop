import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { findById, updateById, ToolActionType, ToolPolicyLevel } from '../storage/json-storage';
import {
  getAllPolicies,
  savePolicyLevel,
  listPendingApprovals,
  listExecutionLogs,
  requestToolExecution,
  resolveApproval,
  stripApprovalForClient,
  assessCommandRisk,
  assessOpenTargetRisk,
} from '../services/tools';
import { runProject } from '../tasks/scheduler';

const router: import('express').Router = Router();

const ACTION_TYPES: ToolActionType[] = ['open_app', 'run_command'];
const LEVELS: ToolPolicyLevel[] = ['auto', 'confirm', 'deny'];

// GET /api/tools/policy — 当前权限分级
router.get('/policy', (req: AuthRequest, res: Response) => {
  res.json(getAllPolicies(req.userId!));
});

// POST /api/tools/policy — 保存分级 { policies: { open_app?, run_command? } }
router.post('/policy', (req: AuthRequest, res: Response) => {
  const policies = req.body?.policies || {};
  for (const actionType of ACTION_TYPES) {
    const level = policies[actionType];
    if (level === undefined) continue;
    if (!LEVELS.includes(level)) {
      res.status(400).json({ error: 'INVALID_LEVEL', message: '权限等级只能是 auto / confirm / deny' });
      return;
    }
    savePolicyLevel(req.userId!, actionType, level);
  }
  res.json({ success: true, policies: getAllPolicies(req.userId!) });
});

// GET /api/tools/pending — 待确认列表（供前端弹窗轮询）
router.get('/pending', (req: AuthRequest, res: Response) => {
  const list = listPendingApprovals(req.userId!).map(stripApprovalForClient);
  res.json({ pending: list });
});

// GET /api/tools/logs — 最近执行日志（只读）
router.get('/logs', (req: AuthRequest, res: Response) => {
  const limit = Number(req.query.limit) || 50;
  res.json({ logs: listExecutionLogs(req.userId!, limit) });
});

// POST /api/tools/run — 手动提交一次工具调用 { action_type, target }
router.post('/run', async (req: AuthRequest, res: Response) => {
  const { action_type, target } = req.body || {};
  if (!ACTION_TYPES.includes(action_type)) {
    res.status(400).json({ error: 'INVALID_ACTION', message: '不支持的操作类型' });
    return;
  }
  if (!String(target || '').trim()) {
    res.status(400).json({ error: 'MISSING_TARGET', message: '请提供要执行的内容' });
    return;
  }

  const outcome = await requestToolExecution(req.userId!, action_type, String(target), {
    source: 'manual',
  });

  if (outcome.outcome === 'executed') {
    res.json({ status: 'executed', ok: outcome.ok, output: outcome.output, duration_ms: outcome.durationMs });
    return;
  }
  if (outcome.outcome === 'pending') {
    res.json({ status: 'pending', pending: stripApprovalForClient(outcome.approval) });
    return;
  }
  res.status(403).json({ status: 'denied', message: outcome.message });
});

// POST /api/tools/confirm — 批准/拒绝 { pending_id, approve, note? }
router.post('/confirm', async (req: AuthRequest, res: Response) => {
  const { pending_id, approve, note } = req.body || {};
  if (!pending_id) {
    res.status(400).json({ error: 'MISSING_ID', message: '缺少 pending_id' });
    return;
  }
  const result = await resolveApproval(req.userId!, String(pending_id), approve === true, note);
  if (result.error) {
    res.status(400).json({ error: 'RESOLVE_FAILED', message: result.error });
    return;
  }

  // agent 来源且批准：异步触发断点续跑（不阻塞当前响应）
  let resumed = false;
  const approval = result.approval;
  if (approve === true && approval && approval.source === 'agent' && approval.project_id && approval.run_id) {
    const run = findById('tracking_runs', approval.run_id);
    if (run && run.status === 'paused' && run.goal_state) {
      const actionLabel = approval.action_type === 'open_app' ? '打开应用/链接' : '执行命令';
      const guidance =
        `用户已批准${actionLabel}「${approval.action_detail}」` +
        (note ? `，附言：${note}` : '') +
        '。请继续执行（该操作已获准，重新调用即可直接执行）。';
      resumed = true;
      runProject(approval.project_id, 'manual', {
        resumeState: run.goal_state,
        userGuidance: guidance,
      }).catch((e) => console.error('[tools] 批准后自动续跑失败:', e));
      // 老 paused 记录标记：已被新续跑接管
      updateById('tracking_runs', run.id, { awaiting_confirm: false });
    }
  }

  res.json({
    success: true,
    status: result.approval?.status,
    resumed,
    ...(result.executed ? { executed: result.executed } : {}),
  });
});

// POST /api/tools/assess — 预评估分级与风险（供前端提示用，不执行）
router.post('/assess', (req: AuthRequest, res: Response) => {
  const { action_type, target } = req.body || {};
  if (!ACTION_TYPES.includes(action_type)) {
    res.status(400).json({ error: 'INVALID_ACTION', message: '不支持的操作类型' });
    return;
  }
  const risk =
    action_type === 'run_command'
      ? assessCommandRisk(String(target || ''))
      : assessOpenTargetRisk(String(target || ''));
  const policies = getAllPolicies(req.userId!);
  res.json({ risk, level: policies[action_type as ToolActionType] });
});

export default router;
