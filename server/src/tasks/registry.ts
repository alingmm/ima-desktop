// 通用任务执行器框架
// 新任务类型只需注册 executor 即可，不修改调度逻辑

import {
  TrackingPermission,
  TrackingProjectRecord,
  TrackingRunRecord,
} from '../storage/json-storage';

export interface TaskContext {
  userId: string;
  project: TrackingProjectRecord;
}

export interface TaskResult {
  success: boolean;
  error_code?: string;
  error_message?: string;
  summary?: string;
  briefing_note_id?: string;
  items_found?: number;
}

export interface TaskExecutor {
  requiredPermissions: TrackingPermission[];
  execute(ctx: TaskContext): Promise<TaskResult>;
}

// 任务类型 → 执行器 映射
const executors = new Map<string, () => TaskExecutor>();

// 注册任务执行器（延迟加载，避免循环依赖）
export function registerTaskExecutor(
  taskType: string,
  factory: () => TaskExecutor,
) {
  executors.set(taskType, factory);
}

export function getTaskExecutor(taskType: string): TaskExecutor | undefined {
  const factory = executors.get(taskType);
  return factory ? factory() : undefined;
}

// 检查权限是否齐全，返回缺失的权限列表
export function checkPermissions(
  required: TrackingPermission[],
  granted: TrackingPermission[],
): TrackingPermission[] {
  return required.filter((p) => !granted.includes(p));
}

// 权限描述（用于前端展示 / 错误信息）
export const PERMISSION_DESCRIPTIONS: Record<TrackingPermission, string> = {
  SEARCH: '联网搜索，收集网络上的最新相关信息',
  LLM: '调用大模型分析整理搜索结果，生成结构化简报',
  WRITE: '将生成的简报保存到本地笔记中',
  NOTIFY: '任务完成后发送系统通知提醒你',
};

// 供 run 记录使用的类型重导出
export type { TrackingRunRecord };
