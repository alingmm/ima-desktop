import {
  MessageSquare,
  BookOpen,
  Video,
  Search,
  Settings,
  Plus,
  Trash2,
  Sparkles,
} from 'lucide-react';
import type { PageType } from '../App';
import { useState, useEffect } from 'react';
import { chatApi } from '../api';
import type { Conversation } from '../types';

interface SidebarProps {
  currentPage: PageType;
  onNavigate: (page: PageType) => void;
}

const navItems = [
  { id: 'chat' as PageType, label: '对话', icon: MessageSquare },
  { id: 'knowledge' as PageType, label: '知识库', icon: BookOpen },
  { id: 'video' as PageType, label: '视频生成', icon: Video },
  { id: 'search' as PageType, label: '联网搜索', icon: Search },
  { id: 'settings' as PageType, label: '设置', icon: Settings },
];

function Sidebar({ currentPage, onNavigate }: SidebarProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (currentPage === 'chat') {
      loadConversations();
    }
  }, [currentPage]);

  const loadConversations = async () => {
    try {
      setLoading(true);
      const res = await chatApi.getConversations();
      setConversations(res.conversations);
    } catch (error) {
      console.error('Failed to load conversations:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleNewChat = async () => {
    try {
      const res = await chatApi.createConversation('新对话');
      setConversations([res.conversation, ...conversations]);
      // Trigger selection of new conversation via custom event
      const event = new CustomEvent('newConversation', { detail: res.conversation });
      window.dispatchEvent(event);
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
  };

  const handleDeleteConversation = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('确定要删除这个对话吗？')) return;
    try {
      await chatApi.deleteConversation(id);
      setConversations(conversations.filter((c) => c.id !== id));
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    }
  };

  const handleSelectConversation = (id: string) => {
    const event = new CustomEvent('selectConversation', { detail: { id } });
    window.dispatchEvent(event);
  };

  return (
    <aside className="w-64 h-full bg-[var(--color-sidebar-bg)] border-r border-[var(--color-border)] flex flex-col">
      {/* Logo */}
      <div className="p-4 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
            <Sparkles size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">AI 工作台</h1>
            <p className="text-xs text-[var(--color-text-muted)]">智能助手平台</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="p-3 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentPage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ${
                isActive
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-sidebar-hover)] hover:text-white'
              }`}
            >
              <Icon size={18} />
              <span className="text-sm font-medium">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Chat conversations list */}
      {currentPage === 'chat' && (
        <div className="flex-1 flex flex-col px-3 pb-3 overflow-hidden">
          <button
            onClick={handleNewChat}
            className="flex items-center justify-center gap-2 w-full py-2.5 mb-3 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white rounded-lg transition-colors text-sm font-medium"
          >
            <Plus size={16} />
            新建对话
          </button>

          <div className="flex-1 overflow-y-auto space-y-1">
            {loading ? (
              <div className="text-center py-4 text-[var(--color-text-muted)] text-sm">
                加载中...
              </div>
            ) : conversations.length === 0 ? (
              <div className="text-center py-8 text-[var(--color-text-muted)] text-sm">
                暂无对话
              </div>
            ) : (
              conversations.map((conv) => (
                <div
                  key={conv.id}
                  onClick={() => handleSelectConversation(conv.id)}
                  className="group flex items-center justify-between px-3 py-2 rounded-lg hover:bg-[var(--color-sidebar-hover)] cursor-pointer transition-colors"
                >
                  <MessageSquare size={16} className="text-[var(--color-text-muted)] flex-shrink-0" />
                  <span className="flex-1 ml-2 text-sm text-[var(--color-text-primary)] truncate">
                    {conv.title}
                  </span>
                  <button
                    onClick={(e) => handleDeleteConversation(e, conv.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 rounded transition-all"
                  >
                    <Trash2 size={14} className="text-red-400" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* User profile section */}
      <div className="p-3 border-t border-[var(--color-border)]">
        <div className="flex items-center gap-3 px-2 py-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-white text-sm font-medium">
            U
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white truncate">用户</p>
            <p className="text-xs text-[var(--color-text-muted)] truncate">user@example.com</p>
          </div>
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;
