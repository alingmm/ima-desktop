import { useEffect, useRef, useState } from 'react';
import { ShieldAlert, ShieldCheck, Terminal, AppWindow, X } from 'lucide-react';
import { toolsApi } from '../api';
import type { ToolPendingItem } from '../api';
import { useToast } from './Toast';

// 全局「外部调用确认」弹窗：轮询待确认队列，有则弹窗让用户批准/拒绝
// 自主任务执行中触发的高风险/需确认操作，会暂停任务并在这里等待用户决策
const POLL_INTERVAL = 5000;

export default function PendingApprovalWatcher() {
  const toast = useToast();
  const [queue, setQueue] = useState<ToolPendingItem[]>([]);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const dismissedRef = useRef<Set<string>>(new Set()); // 本次会话已忽略（点关闭但不处理）的 id
  const busyRef = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const poll = async () => {
      if (busyRef.current) return;
      try {
        const { pending } = await toolsApi.getPending();
        const visible = pending.filter((p) => !dismissedRef.current.has(p.id));
        setQueue(visible);
      } catch {
        // 轮询失败静默（服务未就绪等），下轮再试
      }
    };
    poll();
    timer = setInterval(poll, POLL_INTERVAL);
    return () => {
      if (timer) clearInterval(timer);
    };
  }, []);

  const current = queue[0] || null;

  const handleResolve = async (approve: boolean) => {
    if (!current || submitting) return;
    busyRef.current = true;
    setSubmitting(true);
    try {
      const res = await toolsApi.confirm(current.id, approve, note.trim() || undefined);
      if (approve) {
        if (res.resumed) {
          toast.success('已允许，任务正在自动继续执行');
        } else if (res.executed) {
          toast.success(res.executed.ok ? '已允许并执行完成' : `已允许，但执行失败：${res.executed.output.slice(0, 80)}`);
        } else {
          toast.success('已允许');
        }
      } else {
        toast.info('已拒绝，任务保持暂停状态，可在追踪页继续处理');
      }
      setNote('');
      setQueue((q) => q.slice(1));
    } catch (e: any) {
      toast.error(e?.message || '操作失败，请重试');
    } finally {
      busyRef.current = false;
      setSubmitting(false);
    }
  };

  if (!current) return null;

  const isHigh = current.risk_level === 'high';
  const isCommand = current.action_type === 'run_command';
  const ActionIcon = isCommand ? Terminal : AppWindow;
  const actionLabel = isCommand ? '执行命令' : '打开应用/链接';
  const sourceLabel = current.source === 'agent' ? '来自「追踪」自主任务' : '来自手动操作';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-2xl shadow-2xl overflow-hidden">
        {/* 头部 */}
        <div
          className={`px-5 py-4 flex items-center gap-3 border-b ${
            isHigh ? 'bg-red-500/10 border-red-500/30' : 'bg-[var(--color-hover-bg)] border-[var(--color-border)]'
          }`}
        >
          {isHigh ? (
            <ShieldAlert className="w-6 h-6 text-[var(--color-danger,#f85149)] flex-shrink-0" />
          ) : (
            <ShieldCheck className="w-6 h-6 text-[var(--color-primary)] flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <h3 className={`text-base font-semibold ${isHigh ? 'text-red-400' : 'text-white'}`}>
              {isHigh ? '高风险操作，需要你确认' : '操作确认'}
            </h3>
            <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">{sourceLabel}</p>
          </div>
          <button
            onClick={() => {
              dismissedRef.current.add(current.id);
              setQueue((q) => q.slice(1));
            }}
            className="p-1.5 rounded-lg text-[var(--color-text-secondary)] hover:text-white hover:bg-[var(--color-hover-bg)] transition-colors"
            title="稍后处理"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 内容 */}
        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-[var(--color-text-primary)]">
            {current.source === 'agent' ? '自主执行任务过程中，AI 请求' : '你请求'}
            {actionLabel}：
          </p>
          <div className="bg-[var(--color-main-bg)] border border-[var(--color-border)] rounded-lg px-3 py-2.5 max-h-32 overflow-y-auto">
            <code className="text-xs text-[var(--color-info,#58a6ff)] break-all whitespace-pre-wrap font-mono">
              {current.action_detail}
            </code>
          </div>

          {isHigh && (
            <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2.5">
              <ShieldAlert className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-300 leading-relaxed">
                风险提示：{current.risk_reason || '该操作可能修改或删除系统内容'}
                。请确认你了解这条操作的后果；不确定时请点「拒绝」。
              </p>
            </div>
          )}

          <div>
            <label className="block text-xs text-[var(--color-text-secondary)] mb-1.5">
              补充说明（可选，会转告给 AI）
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="例如：只允许这一次 / 请注意别动其他文件"
              className="w-full px-3 py-2 bg-[var(--color-main-bg)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)] placeholder:text-[var(--color-text-tertiary)]"
            />
          </div>
        </div>

        {/* 按钮 */}
        <div className="px-5 pb-5 flex gap-3">
          <button
            onClick={() => handleResolve(false)}
            disabled={submitting}
            className="flex-1 px-4 py-2.5 rounded-lg border border-[var(--color-border)] text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-hover-bg)] transition-colors disabled:opacity-50"
          >
            拒绝
          </button>
          <button
            onClick={() => handleResolve(true)}
            disabled={submitting}
            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50 ${
              isHigh
                ? 'bg-red-500 hover:bg-red-600'
                : 'bg-gradient-to-r from-blue-500 to-purple-600 hover:opacity-90'
            }`}
          >
            {submitting ? '处理中...' : isHigh ? '我已知晓风险，允许执行' : '允许执行'}
          </button>
        </div>
      </div>
    </div>
  );
}
