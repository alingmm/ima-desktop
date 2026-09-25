import { useState, useEffect } from 'react';
import {
  Activity,
  Plus,
  Play,
  Trash2,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  FileText,
  Shield,
  Search,
  Brain,
  Edit3,
  Bell,
  ChevronRight,
  X,
  Eye,
  EyeOff,
  AlertCircle,
  Sparkles,
} from 'lucide-react';
import { trackingApi, notesApi } from '../api';
import { showApiError, useToast } from '../components/Toast';

type TrackingPermission = 'SEARCH' | 'LLM' | 'WRITE' | 'NOTIFY';
type TrackingFrequency = 'hourly' | 'daily' | 'weekly' | 'custom';

interface TrackingProject {
  id: string;
  name: string;
  topic: string;
  frequency: TrackingFrequency;
  cron_expression?: string;
  task_type: string;
  enabled: boolean;
  permissions: TrackingPermission[];
  last_run_at?: string;
  next_run_at?: string;
  created_at: string;
}

interface TrackingRun {
  id: string;
  project_id: string;
  run_at: string;
  status: 'success' | 'failed' | 'running' | 'skipped';
  error_message?: string;
  error_code?: string;
  briefing_note_id?: string;
  summary?: string;
  items_found?: number;
  duration_ms?: number;
}

const PERMISSION_CONFIG: {
  key: TrackingPermission;
  label: string;
  desc: string;
  icon: typeof Search;
  color: string;
}[] = [
  {
    key: 'SEARCH',
    label: '联网搜索',
    desc: '收集网络上的最新相关信息',
    icon: Search,
    color: 'text-blue-400',
  },
  {
    key: 'LLM',
    label: '调用大模型',
    desc: '分析整理搜索结果，生成结构化简报',
    icon: Brain,
    color: 'text-purple-400',
  },
  {
    key: 'WRITE',
    label: '保存到笔记',
    desc: '将生成的简报写入本地笔记',
    icon: Edit3,
    color: 'text-green-400',
  },
  {
    key: 'NOTIFY',
    label: '系统通知',
    desc: '任务完成后发送提醒通知',
    icon: Bell,
    color: 'text-yellow-400',
  },
];

const FREQUENCY_OPTIONS: { value: TrackingFrequency; label: string; desc: string }[] = [
  { value: 'hourly', label: '每小时', desc: '整点执行' },
  { value: 'daily', label: '每天', desc: '上午 9:00 执行' },
  { value: 'weekly', label: '每周', desc: '每周一 9:00 执行' },
  { value: 'custom', label: '自定义（Cron）', desc: '使用 Cron 表达式' },
];

function formatTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(ms?: number): string {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function TrackingPage() {
  const toast = useToast();
  const [projects, setProjects] = useState<TrackingProject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runs, setRuns] = useState<TrackingRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [runsLoading, setRunsLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [pendingProject, setPendingProject] = useState<any>(null); // 等待权限确认的待创建项目
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());

  // 新建项目表单状态
  const [formName, setFormName] = useState('');
  const [formTopic, setFormTopic] = useState('');
  const [formFrequency, setFormFrequency] = useState<TrackingFrequency>('daily');
  const [formCron, setFormCron] = useState('0 9 * * *');
  const [formPermissions, setFormPermissions] = useState<TrackingPermission[]>([
    'SEARCH',
    'LLM',
    'WRITE',
  ]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    if (selectedId) {
      loadRuns(selectedId);
    } else {
      setRuns([]);
    }
  }, [selectedId]);

  const loadProjects = async () => {
    try {
      setLoading(true);
      const res = await trackingApi.getProjects();
      setProjects(res.projects || []);
      if (res.projects?.length > 0 && !selectedId) {
        setSelectedId(res.projects[0].id);
      }
    } catch (e) {
      showApiError(e, toast);
    } finally {
      setLoading(false);
    }
  };

  const loadRuns = async (projectId: string) => {
    try {
      setRunsLoading(true);
      const res = await trackingApi.getRuns(projectId);
      setRuns(res.runs || []);
    } catch (e) {
      showApiError(e, toast);
    } finally {
      setRunsLoading(false);
    }
  };

  const handleCreateClick = () => {
    setFormName('');
    setFormTopic('');
    setFormFrequency('daily');
    setFormCron('0 9 * * *');
    setFormPermissions(['SEARCH', 'LLM', 'WRITE']);
    setShowCreateModal(true);
  };

  const handleSubmitProject = async () => {
    if (!formName.trim()) {
      toast.warning('请输入任务名称');
      return;
    }
    if (!formTopic.trim()) {
      toast.warning('请输入追踪主题');
      return;
    }

    // 校验权限
    const required: TrackingPermission[] = ['SEARCH', 'LLM', 'WRITE'];
    const missing = required.filter((p) => !formPermissions.includes(p));
    if (missing.length > 0) {
      setPendingProject({
        name: formName,
        topic: formTopic,
        frequency: formFrequency,
        cron_expression: formFrequency === 'custom' ? formCron : undefined,
        permissions: formPermissions,
      });
      setShowPermissionModal(true);
      setShowCreateModal(false);
      return;
    }

    await doCreateProject();
  };

  const doCreateProject = async () => {
    try {
      setSubmitting(true);
      const data = pendingProject || {
        name: formName,
        topic: formTopic,
        frequency: formFrequency,
        cron_expression: formFrequency === 'custom' ? formCron : undefined,
        permissions: formPermissions,
      };

      const res = await trackingApi.createProject(data);
      toast.success('追踪任务创建成功');
      setProjects([res.project, ...projects]);
      setSelectedId(res.project.id);
      setShowPermissionModal(false);
      setShowCreateModal(false);
      setPendingProject(null);
    } catch (e: any) {
      if (e.error === 'PERMISSION_REQUIRED') {
        // 后端也校验了权限，弹窗请求补充
        setPendingProject({
          name: formName,
          topic: formTopic,
          frequency: formFrequency,
          cron_expression: formFrequency === 'custom' ? formCron : undefined,
        });
        setShowPermissionModal(true);
      } else {
        showApiError(e, toast);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmPermissions = (perms: TrackingPermission[]) => {
    setFormPermissions(perms);
    if (pendingProject) {
      pendingProject.permissions = perms;
    }
    doCreateProject();
  };

  const handleToggleEnabled = async (project: TrackingProject) => {
    try {
      const res = await trackingApi.updateProject(project.id, {
        enabled: !project.enabled,
      });
      setProjects(
        projects.map((p) => (p.id === project.id ? res.project : p)),
      );
      toast.success(project.enabled ? '已停用' : '已启用');
    } catch (e) {
      showApiError(e, toast);
    }
  };

  const handleRunNow = async (project: TrackingProject) => {
    if (runningIds.has(project.id)) return;
    try {
      setRunningIds((prev) => new Set(prev).add(project.id));
      const result = await trackingApi.runProject(project.id);
      if (result.success) {
        toast.success('执行完成');
      } else if (result.error === 'PERMISSION_REQUIRED') {
        setPendingProject(project);
        setFormPermissions(project.permissions);
        setShowPermissionModal(true);
      } else {
        toast.error(result.message || '执行失败');
      }
      if (selectedId === project.id) {
        loadRuns(project.id);
      }
      loadProjects(); // 刷新 last_run_at
    } catch (e) {
      showApiError(e, toast);
    } finally {
      setRunningIds((prev) => {
        const next = new Set(prev);
        next.delete(project.id);
        return next;
      });
    }
  };

  const handleDelete = async (project: TrackingProject) => {
    if (!confirm(`确定要删除任务「${project.name}」吗？执行历史也会被清除。`)) return;
    try {
      await trackingApi.deleteProject(project.id);
      setProjects(projects.filter((p) => p.id !== project.id));
      if (selectedId === project.id) {
        setSelectedId(null);
      }
      toast.success('已删除');
    } catch (e) {
      showApiError(e, toast);
    }
  };

  const handleJumpToNote = async (noteId: string) => {
    // 通过事件通知，这里直接跳笔记页并高亮
    const event = new CustomEvent('openNote', { detail: { noteId } });
    window.dispatchEvent(event);
    try {
      const note = await notesApi.getNote(noteId);
      if (note) {
        // 触发导航到笔记页
        const navEvent = new CustomEvent('navigate', { detail: 'notes' });
        window.dispatchEvent(navEvent);
      }
    } catch (e) {
      // 忽略
    }
  };

  const selectedProject = projects.find((p) => p.id === selectedId);

  return (
    <div className="h-full flex flex-col bg-[var(--color-main-bg)] text-white">
      {/* Header */}
      <div className="px-6 py-5 border-b border-[var(--color-border)] flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Activity size={22} className="text-purple-400" />
            话题追踪
          </h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            自动追踪你关心的话题，定时生成情报简报
          </p>
        </div>
        <button
          onClick={handleCreateClick}
          className="px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg font-medium flex items-center gap-2 hover:opacity-90 transition-opacity"
        >
          <Plus size={18} />
          新建追踪
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧项目列表 */}
        <div className="w-80 border-r border-[var(--color-border)] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-[var(--color-text-muted)]">
              <Loader2 size={20} className="animate-spin mr-2" />
              加载中...
            </div>
          ) : projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-60 text-center px-6">
              <Activity size={36} className="text-[var(--color-text-muted)] mb-3" />
              <p className="text-[var(--color-text-secondary)] text-sm mb-2">
                还没有追踪任务
              </p>
              <p className="text-xs text-[var(--color-text-muted)]">
                创建一个追踪任务，定时为你收集整理感兴趣的话题动态
              </p>
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {projects.map((project) => (
                <div
                  key={project.id}
                  onClick={() => setSelectedId(project.id)}
                  className={`p-3 rounded-lg cursor-pointer transition-colors group ${
                    selectedId === project.id
                      ? 'bg-[var(--color-hover-bg)] border border-[var(--color-border)]'
                      : 'hover:bg-[var(--color-hover-bg)] border border-transparent'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            project.enabled ? 'bg-green-500' : 'bg-gray-500'
                          }`}
                        />
                        <h3 className="font-medium truncate text-sm">{project.name}</h3>
                      </div>
                      <p className="text-xs text-[var(--color-text-muted)] mt-1 truncate">
                        {project.topic}
                      </p>
                      <div className="flex items-center gap-2 mt-2 text-xs text-[var(--color-text-muted)]">
                        <Clock size={12} />
                        <span>
                          {FREQUENCY_OPTIONS.find((f) => f.value === project.frequency)?.label ||
                            project.frequency}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRunNow(project);
                        }}
                        title="立即执行"
                        className="p-1.5 rounded hover:bg-[var(--color-card-bg)] text-[var(--color-text-secondary)] hover:text-white"
                      >
                        {runningIds.has(project.id) ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Play size={14} />
                        )}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleEnabled(project);
                        }}
                        title={project.enabled ? '停用' : '启用'}
                        className="p-1.5 rounded hover:bg-[var(--color-card-bg)] text-[var(--color-text-secondary)] hover:text-white"
                      >
                        {project.enabled ? <Eye size={14} /> : <EyeOff size={14} />}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(project);
                        }}
                        title="删除"
                        className="p-1.5 rounded hover:bg-red-500/10 text-[var(--color-text-secondary)] hover:text-red-400"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 右侧详情 / 执行历史 */}
        <div className="flex-1 overflow-y-auto">
          {selectedProject ? (
            <div className="p-6">
              {/* 任务信息卡 */}
              <div className="bg-[var(--color-card-bg)] rounded-xl p-5 mb-5 border border-[var(--color-border)]">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h2 className="text-lg font-semibold">{selectedProject.name}</h2>
                    <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                      追踪主题：{selectedProject.topic}
                    </p>
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                      selectedProject.enabled
                        ? 'bg-green-500/15 text-green-400 border border-green-500/30'
                        : 'bg-gray-500/15 text-gray-400 border border-gray-500/30'
                    }`}
                  >
                    {selectedProject.enabled ? '运行中' : '已停用'}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <div className="text-[var(--color-text-muted)] text-xs mb-1">执行频率</div>
                    <div className="text-white">
                      {FREQUENCY_OPTIONS.find((f) => f.value === selectedProject.frequency)
                        ?.label || selectedProject.frequency}
                    </div>
                  </div>
                  <div>
                    <div className="text-[var(--color-text-muted)] text-xs mb-1">上次执行</div>
                    <div className="text-white">{formatTime(selectedProject.last_run_at)}</div>
                  </div>
                  <div>
                    <div className="text-[var(--color-text-muted)] text-xs mb-1">下次执行</div>
                    <div className="text-white">{formatTime(selectedProject.next_run_at)}</div>
                  </div>
                </div>

                {/* 权限标签 */}
                <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
                  <div className="text-xs text-[var(--color-text-muted)] mb-2 flex items-center gap-1.5">
                    <Shield size={12} />
                    已授权权限
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {PERMISSION_CONFIG.map((perm) => {
                      const granted = selectedProject.permissions.includes(perm.key);
                      const Icon = perm.icon;
                      return (
                        <span
                          key={perm.key}
                          className={`px-2.5 py-1 rounded-md text-xs flex items-center gap-1.5 ${
                            granted
                              ? `${perm.color} bg-white/5 border border-white/10`
                              : 'text-gray-500 bg-gray-500/5 border border-gray-500/20'
                          }`}
                        >
                          <Icon size={12} />
                          {perm.label}
                          {granted ? <CheckCircle2 size={10} /> : <X size={10} />}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* 执行历史 */}
              <div>
                <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
                  <Clock size={18} className="text-[var(--color-text-secondary)]" />
                  执行历史
                </h3>

                {runsLoading ? (
                  <div className="flex items-center justify-center h-32 text-[var(--color-text-muted)]">
                    <Loader2 size={18} className="animate-spin mr-2" />
                    加载中...
                  </div>
                ) : runs.length === 0 ? (
                  <div className="bg-[var(--color-card-bg)] rounded-xl p-8 text-center border border-[var(--color-border)]">
                    <Sparkles size={32} className="mx-auto text-[var(--color-text-muted)] mb-3" />
                    <p className="text-[var(--color-text-secondary)] text-sm">
                      还没有执行记录
                    </p>
                    <p className="text-xs text-[var(--color-text-muted)] mt-1">
                      点击「立即执行」试试吧
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {runs.map((run) => (
                      <div
                        key={run.id}
                        className="bg-[var(--color-card-bg)] rounded-lg p-4 border border-[var(--color-border)] hover:border-[var(--color-border)]/80 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              {run.status === 'success' && (
                                <CheckCircle2 size={16} className="text-green-500 flex-shrink-0" />
                              )}
                              {run.status === 'failed' && (
                                <XCircle size={16} className="text-red-500 flex-shrink-0" />
                              )}
                              {run.status === 'running' && (
                                <Loader2 size={16} className="animate-spin text-blue-500 flex-shrink-0" />
                              )}
                              {run.status === 'skipped' && (
                                <AlertCircle size={16} className="text-yellow-500 flex-shrink-0" />
                              )}
                              <span className="text-sm font-medium">
                                {run.status === 'success' && '执行成功'}
                                {run.status === 'failed' && '执行失败'}
                                {run.status === 'running' && '执行中'}
                                {run.status === 'skipped' && '已跳过'}
                              </span>
                              <span className="text-xs text-[var(--color-text-muted)]">
                                {formatTime(run.run_at)}
                              </span>
                              {run.duration_ms !== undefined && (
                                <span className="text-xs text-[var(--color-text-muted)]">
                                  · {formatDuration(run.duration_ms)}
                                </span>
                              )}
                            </div>

                            {run.summary && (
                              <p className="text-sm text-[var(--color-text-secondary)] line-clamp-2 mt-1">
                                {run.summary}
                              </p>
                            )}

                            {run.error_message && (
                              <p className="text-sm text-red-400 mt-1">
                                {run.error_code && `[${run.error_code}] `}
                                {run.error_message}
                              </p>
                            )}

                            {run.items_found !== undefined && run.status === 'success' && (
                              <p className="text-xs text-[var(--color-text-muted)] mt-1">
                                找到 {run.items_found} 条相关信息
                              </p>
                            )}
                          </div>

                          {run.briefing_note_id && (
                            <button
                              onClick={() => handleJumpToNote(run.briefing_note_id!)}
                              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 rounded-md text-[var(--color-text-secondary)] hover:text-white transition-colors"
                            >
                              <FileText size={12} />
                              查看笔记
                              <ChevronRight size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center px-6">
              <Activity size={48} className="text-[var(--color-text-muted)] mb-4" />
              <h3 className="text-lg font-medium mb-2">选择一个追踪任务</h3>
              <p className="text-sm text-[var(--color-text-muted)] max-w-md">
                从左侧选择一个追踪任务查看详情和执行历史，或点击右上角「新建追踪」创建你的第一个任务
              </p>
            </div>
          )}
        </div>
      </div>

      {/* 新建任务弹窗 */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-[var(--color-card-bg)] rounded-xl w-full max-w-lg mx-4 border border-[var(--color-border)] shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
              <h2 className="text-lg font-semibold">新建追踪任务</h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1.5 rounded hover:bg-white/10 text-[var(--color-text-muted)] hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* 任务名称 */}
              <div>
                <label className="block text-sm font-medium mb-2">任务名称</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="例如：AI 行业动态追踪"
                  className="w-full px-3 py-2 bg-[var(--color-main-bg)] border border-[var(--color-border)] rounded-lg text-white placeholder-[var(--color-text-muted)] focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* 追踪主题 */}
              <div>
                <label className="block text-sm font-medium mb-2">追踪主题 / 关键词</label>
                <textarea
                  value={formTopic}
                  onChange={(e) => setFormTopic(e.target.value)}
                  placeholder="输入你想追踪的话题，例如：生成式AI 最新进展"
                  rows={3}
                  className="w-full px-3 py-2 bg-[var(--color-main-bg)] border border-[var(--color-border)] rounded-lg text-white placeholder-[var(--color-text-muted)] focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>

              {/* 执行频率 */}
              <div>
                <label className="block text-sm font-medium mb-2">执行频率</label>
                <div className="grid grid-cols-2 gap-2">
                  {FREQUENCY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setFormFrequency(opt.value)}
                      className={`p-3 rounded-lg border text-left transition-colors ${
                        formFrequency === opt.value
                          ? 'border-blue-500 bg-blue-500/10'
                          : 'border-[var(--color-border)] hover:border-[var(--color-text-muted)]'
                      }`}
                    >
                      <div className="text-sm font-medium">{opt.label}</div>
                      <div className="text-xs text-[var(--color-text-muted)] mt-0.5">
                        {opt.desc}
                      </div>
                    </button>
                  ))}
                </div>

                {formFrequency === 'custom' && (
                  <div className="mt-3">
                    <input
                      type="text"
                      value={formCron}
                      onChange={(e) => setFormCron(e.target.value)}
                      placeholder="Cron 表达式，如：0 9 * * *"
                      className="w-full px-3 py-2 bg-[var(--color-main-bg)] border border-[var(--color-border)] rounded-lg text-white placeholder-[var(--color-text-muted)] focus:outline-none focus:border-blue-500 font-mono text-sm"
                    />
                    <p className="text-xs text-[var(--color-text-muted)] mt-1.5">
                      格式：分钟 小时 日 月 周 （例：0 9 * * * 表示每天 9:00）
                    </p>
                  </div>
                )}
              </div>

              {/* 权限预览 */}
              <div>
                <label className="block text-sm font-medium mb-2 flex items-center gap-1.5">
                  <Shield size={14} />
                  任务权限
                </label>
                <div className="space-y-2">
                  {PERMISSION_CONFIG.map((perm) => {
                    const Icon = perm.icon;
                    const checked = formPermissions.includes(perm.key);
                    const required = ['SEARCH', 'LLM', 'WRITE'].includes(perm.key);
                    return (
                      <label
                        key={perm.key}
                        className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                          checked
                            ? 'border-blue-500/50 bg-blue-500/5'
                            : 'border-[var(--color-border)] hover:border-[var(--color-text-muted)]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setFormPermissions([...formPermissions, perm.key]);
                            } else if (required) {
                              // 必选权限不允许取消（给个提示）
                              toast.warning(`${perm.label}是必需权限，不可取消`);
                            } else {
                              setFormPermissions(
                                formPermissions.filter((p) => p !== perm.key),
                              );
                            }
                          }}
                          className="mt-0.5 accent-blue-500"
                        />
                        <Icon size={16} className={`${perm.color} mt-0.5 flex-shrink-0`} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium flex items-center gap-1.5">
                            {perm.label}
                            {required && (
                              <span className="text-xs text-blue-400">必需</span>
                            )}
                          </div>
                          <div className="text-xs text-[var(--color-text-muted)] mt-0.5">
                            {perm.desc}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 px-5 py-4 border-t border-[var(--color-border)]">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:text-white transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSubmitProject}
                disabled={submitting}
                className="px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg text-sm font-medium flex items-center gap-2 hover:opacity-90 disabled:opacity-50"
              >
                {submitting && <Loader2 size={14} className="animate-spin" />}
                创建任务
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 权限确认弹窗 */}
      {showPermissionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-[var(--color-card-bg)] rounded-xl w-full max-w-md mx-4 border border-[var(--color-border)] shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Shield size={18} className="text-yellow-400" />
                权限授权
              </h2>
              <button
                onClick={() => {
                  setShowPermissionModal(false);
                  setPendingProject(null);
                }}
                className="p-1.5 rounded hover:bg-white/10 text-[var(--color-text-muted)] hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5">
              <p className="text-sm text-[var(--color-text-secondary)] mb-4">
                此任务需要以下权限才能正常运行。请确认授权：
              </p>

              <div className="space-y-2 mb-5">
                {PERMISSION_CONFIG.map((perm) => {
                  const Icon = perm.icon;
                  const checked = formPermissions.includes(perm.key);
                  const required = ['SEARCH', 'LLM', 'WRITE'].includes(perm.key);
                  return (
                    <label
                      key={perm.key}
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        checked
                          ? 'border-green-500/50 bg-green-500/5'
                          : 'border-[var(--color-border)] hover:border-[var(--color-text-muted)]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setFormPermissions([...formPermissions, perm.key]);
                          } else if (required) {
                            toast.warning(`${perm.label}是必需权限，不可取消`);
                          } else {
                            setFormPermissions(
                              formPermissions.filter((p) => p !== perm.key),
                            );
                          }
                        }}
                        className="mt-0.5 accent-green-500"
                      />
                      <Icon size={16} className={`${perm.color} mt-0.5 flex-shrink-0`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium flex items-center gap-1.5">
                          {perm.label}
                          {required && (
                            <span className="text-xs text-green-400">必需</span>
                          )}
                        </div>
                        <div className="text-xs text-[var(--color-text-muted)] mt-0.5">
                          {perm.desc}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>

              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
                <p className="text-xs text-yellow-300 flex items-start gap-2">
                  <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                  <span>
                    权限仅在本地使用，不会上传到任何服务器。你可以随时在任务设置中修改或撤销授权。
                  </span>
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 px-5 py-4 border-t border-[var(--color-border)]">
              <button
                onClick={() => {
                  setShowPermissionModal(false);
                  setPendingProject(null);
                }}
                className="px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:text-white transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => handleConfirmPermissions(formPermissions)}
                disabled={
                  !['SEARCH', 'LLM', 'WRITE'].every((p) =>
                    formPermissions.includes(p as TrackingPermission),
                  )
                }
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                确认授权并创建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
