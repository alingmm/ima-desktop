// 外部工具执行服务：打开应用 / 执行命令 + 权限分级 + 审批 + 审计日志
// 安全红线：
// 1. 高风险操作强制「需确认」，即使用户把策略设为自动也不放行
// 2. 命令执行带超时（30s）与输出上限，防止挂死/刷屏
// 3. 日志与返回前端的参数一律脱敏，不落盘明文凭证

import { exec } from 'child_process';
import crypto from 'crypto';
import {
  insertOne,
  selectWhere,
  updateById,
  findById,
  ToolActionType,
  ToolPolicyLevel,
  ToolPendingApprovalRecord,
  ToolExecutionLogRecord,
} from '../storage/json-storage';

const COMMAND_TIMEOUT_MS = 30_000;
const COMMAND_MAX_BUFFER = 1024 * 1024; // 1MB

// ========== 脱敏 ==========

const SENSITIVE_PATTERNS: RegExp[] = [
  /((?:password|passwd|pwd|token|secret|api[-_]?key|access[-_]?key|authorization)\s*[=:]\s*)\S+/gi,
  /(Bearer\s+)\S+/gi,
  /(--?(?:password|token|secret|api[-_]?key)\s+)\S+/gi,
  /((?:mysql|psql)[^\n]*?\s-p)\S+/gi,
];

export function sanitizeSensitive(text: string): string {
  let out = String(text || '');
  for (const re of SENSITIVE_PATTERNS) {
    out = out.replace(re, '$1***');
  }
  return out;
}

function truncate(text: string, max: number): string {
  const t = String(text || '');
  return t.length > max ? `${t.slice(0, max)}\n...（内容过长已截断）` : t;
}

// ========== 风险评估 ==========

export interface RiskAssessment {
  risk: 'normal' | 'high';
  reason?: string;
}

// 高风险命令关键字（命中即强制确认）
const HIGH_RISK_RULES: { re: RegExp; reason: string }[] = [
  { re: /\b(rm|del|rmdir|erase)\b\s+(-[a-z]*[rf][a-z]*\s+)?/i, reason: '包含删除文件/目录操作' },
  { re: /\b(format|mkfs|diskpart|fdisk|shred|dd)\b/i, reason: '包含磁盘格式化/覆写操作' },
  { re: /\b(shutdown|reboot|poweroff|halt|logoff)\b/i, reason: '包含关机/重启/注销操作' },
  { re: /\b(reg(\.exe)?\s+(add|delete|import)|bcdedit)\b/i, reason: '会修改系统注册表/启动配置' },
  { re: /\b(sudo|runas|su)\b/i, reason: '包含提权操作' },
  { re: /\b(chmod|chown|icacls|takeown)\b/i, reason: '会修改文件权限/所有权' },
  { re: /\b(kill|killall|taskkill|pkill)\b/i, reason: '会结束进程' },
  { re: /\b(net\s+user|useradd|userdel|usermod|passwd)\b/i, reason: '会修改系统用户账号' },
  { re: /\b(curl|wget|invoke-webrequest|iwr)\b[^\n|]*(\||&&|;)[^\n]*(sh|bash|cmd|powershell|node|python)/i, reason: '下载并直接执行远程脚本' },
  { re: /\b(iex|invoke-expression|powershell[^\n]*-enc)\b/i, reason: '会执行动态/加密脚本' },
  { re: /\b(node|python|python3|ruby|perl)\s+-(e|p)\b/i, reason: '会执行任意代码' },
  { re: /\b(eval|exec)\s*\(/i, reason: '会执行动态代码' },
  { re: /\b(sc\s+(stop|delete|config)|net\s+(stop|start))\b/i, reason: '会启停/删除系统服务' },
];

const SYSTEM_DIRS = /^(c:\\windows|c:\\program files|\/etc|\/bin|\/sbin|\/usr\/bin|\/usr\/sbin|\/system|\/boot)/i;

// 只读白名单命令（开头匹配）
const READONLY_COMMANDS = /^(ls|dir|pwd|cat|type|echo|ps|tasklist|whoami|hostname|date|time|ping|ipconfig|ifconfig|uname|df|free|ver|systeminfo|where|which|tree|head|tail|wc|find\b(?!.*-delete)|git\s+(status|log|diff|branch|show))\b/i;

export function assessCommandRisk(command: string): RiskAssessment {
  const cmd = String(command || '').trim();
  for (const rule of HIGH_RISK_RULES) {
    if (rule.re.test(cmd)) return { risk: 'high', reason: rule.reason };
  }
  // 写入系统敏感目录
  if (SYSTEM_DIRS.test(cmd) || /[>][>]?\s*(c:\\windows|\/etc|\/bin|\/sbin)/i.test(cmd)) {
    return { risk: 'high', reason: '涉及系统敏感目录' };
  }
  return { risk: 'normal' };
}

export function assessOpenTargetRisk(target: string): RiskAssessment {
  const t = String(target || '').trim();
  if (/^https?:\/\//i.test(t)) return { risk: 'normal' }; // 打开链接是安全的
  if (SYSTEM_DIRS.test(t)) return { risk: 'high', reason: '目标位于系统敏感目录' };
  return { risk: 'normal' };
}

// ========== 权限分级 ==========

const DEFAULT_POLICY: Record<ToolActionType, ToolPolicyLevel> = {
  open_app: 'auto', // 打开应用/链接默认自动
  run_command: 'confirm', // 执行命令默认需确认
};

export function getPolicyLevel(userId: string, actionType: ToolActionType): ToolPolicyLevel {
  const rows = selectWhere('tool_policies', { user_id: userId, action_type: actionType });
  const row = rows[rows.length - 1];
  if (row && (row.level === 'auto' || row.level === 'confirm' || row.level === 'deny')) {
    return row.level;
  }
  return DEFAULT_POLICY[actionType];
}

export function savePolicyLevel(userId: string, actionType: ToolActionType, level: ToolPolicyLevel): void {
  const rows = selectWhere('tool_policies', { user_id: userId, action_type: actionType });
  const now = new Date().toISOString();
  if (rows.length > 0) {
    updateById('tool_policies', rows[0].id, { level, updated_at: now });
  } else {
    insertOne('tool_policies', {
      id: crypto.randomUUID(),
      user_id: userId,
      action_type: actionType,
      level,
      created_at: now,
      updated_at: now,
    });
  }
}

export function getAllPolicies(userId: string): Record<ToolActionType, ToolPolicyLevel> {
  return {
    open_app: getPolicyLevel(userId, 'open_app'),
    run_command: getPolicyLevel(userId, 'run_command'),
  };
}

// ========== 审批签名 ==========

export function buildSignature(actionType: ToolActionType, target: string): string {
  const normalized = String(target || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return crypto.createHash('sha256').update(`${actionType}::${normalized}`).digest('hex').slice(0, 24);
}

// ========== 执行实现 ==========

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

export function executeCommand(command: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    exec(
      command,
      { timeout: COMMAND_TIMEOUT_MS, maxBuffer: COMMAND_MAX_BUFFER, windowsHide: true },
      (error, stdout, stderr) => {
        const timedOut = !!error && (error as any).killed === true && (error as any).signal === 'SIGTERM';
        resolve({
          stdout: truncate(stdout || '', 20_000),
          stderr: truncate(stderr || '', 10_000),
          exitCode: error ? (typeof (error as any).code === 'number' ? (error as any).code : 1) : 0,
          timedOut,
        });
      },
    );
  });
}

// 打开应用/文件/链接：优先 Electron shell（跨平台），否则按平台用 start/open/xdg-open
export async function executeOpenApp(target: string): Promise<{ ok: boolean; message: string }> {
  const t = String(target || '').trim();
  if (!t) return { ok: false, message: '打开目标为空' };

  // Electron 主进程环境（生产桌面端）
  if (process.versions && (process.versions as any).electron) {
    try {
      // 动态加载，避免纯 Node 环境编译/运行报错
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const electron = require('electron');
      if (/^https?:\/\//i.test(t)) {
        await electron.shell.openExternal(t);
      } else {
        const err = await electron.shell.openPath(t);
        if (err) return { ok: false, message: `打开失败：${err}` };
      }
      return { ok: true, message: '已打开' };
    } catch (e: any) {
      return { ok: false, message: `打开失败：${e.message || e}` };
    }
  }

  // 纯 Node 环境（开发模式）：按平台分发
  const platform = process.platform;
  let cmd: string;
  if (/^https?:\/\//i.test(t) || platform === 'win32') {
    // Windows：start 语义（第一个引号参数是窗口标题，必须留空，否则路径会被当作标题）
    cmd =
      platform === 'win32'
        ? `cmd /c start "" "${t.replace(/"/g, '')}"`
        : platform === 'darwin'
          ? `open "${t.replace(/"/g, '\\"')}"`
          : `xdg-open "${t.replace(/"/g, '\\"')}"`;
  } else {
    cmd =
      platform === 'darwin'
        ? `open "${t.replace(/"/g, '\\"')}"`
        : `xdg-open "${t.replace(/"/g, '\\"')}"`;
  }

  try {
    const result = await executeCommand(cmd);
    if (result.exitCode === 0) return { ok: true, message: '已打开' };
    return {
      ok: false,
      message: result.stderr
        ? `打开失败：${result.stderr.slice(0, 200)}`
        : '打开失败：当前环境可能没有图形界面，或找不到目标应用/文件',
    };
  } catch (e: any) {
    return { ok: false, message: `打开失败：${e.message || e}` };
  }
}

// ========== 执行日志 ==========

export function logToolExecution(entry: {
  userId: string;
  actionType: ToolActionType;
  actionDetail: string;
  level: ToolPolicyLevel;
  risk: 'normal' | 'high';
  ok: boolean;
  resultSummary: string;
  source: 'manual' | 'agent';
  durationMs?: number;
}): void {
  try {
    insertOne('tool_execution_logs', {
      id: crypto.randomUUID(),
      user_id: entry.userId,
      action_type: entry.actionType,
      action_detail: sanitizeSensitive(truncate(entry.actionDetail, 500)),
      level: entry.level,
      risk_level: entry.risk,
      ok: entry.ok,
      result_summary: sanitizeSensitive(truncate(entry.resultSummary, 300)),
      source: entry.source,
      duration_ms: entry.durationMs,
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[tools] 写入执行日志失败:', e);
  }
}

export function listExecutionLogs(userId: string, limit = 50): ToolExecutionLogRecord[] {
  const rows = selectWhere('tool_execution_logs', { user_id: userId });
  return rows
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    .slice(0, Math.max(1, Math.min(limit, 200)));
}

// ========== 统一执行入口（带分级 + 审批） ==========

export type ToolExecutionOutcome =
  | { outcome: 'executed'; ok: boolean; output: string; durationMs: number }
  | { outcome: 'pending'; approval: ToolPendingApprovalRecord }
  | { outcome: 'denied'; message: string };

export async function requestToolExecution(
  userId: string,
  actionType: ToolActionType,
  target: string,
  opts: {
    source: 'manual' | 'agent';
    runId?: string;
    projectId?: string;
    approvedSignatures?: string[];
  },
): Promise<ToolExecutionOutcome> {
  const cleanTarget = String(target || '').trim();
  if (!cleanTarget) {
    return { outcome: 'denied', message: '调用参数为空' };
  }

  const risk =
    actionType === 'run_command' ? assessCommandRisk(cleanTarget) : assessOpenTargetRisk(cleanTarget);
  let level = getPolicyLevel(userId, actionType);

  // 安全红线：高风险操作强制 confirm，即使策略是 auto
  if (risk.risk === 'high' && level === 'auto') level = 'confirm';

  const signature = buildSignature(actionType, cleanTarget);
  const approved = (opts.approvedSignatures || []).includes(signature);

  if (level === 'deny') {
    logToolExecution({
      userId,
      actionType,
      actionDetail: cleanTarget,
      level,
      risk: risk.risk,
      ok: false,
      resultSummary: '已被权限策略禁用，未执行',
      source: opts.source,
    });
    return { outcome: 'denied', message: '该操作已在设置中被禁用' };
  }

  if (level === 'confirm' && !approved) {
    const detail = sanitizeSensitive(truncate(cleanTarget, 500));
    const approval = insertOne('tool_pending_approvals', {
      id: crypto.randomUUID(),
      user_id: userId,
      action_type: actionType,
      action_detail: detail,
      raw_target: cleanTarget, // 原始目标仅服务端使用，接口返回时剥离
      risk_level: risk.risk,
      risk_reason: risk.reason,
      signature,
      source: opts.source,
      run_id: opts.runId,
      project_id: opts.projectId,
      status: 'pending',
      created_at: new Date().toISOString(),
    });
    return { outcome: 'pending', approval };
  }

  // 执行（auto 或已批准）
  const started = Date.now();
  let ok: boolean;
  let output: string;
  let durationMs = 0;
  if (actionType === 'run_command') {
    const result = await executeCommand(cleanTarget);
    durationMs = Date.now() - started;
    ok = result.exitCode === 0 && !result.timedOut;
    output = result.timedOut
      ? '执行超时（超过 30 秒），已自动终止'
      : [result.stdout, result.stderr].filter(Boolean).join('\n').trim() ||
        `命令已执行，退出码 ${result.exitCode ?? '未知'}`;
    if (!result.timedOut && result.exitCode !== 0) {
      output = `命令执行失败（退出码 ${result.exitCode ?? '未知'}）\n${output}`;
    }
  } else {
    const result = await executeOpenApp(cleanTarget);
    durationMs = Date.now() - started;
    ok = result.ok;
    output = result.message;
  }

  logToolExecution({
    userId,
    actionType,
    actionDetail: cleanTarget,
    level,
    risk: risk.risk,
    ok,
    resultSummary: output,
    source: opts.source,
    durationMs,
  });

  return { outcome: 'executed', ok, output: sanitizeSensitive(output), durationMs };
}

// ========== 审批处理 ==========

export function listPendingApprovals(userId: string): ToolPendingApprovalRecord[] {
  return selectWhere('tool_pending_approvals', { user_id: userId, status: 'pending' }).sort((a, b) =>
    (a.created_at || '').localeCompare(b.created_at || ''),
  );
}

// 接口返回前剥离内部字段（raw_target 含原始命令，绝不下发前端）
export function stripApprovalForClient(
  approval: ToolPendingApprovalRecord,
): Omit<ToolPendingApprovalRecord, 'raw_target'> {
  const { raw_target: _omit, ...rest } = approval;
  return rest;
}

// 返回：若批准了手动（manual）审批，则直接执行并带结果
export async function resolveApproval(
  userId: string,
  approvalId: string,
  approve: boolean,
  note?: string,
): Promise<{
  approval?: ToolPendingApprovalRecord;
  executed?: { ok: boolean; output: string };
  error?: string;
}> {
  const approval = findById('tool_pending_approvals', approvalId);
  if (!approval || approval.user_id !== userId) return { error: '审批记录不存在' };
  if (approval.status !== 'pending') return { error: '该请求已处理过，请勿重复操作' };

  const now = new Date().toISOString();
  const status = approve ? 'approved' : 'rejected';
  updateById('tool_pending_approvals', approvalId, {
    status,
    user_note: sanitizeSensitive(truncate(String(note || ''), 300)),
    resolved_at: now,
  });

  // agent 来源且批准：把签名写回对应 run 的断点快照，供续跑放行
  if (approve && approval.source === 'agent' && approval.run_id) {
    const run = findById('tracking_runs', approval.run_id);
    if (run && run.goal_state) {
      const list = new Set(run.goal_state.approved_actions || []);
      list.add(approval.signature);
      updateById('tracking_runs', run.id, {
        goal_state: { ...run.goal_state, approved_actions: Array.from(list) },
      });
    }
  }

  // 手动（manual）来源且批准：立即执行并返回结果（用内部保留的原始目标执行）
  if (approve && approval.source === 'manual') {
    const outcome = await requestToolExecution(
      userId,
      approval.action_type,
      approval.raw_target || approval.action_detail,
      {
        source: 'manual',
        approvedSignatures: [approval.signature],
      },
    );
    if (outcome.outcome === 'executed') {
      return { approval: { ...approval, status }, executed: { ok: outcome.ok, output: outcome.output } };
    }
    return { approval: { ...approval, status }, executed: { ok: false, output: '批准成功，但执行失败' } };
  }

  return { approval: { ...approval, status } };
}
