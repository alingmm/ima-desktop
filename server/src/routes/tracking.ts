import { Router, Request, Response } from 'express';
import {
  selectWhere,
  findById,
  insertOne,
  updateById,
  deleteWhere,
  orderBy,
  TrackingProjectRecord,
  TrackingPermission,
} from '../storage/json-storage';
import { authMiddleware } from '../middleware/auth';
import {
  runProject,
  rescheduleProject,
  unscheduleProject,
} from '../tasks/scheduler';

const router: Router = Router();

router.use(authMiddleware);

// ========== 项目 CRUD ==========

// 获取项目列表
router.get('/projects', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const projects = selectWhere('tracking_projects', {
      user_id: userId,
    } as any);

    const sorted = orderBy(projects, 'created_at', 'desc');

    res.json({
      projects: sorted.map((p) => ({
        id: p.id,
        name: p.name,
        topic: p.topic,
        frequency: p.frequency,
        cron_expression: p.cron_expression,
        task_type: p.task_type,
        enabled: p.enabled,
        permissions: p.permissions,
        last_run_at: p.last_run_at,
        next_run_at: p.next_run_at,
        created_at: p.created_at,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: '获取失败', message: err.message });
  }
});

// 获取单个项目
router.get('/projects/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const project = findById('tracking_projects', req.params.id);

    if (!project || project.user_id !== userId) {
      return res.status(404).json({ error: '任务不存在' });
    }

    res.json({ project });
  } catch (err: any) {
    res.status(500).json({ error: '获取失败', message: err.message });
  }
});

// 创建项目
router.post('/projects', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { name, topic, frequency, cron_expression, task_type, permissions } =
      req.body;

    if (!name || !name.trim()) {
      return res
        .status(400)
        .json({ error: 'Name is required', message: '请输入任务名称' });
    }
    if (!topic || !topic.trim()) {
      return res
        .status(400)
        .json({ error: 'Topic is required', message: '请输入追踪主题' });
    }
    if (!frequency) {
      return res
        .status(400)
        .json({ error: 'Frequency is required', message: '请选择执行频率' });
    }

    const validPermissions: TrackingPermission[] = ['SEARCH', 'LLM', 'WRITE', 'NOTIFY'];
    const perms = (permissions || []).filter((p: string) =>
      validPermissions.includes(p as TrackingPermission),
    ) as TrackingPermission[];

    const now = new Date().toISOString();
    const project = insertOne('tracking_projects', {
      id: crypto.randomUUID(),
      user_id: userId,
      name: name.trim(),
      topic: topic.trim(),
      frequency: frequency || 'daily',
      cron_expression: frequency === 'custom' ? cron_expression : undefined,
      task_type: task_type || 'tracking',
      enabled: true,
      permissions: perms,
      created_at: now,
      updated_at: now,
    });

    // 如果启用了，加入调度
    if (project.enabled) {
      rescheduleProject(project.id);
    }

    res.status(201).json({ project });
  } catch (err: any) {
    res.status(500).json({ error: '创建失败', message: err.message });
  }
});

// 更新项目
router.patch('/projects/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const project = findById('tracking_projects', req.params.id);

    if (!project || project.user_id !== userId) {
      return res.status(404).json({ error: '任务不存在' });
    }

    const update: Partial<TrackingProjectRecord> = {};
    const fields = ['name', 'topic', 'frequency', 'cron_expression', 'enabled', 'permissions'] as const;

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        (update as any)[field] = req.body[field];
      }
    }

    update.updated_at = new Date().toISOString();

    // 如果 enabled 变为 false，取消调度；如果有变化，重新调度
    const wasEnabled = project.enabled;
    const willEnable = update.enabled !== undefined ? update.enabled : wasEnabled;

    const updated = updateById('tracking_projects', req.params.id, update);

    if (updated) {
      if (willEnable) {
        rescheduleProject(project.id);
      } else if (wasEnabled && !willEnable) {
        unscheduleProject(project.id);
      }
      res.json({ project: updated });
    } else {
      res.status(404).json({ error: '任务不存在' });
    }
  } catch (err: any) {
    res.status(500).json({ error: '更新失败', message: err.message });
  }
});

// 删除项目
router.delete('/projects/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const project = findById('tracking_projects', req.params.id);

    if (!project || project.user_id !== userId) {
      return res.status(404).json({ error: '任务不存在' });
    }

    unscheduleProject(project.id);
    deleteWhere('tracking_projects', { id: req.params.id });

    // 同时删除相关的执行历史
    const runs = selectWhere('tracking_runs', {
      project_id: req.params.id,
    } as any);
    for (const run of runs) {
      deleteWhere('tracking_runs', { id: run.id });
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: '删除失败', message: err.message });
  }
});

// ========== 执行历史 ==========

// 获取执行历史
router.get('/projects/:id/runs', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const project = findById('tracking_projects', req.params.id);

    if (!project || project.user_id !== userId) {
      return res.status(404).json({ error: '任务不存在' });
    }

    const runs = selectWhere('tracking_runs', {
      project_id: req.params.id,
    } as any);

    const sorted = orderBy(runs, 'run_at', 'desc');

    res.json({
      runs: sorted.slice(0, 50), // 最多返回 50 条
    });
  } catch (err: any) {
    res.status(500).json({ error: '获取失败', message: err.message });
  }
});

// ========== 手动执行 ==========

router.post('/projects/:id/run', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const project = findById('tracking_projects', req.params.id);

    if (!project || project.user_id !== userId) {
      return res.status(404).json({ error: '任务不存在' });
    }

    const result = await runProject(req.params.id, 'manual');

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: '执行失败', message: err.message });
  }
});

export default router;
