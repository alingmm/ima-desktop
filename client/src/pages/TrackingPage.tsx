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
  Target,
  Cpu,
  RefreshCw,
  PauseCircle,
  MessageSquare,
} from 'lucide-react';
import { trackingApi, notesApi, chatApi } from '../api';
import type { AgentTraceStats } from '../api';
import { showApiError, useToast } from '../components/Toast';
import { formatShortDateTime, formatDurationZh, formatDateTimeWithWeek } from '../utils/format';
import type { ScheduleKind, ScheduleFormValue } from '../utils/cron';
import {
  DEFAULT_SCHEDULE_FORM,
  formToSchedule,
  scheduleToForm,
  describeScheduleZh,
  previewNextRun,
  isValidCron,
} from '../utils/cron';

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
  model?: string;
  max_rounds?: number;
  last_run_at?: string;
  next_run_at?: string;
  created_at: string;
}

interface GoalStateSnapshot {
  round: number;
  step_summary: string;
  run_log: string[];
  final_answer: string;
  model_used?: string;
  trace?: AgentTraceStats;
}

interface TrackingRun {
  id: string;
  project_id: string;
  run_at: string;
  status: 'success' | 'failed' | 'running' | 'skipped' | 'paused';
  error_message?: string;
  error_code?: string;
  briefing_note_id?: string;
  summary?: string;
  items_found?: number;
  duration_ms?: number;
  process_log?: string[];
  model_used?: string;
  goal_state?: GoalStateSnapshot;
  awaiting_confirm?: boolean;
  confirm_prompt?: string;
  trace?: AgentTraceStats;
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

// 频率大类选项（中文习惯，下拉选择）
const SCHEDULE_KIND_OPTIONS: { value: ScheduleKind; label: string }[] = [
  { value: 'hourly', label: '每小时（整点）' },
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
  { value: 'interval_hours', label: '每隔几小时' },
  { value: 'interval_days', label: '每隔几天' },
  { value: 'custom', label: '高级：自定义表达式' },
];

const WEEKDAY_OPTIONS = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 0, label: '周日' },
];

function formatTime(iso?: string): string {
  if (!iso) return '—';
  return formatShortDateTime(iso);
}

function formatDuration(ms?: number): string {
  return formatDurationZh(ms ?? undefined);
}

// 预览用：带周几的时间格式
function formatPreviewTime(d: Date): string {
  return formatDateTimeWithWeek(d);
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
  const [editingProject, setEditingProject] = useState<TrackingProject | null>(null); // 正在编辑的项目
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());

  // 新建项目表单状态
  const [formTaskType, setFormTaskType] = useState<'tracking' | 'goal'>('tracking');
  const [formName, setFormName] = useState('');
  const [formTopic, setFormTopic] = useState('');
  const [scheduleForm, setScheduleForm] = useState<ScheduleFormValue>(DEFAULT_SCHEDULE_FORM);
  const [formPermissions, setFormPermissions] = useState<TrackingPermission[]>([
    'SEARCH',
    'LLM',
    'WRITE',
  ]);
  const [formModel, setFormModel] = useState(''); // 空表示跟随默认模型
  const [formMaxRounds, setFormMaxRounds] = useState(''); // 空表示默认 10 轮
  const [submitting, setSubmitting] = useState(false);

  // 断点续跑 / 互动纠偏：正在输入纠偏指令的 run、纠偏文本、续跑中标记
  const [guidanceDrafts, setGuidanceDrafts] = useState<Record<string, string>>({});
  const [resumingRunId, setResumingRunId] = useState<string | null>(null);
  const [terminatedRunIds, setTerminatedRunIds] = useState<Set<string>>(new Set());

  // 可选大模型列表（云端 + Ollama 本地）
  const [availableModels, setAvailableModels] = useState<{ id: string; label: string }[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  useEffect(() => {
    loadProjects();
  }, []);

  // 加载可选大模型（追踪任务使用云端对话模型生成简报）
  useEffect(() => {
    const loadModels = async () => {
      try {
        setModelsLoading(true);
        const res = await chatApi.getModels();
        const list = (res.models || []).map((m: any) => ({
          id: m.name || m.id,
          label: m.name || m.id,
        }));
        setAvailableModels(list);
      } catch (e) {
        console.error('加载模型列表失败:', e);
      } finally {
        setModelsLoading(false);
      }
    };
    loadModels();
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

  // 表单的中文时间选择 → 存储用的 { frequency, cron_expression }
  const formToSchedulePayload = (): { frequency: TrackingFrequency; cron_expression?: string } => {
    const { frequency, cronExpression } = formToSchedule(scheduleForm);
    return { frequency, cron_expression: cronExpression };
  };

  const handleCreateClick = () => {
    setEditingProject(null);
    setFormTaskType('tracking');
    setFormName('');
    setFormTopic('');
    setScheduleForm(DEFAULT_SCHEDULE_FORM);
    setFormPermissions(['SEARCH', 'LLM', 'WRITE']);
    setFormModel('');
    setShowCreateModal(true);
  };

  const handleSubmitProject = async () => {
    if (!formName.trim()) {
      toast.warning('请输入任务名称');
      return;
    }
    if (!formTopic.trim()) {
      toast.warning(formTaskType === 'goal' ? '请输入目标描述' : '请输入追踪主题');
      return;
    }

    // 编辑模式：直接保存编辑（权限沿用项目原有授权，不重复询问）
    if (editingProject) {
      await handleUpdateProject();
      return;
    }

    // 校验权限
    const required: TrackingPermission[] = ['SEARCH', 'LLM', 'WRITE'];
    const missing = required.filter((p) => !formPermissions.includes(p));
    if (missing.length > 0) {
      setPendingProject({
        task_type: formTaskType,
        name: formName,
        topic: formTopic,
        ...formToSchedulePayload(),
        permissions: formPermissions,
        model: formModel,
        max_rounds: formMaxRounds.trim() ? Number(formMaxRounds) : undefined,
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
        task_type: formTaskType,
        name: formName,
        topic: formTopic,
        ...formToSchedulePayload(),
        permissions: formPermissions,
        model: formModel,
        max_rounds: formMaxRounds.trim() ? Number(formMaxRounds) : undefined,
      };

      const res = await trackingApi.createProject(data);
      toast.success(formTaskType === 'goal' ? '目标任务创建成功' : '追踪任务创建成功');
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
          ...formToSchedulePayload(),
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
      if (!pendingProject.task_type) pendingProject.task_type = formTaskType;
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
        if (result.paused) {
          toast.info('任务已暂停，等你确认后继续');
        } else {
          toast.success('执行完成');
        }
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

  // 断点续跑：从暂停的 run 快照接着执行，可携带用户补充/纠偏指令
  const handleResumeRun = async (project: TrackingProject, run: TrackingRun) => {
    if (runningIds.has(project.id) || resumingRunId) return;
    const guidance = (guidanceDrafts[run.id] || '').trim();
    try {
      setResumingRunId(run.id);
      const result = await trackingApi.runProject(project.id, {
        resume_run_id: run.id,
        guidance: guidance || undefined,
      });
      if (result.success) {
        if (result.paused) {
          toast.info('任务又暂停了，可继续补充方向');
        } else {
          toast.success('继续执行完成');
        }
      } else {
        toast.error(result.message || '执行失败');
      }
      // 旧的暂停卡片收起（已基于它续跑出新记录）
      setTerminatedRunIds((prev) => new Set(prev).add(run.id));
      setGuidanceDrafts((prev) => ({ ...prev, [run.id]: '' }));
      loadRuns(project.id);
      loadProjects();
    } catch (e) {
      showApiError(e, toast);
    } finally {
      setResumingRunId(null);
    }
  };

  // 打开编辑弹窗，预填当前项目信息
  const handleEdit = (project: TrackingProject) => {
    setEditingProject(project);
    setFormTaskType(project.task_type === 'goal' ? 'goal' : 'tracking');
    setFormName(project.name);
    setFormTopic(project.topic);
    setScheduleForm(scheduleToForm(project.frequency, project.cron_expression));
    setFormModel(project.model || '');
    setFormMaxRounds(project.max_rounds ? String(project.max_rounds) : '');
    setShowCreateModal(true);
  };

  // 保存编辑（PATCH）
  const handleUpdateProject = async () => {
    if (!editingProject) return;
    try {
      setSubmitting(true);
      const payload: Record<string, any> = {
        name: formName,
        topic: formTopic,
        ...formToSchedulePayload(),
        model: formModel, // 空字符串表示跟随默认模型
        max_rounds: formMaxRounds.trim() ? Number(formMaxRounds) : undefined,
      };
      const res = await trackingApi.updateProject(editingProject.id, payload);
      setProjects(projects.map((p) => (p.id === editingProject.id ? res.project : p)));
      setShowCreateModal(false);
      setEditingProject(null);
      toast.success('追踪任务已更新');
    } catch (e) {
      showApiError(e, toast);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCloseCreateModal = () => {
    setShowCreateModal(false);
    setEditingProject(null);
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
            任务中心
          </h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            话题追踪与自主执行(Agent)，定时为你收集情报、完成目标
          </p>
        </div>
        <button
          onClick={handleCreateClick}
          className="px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg font-medium flex items-center gap-2 hover:opacity-90 transition-opacity"
        >
          <Plus size={18} />
          新建任务
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
                        {project.task_type === 'goal' && (
                          <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] bg-purple-500/15 text-purple-400 border border-purple-500/30 flex items-center gap-0.5">
                            <Target size={10} />
                            Agent
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[var(--color-text-muted)] mt-1 truncate">
                        {project.topic}
                      </p>
                      <div className="flex items-center gap-2 mt-2 text-xs text-[var(--color-text-muted)]">
                        <Clock size={12} />
                        <span>
                          {describeScheduleZh(project.frequency, project.cron_expression)}
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
                          handleEdit(project);
                        }}
                        title="编辑"
                        className="p-1.5 rounded hover:bg-[var(--color-card-bg)] text-[var(--color-text-secondary)] hover:text-white"
                      >
                        <Edit3 size={14} />
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
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                      {selectedProject.name}
                      {selectedProject.task_type === 'goal' && (
                        <span className="px-2 py-0.5 rounded-full text-[11px] bg-purple-500/15 text-purple-400 border border-purple-500/30 flex items-center gap-1">
                          <Target size={11} />
                          自主执行 Agent
                        </span>
                      )}
                    </h2>
                    <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                      {selectedProject.task_type === 'goal'
                        ? `目标：${selectedProject.topic}`
                        : `追踪主题：${selectedProject.topic}`}
                    </p>
                    <p className="text-xs text-[var(--color-text-muted)] mt-1.5 flex items-center gap-1.5">
                      <Cpu size={12} className="text-blue-400" />
                      使用模型：{selectedProject.model ? selectedProject.model : '默认模型'}
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
                      {describeScheduleZh(selectedProject.frequency, selectedProject.cron_expression)}
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

                {/* 正在执行横幅：显示当前使用的大模型 */}
                {runningIds.has(selectedProject.id) && (
                  <div className="mb-3 flex items-center gap-2.5 px-4 py-3 rounded-lg bg-blue-500/10 border border-blue-500/30 text-sm">
                    <Loader2 size={16} className="animate-spin text-blue-400 flex-shrink-0" />
                    <div>
                      <span className="text-blue-300">正在执行追踪任务…</span>
                      <span className="text-[var(--color-text-muted)] ml-2">
                        使用模型：{selectedProject.model || '默认模型'}
                      </span>
                      <div className="text-xs text-[var(--color-text-muted)] mt-0.5">
                        联网搜索 → 调用大模型整理简报 → 保存到笔记，请稍候
                      </div>
                    </div>
                  </div>
                )}

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
                              {run.status === 'paused' && (
                                <PauseCircle size={16} className="text-amber-500 flex-shrink-0" />
                              )}
                              <span className={`text-sm font-medium ${run.status === 'paused' ? 'text-amber-400' : ''}`}>
                                {run.status === 'success' && '执行成功'}
                                {run.status === 'failed' && '执行失败'}
                                {run.status === 'running' && '执行中'}
                                {run.status === 'skipped' && '已跳过'}
                                {run.status === 'paused' && '等你确认'}
                              </span>
                              <span className="text-xs text-[var(--color-text-muted)]">
                                {formatTime(run.run_at)}
                              </span>
                              {run.duration_ms !== undefined && (
                                <span className="text-xs text-[var(--color-text-muted)]">
                                  · {formatDuration(run.duration_ms)}
                                </span>
                              )}
                              {run.model_used && (
                                <span
                                  className={`text-xs flex items-center gap-1 ${run.trace?.model_source === 'local' ? 'text-green-400' : 'text-blue-400'}`}
                                  title={run.trace?.model_source === 'local' ? '本次使用本地模型运行，数据不出本机' : '本次使用云端模型'}
                                >
                                  <Cpu size={11} />
                                  {run.model_used}
                                  {run.trace?.model_source === 'local' && (
                                    <span className="px-1 py-px rounded bg-green-500/15 text-[10px]">本地</span>
                                  )}
                                </span>
                              )}
                            </div>

                            {run.trace && (() => {
                              const t = run.trace!;
                              const chips: Array<{ label: string; n?: number }> = [
                                { label: '联网搜索', n: t.search_count },
                                { label: '抓取网页', n: t.capture_count },
                                { label: '知识库检索', n: t.knowledge_search_count },
                                { label: '写入笔记', n: t.note_count },
                                { label: '存入知识库', n: t.knowledge_write_count },
                                { label: '记住信息', n: t.memory_count },
                                { label: '打开应用', n: t.open_app_count },
                                { label: '执行命令', n: t.command_count },
                              ].filter((c) => (c.n || 0) > 0);
                              if (chips.length === 0) return null;
                              return (
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                  {chips.map((c) => (
                                    <span
                                      key={c.label}
                                      className="px-1.5 py-0.5 rounded-md bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[11px] text-[var(--color-text-secondary)]"
                                    >
                                      {c.label} × {c.n}
                                    </span>
                                  ))}
                                </div>
                              );
                            })()}

                            {run.summary && (
                              <p className="text-sm text-[var(--color-text-secondary)] line-clamp-2 mt-1">
                                {run.summary}
                              </p>
                            )}

                            {run.error_message && (
                              <p className="text-sm text-red-400 mt-1">
                                {run.error_message}
                              </p>
                            )}

                            {run.items_found !== undefined && run.status === 'success' && selectedProject.task_type !== 'goal' && (
                              <p className="text-xs text-[var(--color-text-muted)] mt-1">
                                找到 {run.items_found} 条相关信息
                              </p>
                            )}

                            {run.process_log && run.process_log.length > 0 && (
                              <div className="mt-2 pt-2 border-t border-[var(--color-border)]">
                                <div className="text-xs text-[var(--color-text-muted)] mb-1.5 flex items-center gap-1.5">
                                  <Sparkles size={12} className="text-purple-400" />
                                  执行过程
                                </div>
                                <div className="space-y-1">
                                  {run.process_log.map((line, i) => (
                                    <div key={i} className="text-xs text-[var(--color-text-secondary)] flex gap-2">
                                      <span className="text-[var(--color-text-muted)] flex-shrink-0">{i + 1}.</span>
                                      <span className="break-all">{line}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* 暂停待确认：显示卡在哪 + 纠偏输入 + 继续/终止 */}
                            {run.status === 'paused' && !terminatedRunIds.has(run.id) && (
                              <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                                <div className="flex items-start gap-2 mb-2">
                                  <MessageSquare size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
                                  <div className="flex-1 min-w-0">
                                    <div className="text-xs font-medium text-amber-300 mb-0.5">
                                      任务暂停了，需要你确认
                                      {run.goal_state?.round !== undefined && (
                                        <span className="ml-1.5 text-amber-400/70 font-normal">
                                          （已推进 {run.goal_state.round} 轮）
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
                                      {run.confirm_prompt || '模型在关键阶段拿不准方向，想听听你的意见。'}
                                    </p>
                                  </div>
                                </div>

                                <textarea
                                  value={guidanceDrafts[run.id] || ''}
                                  onChange={(e) =>
                                    setGuidanceDrafts((prev) => ({ ...prev, [run.id]: e.target.value }))
                                  }
                                  placeholder="可以补充方向或纠正偏差（比如：重点看最近的突破、别跑题了…），也可以不填直接继续"
                                  rows={2}
                                  className="w-full text-xs px-2.5 py-2 rounded-md bg-[var(--color-input-bg,#161b22)] border border-[var(--color-border)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-amber-500/50 resize-none"
                                />

                                <div className="flex items-center gap-2 mt-2">
                                  <button
                                    onClick={() => handleResumeRun(selectedProject!, run)}
                                    disabled={resumingRunId === run.id || runningIds.has(selectedProject?.id || '')}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                  >
                                    {resumingRunId === run.id ? (
                                      <>
                                        <Loader2 size={12} className="animate-spin" />
                                        继续执行中…
                                      </>
                                    ) : (
                                      <>
                                        <RefreshCw size={12} />
                                        接着上次继续执行
                                      </>
                                    )}
                                  </button>
                                  <button
                                    onClick={() =>
                                      setTerminatedRunIds((prev) => new Set(prev).add(run.id))
                                    }
                                    disabled={resumingRunId === run.id}
                                    className="px-3 py-1.5 text-xs rounded-md bg-white/5 hover:bg-white/10 text-[var(--color-text-secondary)] hover:text-white disabled:opacity-50 transition-colors"
                                  >
                                    到此为止
                                  </button>
                                </div>
                                <p className="text-[10px] text-[var(--color-text-muted)] mt-1.5">
                                  接着上次继续 = 保留之前的进展往下走，不会从头再来
                                </p>
                              </div>
                            )}

                            {/* 已终止的暂停 */}
                            {run.status === 'paused' && terminatedRunIds.has(run.id) && (
                              <p className="text-xs text-[var(--color-text-muted)] mt-2">
                                已终止。需要时点上方「立即执行」重新发起。
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
              <h2 className="text-lg font-semibold">
                {editingProject
                  ? formTaskType === 'goal'
                    ? '编辑目标任务'
                    : '编辑追踪任务'
                  : formTaskType === 'goal'
                  ? '新建目标任务'
                  : '新建追踪任务'}
              </h2>
              <button
                onClick={handleCloseCreateModal}
                className="p-1.5 rounded hover:bg-white/10 text-[var(--color-text-muted)] hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* 任务类型（编辑时不可切换） */}
              {!editingProject && (
                <div>
                  <label className="block text-sm font-medium mb-2">任务类型</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setFormTaskType('tracking')}
                      className={`p-3 rounded-lg border text-left transition-colors ${
                        formTaskType === 'tracking'
                          ? 'border-blue-500 bg-blue-500/10'
                          : 'border-[var(--color-border)] hover:border-[var(--color-text-muted)]'
                      }`}
                    >
                      <div className="text-sm font-medium flex items-center gap-1.5">
                        <Activity size={14} className="text-blue-400" />
                        话题追踪
                      </div>
                      <div className="text-xs text-[var(--color-text-muted)] mt-1">
                        定时搜索并整理感兴趣话题的动态简报
                      </div>
                    </button>
                    <button
                      onClick={() => setFormTaskType('goal')}
                      className={`p-3 rounded-lg border text-left transition-colors ${
                        formTaskType === 'goal'
                          ? 'border-purple-500 bg-purple-500/10'
                          : 'border-[var(--color-border)] hover:border-[var(--color-text-muted)]'
                      }`}
                    >
                      <div className="text-sm font-medium flex items-center gap-1.5">
                        <Target size={14} className="text-purple-400" />
                        目标执行(自主Agent)
                      </div>
                      <div className="text-xs text-[var(--color-text-muted)] mt-1">
                        自主规划、搜索、总结并完成任务目标
                      </div>
                    </button>
                  </div>
                </div>
              )}

              {/* 任务名称 */}
              <div>
                <label className="block text-sm font-medium mb-2">任务名称</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder={formTaskType === 'goal' ? '例如：调研 AI 视频生成工具' : '例如：AI 行业动态追踪'}
                  className="w-full px-3 py-2 bg-[var(--color-main-bg)] border border-[var(--color-border)] rounded-lg text-white placeholder-[var(--color-text-muted)] focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* 追踪主题 或 目标描述 */}
              <div>
                <label className="block text-sm font-medium mb-2">
                  {formTaskType === 'goal' ? '目标描述' : '追踪主题 / 关键词'}
                </label>
                <textarea
                  value={formTopic}
                  onChange={(e) => setFormTopic(e.target.value)}
                  placeholder={
                    formTaskType === 'goal'
                      ? '描述你想达成的目标，例如：调研 2024 年 AI 编程工具排名、优缺点，并给我一份对比报告'
                      : '输入你想追踪的话题，例如：生成式AI 最新进展'
                  }
                  rows={3}
                  className="w-full px-3 py-2 bg-[var(--color-main-bg)] border border-[var(--color-border)] rounded-lg text-white placeholder-[var(--color-text-muted)] focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>

              {/* 使用的大模型 */}
              <div>
                <label className="block text-sm font-medium mb-2 flex items-center gap-1.5">
                  <Cpu size={14} className="text-blue-400" />
                  使用的大模型
                </label>
                <select
                  value={formModel}
                  onChange={(e) => setFormModel(e.target.value)}
                  disabled={modelsLoading}
                  className="w-full px-3 py-2 bg-[var(--color-main-bg)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:border-blue-500 disabled:opacity-50"
                >
                  <option value="">跟随默认模型（推荐）</option>
                  {availableModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-[var(--color-text-muted)] mt-1.5">
                  {modelsLoading
                    ? '正在读取可用模型…'
                    : availableModels.length === 0
                      ? '未读取到可用模型，请先在「设置」中配置大模型'
                      : '追踪任务会用这个大模型来整理简报；不选则使用设置里的默认模型'}
                </p>
              </div>

              {/* 执行轮数（仅目标执行/自主Agent 类型） */}
              {formTaskType === 'goal' && (
                <div>
                  <label className="block text-sm font-medium mb-2 flex items-center gap-1.5">
                    <RefreshCw size={14} className="text-blue-400" />
                    单次执行轮数
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={formMaxRounds}
                    onChange={(e) => setFormMaxRounds(e.target.value)}
                    placeholder="默认 10 轮"
                    className="w-full px-3 py-2 bg-[var(--color-main-bg)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-[var(--color-text-muted)] mt-1.5">
                    大模型每次最多规划/调用工具多少轮；跑满仍未完成会「暂停」等你确认，可以接着续跑而不是从头再来。默认 10 轮。
                  </p>
                </div>
              )}

              {/* 执行频率（中文习惯选择，无需懂 cron） */}
              <div>
                <label className="block text-sm font-medium mb-2">执行频率</label>
                <div className="flex gap-2">
                  <select
                    value={scheduleForm.kind}
                    onChange={(e) => setScheduleForm({ ...scheduleForm, kind: e.target.value as ScheduleKind })}
                    className="flex-1 px-3 py-2 bg-[var(--color-main-bg)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:border-blue-500 text-sm"
                  >
                    {SCHEDULE_KIND_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>

                  {scheduleForm.kind === 'weekly' && (
                    <select
                      value={scheduleForm.weekday}
                      onChange={(e) => setScheduleForm({ ...scheduleForm, weekday: Number(e.target.value) })}
                      className="w-24 px-3 py-2 bg-[var(--color-main-bg)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:border-blue-500 text-sm"
                    >
                      {WEEKDAY_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  )}

                  {scheduleForm.kind === 'monthly' && (
                    <select
                      value={scheduleForm.monthday}
                      onChange={(e) => setScheduleForm({ ...scheduleForm, monthday: Number(e.target.value) })}
                      className="w-24 px-3 py-2 bg-[var(--color-main-bg)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:border-blue-500 text-sm"
                    >
                      {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                        <option key={d} value={d}>
                          {d} 号
                        </option>
                      ))}
                    </select>
                  )}

                  {(scheduleForm.kind === 'daily' ||
                    scheduleForm.kind === 'weekly' ||
                    scheduleForm.kind === 'monthly' ||
                    scheduleForm.kind === 'interval_days') && (
                    <input
                      type="time"
                      value={scheduleForm.time}
                      onChange={(e) => setScheduleForm({ ...scheduleForm, time: e.target.value })}
                      className="w-32 px-3 py-2 bg-[var(--color-main-bg)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:border-blue-500 text-sm"
                    />
                  )}

                  {(scheduleForm.kind === 'interval_hours' || scheduleForm.kind === 'interval_days') && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm text-[var(--color-text-secondary)]">每隔</span>
                      <input
                        type="number"
                        min={1}
                        max={scheduleForm.kind === 'interval_hours' ? 23 : 30}
                        value={scheduleForm.interval}
                        onChange={(e) =>
                          setScheduleForm({ ...scheduleForm, interval: Number(e.target.value) || 1 })
                        }
                        className="w-20 px-3 py-2 bg-[var(--color-main-bg)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:border-blue-500 text-sm"
                      />
                      <span className="text-sm text-[var(--color-text-secondary)]">
                        {scheduleForm.kind === 'interval_hours' ? '小时' : '天'}
                      </span>
                    </div>
                  )}
                </div>

                {scheduleForm.kind === 'custom' && (
                  <div className="mt-3">
                    <input
                      type="text"
                      value={scheduleForm.customCron}
                      onChange={(e) => setScheduleForm({ ...scheduleForm, customCron: e.target.value })}
                      placeholder="定时表达式，如：0 9 * * *"
                      className="w-full px-3 py-2 bg-[var(--color-main-bg)] border border-[var(--color-border)] rounded-lg text-white placeholder-[var(--color-text-muted)] focus:outline-none focus:border-blue-500 font-mono text-sm"
                    />
                    <p className="text-xs text-[var(--color-text-muted)] mt-1.5">
                      格式：分钟 小时 日 月 周 （例：0 9 * * * 表示每天 9:00）
                    </p>
                  </div>
                )}

                {/* 下次执行预览 + 中文说明 */}
                {(() => {
                  const sched = formToSchedule(scheduleForm);
                  const desc = describeScheduleZh(sched.frequency, sched.cronExpression);
                  const next = previewNextRun(scheduleForm);
                  const invalid = scheduleForm.kind === 'custom' && !isValidCron(scheduleForm.customCron);
                  return (
                    <div className="mt-3 flex items-start gap-2 text-xs rounded-lg bg-blue-500/5 border border-blue-500/20 px-3 py-2.5">
                      <Clock size={13} className="text-blue-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <span className="text-blue-300">{desc}</span>
                        {next && !invalid ? (
                          <div className="text-[var(--color-text-muted)] mt-0.5">
                            下次执行：{formatPreviewTime(next)}
                          </div>
                        ) : (
                          <div className="text-red-400 mt-0.5">
                            表达式无法识别，请检查格式
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* 权限预览（编辑模式不改权限，隐藏） */}
              {!editingProject && (
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
              )}
            </div>

            <div className="flex justify-end gap-2 px-5 py-4 border-t border-[var(--color-border)]">
              <button
                onClick={handleCloseCreateModal}
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
                {editingProject ? '保存修改' : '创建任务'}
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
