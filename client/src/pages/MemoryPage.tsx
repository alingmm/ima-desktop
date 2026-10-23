import { useState, useEffect, useCallback } from 'react';
import {
  Brain,
  Plus,
  Search,
  Trash2,
  Pencil,
  Clock,
  Heart,
  FileText,
  CheckCircle2,
  ListChecks,
  Loader2,
  X,
  Sparkles,
  MessageSquarePlus,
} from 'lucide-react';
import { memoryApi } from '../api';
import { useToast, showApiError } from '../components/Toast';

type MemoryCategory = '偏好' | '事实' | '结论' | '任务';
type MemorySource = 'auto' | 'manual' | 'chat';

interface Memory {
  id: string;
  content: string;
  category: MemoryCategory;
  tags?: string[];
  source?: MemorySource;
  created_at: string;
  updated_at?: string;
}

// 来源标签：让用户清楚知道这条记忆是怎么来的
const SOURCE_CONFIG: Record<MemorySource, { label: string; icon: typeof Sparkles; color: string }> = {
  auto: { label: 'AI 自动记住', icon: Sparkles, color: 'text-amber-400' },
  chat: { label: '对话中记住', icon: MessageSquarePlus, color: 'text-blue-400' },
  manual: { label: '手动添加', icon: Pencil, color: 'text-gray-400' },
};

const CATEGORY_CONFIG: {
  key: MemoryCategory;
  label: string;
  icon: typeof Heart;
  color: string;
  bg: string;
}[] = [
  { key: '偏好', label: '偏好', icon: Heart, color: 'text-pink-400', bg: 'bg-pink-500/15 border-pink-500/30' },
  { key: '事实', label: '事实', icon: FileText, color: 'text-blue-400', bg: 'bg-blue-500/15 border-blue-500/30' },
  { key: '结论', label: '结论', icon: CheckCircle2, color: 'text-green-400', bg: 'bg-green-500/15 border-green-500/30' },
  { key: '任务', label: '任务', icon: ListChecks, color: 'text-purple-400', bg: 'bg-purple-500/15 border-purple-500/30' },
];

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function MemoryPage() {
  const toast = useToast();
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newContent, setNewContent] = useState('');
  const [newCategory, setNewCategory] = useState<MemoryCategory>('事实');
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editCategory, setEditCategory] = useState<MemoryCategory>('事实');
  const [submitting, setSubmitting] = useState(false);
  const [filterCategory, setFilterCategory] = useState<MemoryCategory | 'all'>('all');

  const loadMemories = useCallback(async () => {
    try {
      setLoading(true);
      const res = await memoryApi.getMemories(searchQuery || undefined);
      setMemories(res.memories || []);
    } catch (e) {
      showApiError(e, toast);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, toast]);

  useEffect(() => {
    const t = setTimeout(loadMemories, 200);
    return () => clearTimeout(t);
  }, [loadMemories]);

  const handleAdd = async () => {
    if (!newContent.trim()) {
      toast.warning('请输入记忆内容');
      return;
    }
    try {
      setSubmitting(true);
      const res = await memoryApi.createMemory({
        content: newContent.trim(),
        category: newCategory,
        tags: [newCategory],
      });
      setMemories((prev) => [res.memory, ...prev]);
      setShowAddModal(false);
      setNewContent('');
      setNewCategory('事实');
      toast.success('记忆已保存');
    } catch (e) {
      showApiError(e, toast);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (mem: Memory) => {
    if (!confirm('确定要删除这条记忆吗？')) return;
    try {
      await memoryApi.deleteMemory(mem.id);
      setMemories((prev) => prev.filter((m) => m.id !== mem.id));
      toast.success('已删除');
    } catch (e) {
      showApiError(e, toast);
    }
  };

  const openEdit = (mem: Memory) => {
    setEditingMemory(mem);
    setEditContent(mem.content);
    setEditCategory(mem.category);
  };

  const handleUpdate = async () => {
    if (!editingMemory) return;
    if (!editContent.trim()) {
      toast.warning('请输入记忆内容');
      return;
    }
    try {
      setSubmitting(true);
      const res = await memoryApi.updateMemory(editingMemory.id, {
        content: editContent.trim(),
        category: editCategory,
        tags: [editCategory],
      });
      setMemories((prev) => prev.map((m) => (m.id === editingMemory.id ? res.memory : m)));
      setEditingMemory(null);
      toast.success('记忆已更新');
    } catch (e) {
      showApiError(e, toast);
    } finally {
      setSubmitting(false);
    }
  };

  const visible = filterCategory === 'all'
    ? memories
    : memories.filter((m) => m.category === filterCategory);

  return (
    <div className="h-full flex flex-col bg-[var(--color-main-bg)] text-white">
      {/* Header */}
      <div className="px-6 py-5 border-b border-[var(--color-border)] flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Brain size={22} className="text-blue-400" />
            记忆
          </h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            AI 会自动记住你在对话中提到的重要信息，并在需要时主动想起
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg font-medium flex items-center gap-2 hover:opacity-90 transition-opacity"
        >
          <Plus size={18} />
          手动添加
        </button>
      </div>

      {/* Toolbar */}
      <div className="px-6 py-3 border-b border-[var(--color-border)] flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索记忆内容..."
            className="w-full pl-9 pr-4 py-2 bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-lg text-white placeholder-[var(--color-text-muted)] focus:outline-none focus:border-blue-500 text-sm"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setFilterCategory('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filterCategory === 'all'
                ? 'bg-white/10 text-white'
                : 'text-[var(--color-text-secondary)] hover:bg-white/5'
            }`}
          >
            全部
          </button>
          {CATEGORY_CONFIG.map((cat) => (
            <button
              key={cat.key}
              onClick={() => setFilterCategory(cat.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
                filterCategory === cat.key
                  ? 'bg-white/10 text-white'
                  : 'text-[var(--color-text-secondary)] hover:bg-white/5'
              }`}
            >
              <cat.icon size={12} className={cat.color} />
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-[var(--color-text-muted)]">
            <Loader2 size={20} className="animate-spin mr-2" />
            加载中...
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-60 text-center px-6">
            <Brain size={42} className="text-[var(--color-text-muted)] mb-3" />
            <p className="text-[var(--color-text-secondary)] text-sm mb-2">
              {searchQuery || filterCategory !== 'all' ? '没有匹配的记忆' : '还没有任何记忆'}
            </p>
            <p className="text-xs text-[var(--color-text-muted)] max-w-sm">
              与 AI 对话时，AI 会自动提炼值得长期记住的信息保存到这里；你也可以点击右上角手动添加
            </p>
          </div>
        ) : (
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {visible.map((mem) => {
              const catConfig =
                CATEGORY_CONFIG.find((c) => c.key === mem.category) ||
                CATEGORY_CONFIG[1];
              const Icon = catConfig.icon;
              return (
                <div
                  key={mem.id}
                  className="bg-[var(--color-card-bg)] rounded-xl p-4 border border-[var(--color-border)] hover:border-[var(--color-border)]/80 transition-colors group"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className={`px-2 py-0.5 rounded-md text-xs flex items-center gap-1 border ${catConfig.bg} ${catConfig.color}`}>
                      <Icon size={11} />
                      {catConfig.label}
                    </span>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
                      <button
                        onClick={() => openEdit(mem)}
                        title="编辑"
                        className="p-1.5 rounded hover:bg-blue-500/10 text-[var(--color-text-muted)] hover:text-blue-400 transition-colors"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(mem)}
                        title="删除"
                        className="p-1.5 rounded hover:bg-red-500/10 text-[var(--color-text-muted)] hover:text-red-400 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  <p className="text-sm text-[var(--color-text-primary)] leading-relaxed">
                    {mem.content}
                  </p>
                  <div className="flex items-center justify-between mt-3 text-xs text-[var(--color-text-muted)]">
                    <span className="flex items-center gap-1.5">
                      <Clock size={12} />
                      {formatTime(mem.created_at)}
                    </span>
                    {mem.source && SOURCE_CONFIG[mem.source] && (() => {
                      const src = SOURCE_CONFIG[mem.source!];
                      const SrcIcon = src.icon;
                      return (
                        <span className={`flex items-center gap-1 ${src.color}`}>
                          <SrcIcon size={11} />
                          {src.label}
                        </span>
                      );
                    })()}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 添加记忆弹窗 */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-[var(--color-card-bg)] rounded-xl w-full max-w-md mx-4 border border-[var(--color-border)] shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Heart size={18} className="text-pink-400" />
                添加记忆
              </h2>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1.5 rounded hover:bg-white/10 text-[var(--color-text-muted)] hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">记忆内容</label>
                <textarea
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  placeholder="例如：用户偏好使用简洁的设计风格"
                  rows={4}
                  className="w-full px-3 py-2 bg-[var(--color-main-bg)] border border-[var(--color-border)] rounded-lg text-white placeholder-[var(--color-text-muted)] focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">分类</label>
                <div className="grid grid-cols-4 gap-2">
                  {CATEGORY_CONFIG.map((cat) => {
                    const Icon = cat.icon;
                    return (
                      <button
                        key={cat.key}
                        onClick={() => setNewCategory(cat.key)}
                        className={`p-2.5 rounded-lg border flex flex-col items-center gap-1 transition-colors ${
                          newCategory === cat.key
                            ? 'border-blue-500 bg-blue-500/10'
                            : 'border-[var(--color-border)] hover:border-[var(--color-text-muted)]'
                        }`}
                      >
                        <Icon size={16} className={cat.color} />
                        <span className="text-xs">{cat.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 px-5 py-4 border-t border-[var(--color-border)]">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:text-white transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleAdd}
                disabled={submitting}
                className="px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg text-sm font-medium flex items-center gap-2 hover:opacity-90 disabled:opacity-50"
              >
                {submitting && <Loader2 size={14} className="animate-spin" />}
                保存记忆
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 编辑记忆弹窗 */}
      {editingMemory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-[var(--color-card-bg)] rounded-xl w-full max-w-md mx-4 border border-[var(--color-border)] shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Pencil size={18} className="text-blue-400" />
                编辑记忆
              </h2>
              <button
                onClick={() => setEditingMemory(null)}
                className="p-1.5 rounded hover:bg-white/10 text-[var(--color-text-muted)] hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">记忆内容</label>
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 bg-[var(--color-main-bg)] border border-[var(--color-border)] rounded-lg text-white placeholder-[var(--color-text-muted)] focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">分类</label>
                <div className="grid grid-cols-4 gap-2">
                  {CATEGORY_CONFIG.map((cat) => {
                    const Icon = cat.icon;
                    return (
                      <button
                        key={cat.key}
                        onClick={() => setEditCategory(cat.key)}
                        className={`p-2.5 rounded-lg border flex flex-col items-center gap-1 transition-colors ${
                          editCategory === cat.key
                            ? 'border-blue-500 bg-blue-500/10'
                            : 'border-[var(--color-border)] hover:border-[var(--color-text-muted)]'
                        }`}
                      >
                        <Icon size={16} className={cat.color} />
                        <span className="text-xs">{cat.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 px-5 py-4 border-t border-[var(--color-border)]">
              <button
                onClick={() => setEditingMemory(null)}
                className="px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:text-white transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleUpdate}
                disabled={submitting}
                className="px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg text-sm font-medium flex items-center gap-2 hover:opacity-90 disabled:opacity-50"
              >
                {submitting && <Loader2 size={14} className="animate-spin" />}
                保存修改
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}