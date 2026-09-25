// 任务调度器
// - 启动时加载所有 enabled 的项目
// - 根据 frequency 计算下次执行时间，用 setTimeout 调度
// - 执行前校验权限，执行后更新 last_run_at
// - 同一项目加执行锁，防止并发重复执行
// - 支持项目变更时动态增删调度

import {
  selectWhere,
  findById,
  insertOne,
  updateById,
  deleteWhere,
  TrackingProjectRecord,
  TrackingRunRecord,
  TrackingFrequency,
} from '../storage/json-storage';
import {
  getTaskExecutor,
  checkPermissions,
  registerTaskExecutor,
  TaskResult,
} from './registry';
import { createTrackingExecutor } from './tracking-executor';

// 执行中的项目 id 集合（防止并发）
const runningProjects = new Set<string>();

// 每个项目的调度 timer 句柄
const projectTimers = new Map<string, NodeJS.Timeout>();

let initialized = false;

// 注册内建任务类型
registerTaskExecutor('tracking', () => createTrackingExecutor());

// 根据频率计算下次执行时间
export function getNextRunTime(
  frequency: TrackingFrequency,
  cronExpression?: string,
  from: Date = new Date(),
): Date {
  const next = new Date(from);
  switch (frequency) {
    case 'hourly':
      next.setHours(next.getHours() + 1);
      next.setMinutes(0, 0, 0);
      break;
    case 'daily':
      next.setDate(next.getDate() + 1);
      next.setHours(9, 0, 0, 0); // 默认每天上午9点
      break;
    case 'weekly':
      next.setDate(next.getDate() + 7);
      next.setHours(9, 0, 0, 0);
      break;
    case 'custom':
      // 简单 cron 解析（仅支持 "分钟 小时 * * *" 形式）
      if (cronExpression) {
        const parts = cronExpression.trim().split(/\s+/);
        if (parts.length >= 2) {
          const minute = parseInt(parts[0], 10);
          const hour = parseInt(parts[1], 10);
          if (!isNaN(minute) && !isNaN(hour)) {
            next.setHours(hour, minute, 0, 0);
            if (next <= from) {
              next.setDate(next.getDate() + 1);
            }
            return next;
          }
        }
      }
      // 无法解析的自定义 cron，fallback 到每小时
      next.setHours(next.getHours() + 1);
      next.setMinutes(0, 0, 0);
      break;
  }
  return next;
}

// 调度单个项目
function scheduleProject(project: TrackingProjectRecord) {
  if (!project.enabled) return;

  const now = new Date();
  const nextRun = getNextRunTime(
    project.frequency,
    project.cron_expression,
    now,
  );
  const delayMs = nextRun.getTime() - now.getTime();

  // 清除旧的 timer
  const oldTimer = projectTimers.get(project.id);
  if (oldTimer) clearTimeout(oldTimer);

  const timer = setTimeout(async () => {
    await runProject(project.id, 'scheduled');
    // 执行完后重新调度下一次
    const refreshed = await findById('tracking_projects', project.id);
    if (refreshed && refreshed.enabled) {
      scheduleProject(refreshed);
    }
  }, delayMs);

  projectTimers.set(project.id, timer);

  // 更新 next_run_at
  updateById('tracking_projects', project.id, {
    next_run_at: nextRun.toISOString(),
  });
}

// 取消单个项目的调度
export function unscheduleProject(projectId: string) {
  const timer = projectTimers.get(projectId);
  if (timer) {
    clearTimeout(timer);
    projectTimers.delete(projectId);
  }
}

// 项目变更后重新调度（新增/修改启停/删除后调用）
export function rescheduleProject(projectId: string) {
  unscheduleProject(projectId);
  const p = findById('tracking_projects', projectId);
  if (p && p.enabled) {
    scheduleProject(p);
  }
}

// 执行一个项目（手动或定时）
export async function runProject(
  projectId: string,
  trigger: 'manual' | 'scheduled' = 'manual',
): Promise<{
  success: boolean;
  error_code?: string;
  error_message?: string;
  run_id?: string;
  summary?: string;
  briefing_note_id?: string;
}> {
  if (runningProjects.has(projectId)) {
    return {
      success: false,
      error_code: 'ALREADY_RUNNING',
      error_message: '该任务正在执行中，请稍后再试',
    };
  }

  const project = findById('tracking_projects', projectId);
  if (!project) {
    return {
      success: false,
      error_code: 'NOT_FOUND',
      error_message: '任务不存在',
    };
  }

  const executor = getTaskExecutor(project.task_type);
  if (!executor) {
    return {
      success: false,
      error_code: 'UNKNOWN_TASK_TYPE',
      error_message: `未知的任务类型: ${project.task_type}`,
    };
  }

  // 权限校验
  const missing = checkPermissions(executor.requiredPermissions, project.permissions);
  if (missing.length > 0) {
    return {
      success: false,
      error_code: 'PERMISSION_REQUIRED',
      error_message: `缺少以下权限：${missing.join('、')}`,
      missing_permissions: missing as any,
    } as any;
  }

  runningProjects.add(projectId);
  const startTime = Date.now();
  const runAt = new Date().toISOString();

  // 创建运行记录（running 状态）
  const run = insertOne('tracking_runs', {
    id: crypto.randomUUID(),
    user_id: project.user_id,
    project_id: projectId,
    run_at: runAt,
    status: 'running',
  });

  try {
    const result: TaskResult = await executor.execute({
      userId: project.user_id,
      project,
    });

    const duration = Date.now() - startTime;

    if (result.success) {
      // 成功
      updateById('tracking_runs', run.id, {
        status: 'success',
        summary: result.summary,
        briefing_note_id: result.briefing_note_id,
        items_found: result.items_found,
        duration_ms: duration,
      });
      updateById('tracking_projects', projectId, {
        last_run_at: new Date().toISOString(),
      });

      return {
        success: true,
        run_id: run.id,
        summary: result.summary,
        briefing_note_id: result.briefing_note_id,
      };
    } else {
      // 执行失败（业务错误，如 API 调用失败）
      updateById('tracking_runs', run.id, {
        status: 'failed',
        error_message: result.error_message,
        error_code: result.error_code,
        duration_ms: duration,
      });

      return {
        success: false,
        error_code: result.error_code,
        error_message: result.error_message,
        run_id: run.id,
      };
    }
  } catch (err: any) {
    // 系统异常
    const duration = Date.now() - startTime;
    updateById('tracking_runs', run.id, {
      status: 'failed',
      error_message: err.message || String(err),
      error_code: err.error_code || 'INTERNAL_ERROR',
      duration_ms: duration,
    });

    return {
      success: false,
      error_code: err.error_code || 'INTERNAL_ERROR',
      error_message: err.message || String(err),
      run_id: run.id,
    };
  } finally {
    runningProjects.delete(projectId);
  }
}

// 启动调度器（服务启动时调用一次）
export async function startTaskScheduler() {
  if (initialized) return;
  initialized = true;

  try {
    const projects = selectWhere('tracking_projects', {
      enabled: true,
    } as any);

    for (const project of projects) {
      try {
        scheduleProject(project);
      } catch (e) {
        console.error(`[Scheduler] Failed to schedule project ${project.id}:`, e);
      }
    }

    console.log(
      `[Scheduler] Started with ${projects.length} active tracking projects`,
    );
  } catch (e) {
    console.error('[Scheduler] Failed to start:', e);
  }
}

// 停止所有调度（服务关闭时调用，可选）
export function stopTaskScheduler() {
  for (const timer of projectTimers.values()) {
    clearTimeout(timer);
  }
  projectTimers.clear();
  initialized = false;
}
