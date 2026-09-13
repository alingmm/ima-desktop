import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus,
  Search,
  Trash2,
  Pin,
  Tag,
  Clock,
  Grid3X3,
  List,
  Edit3,
  ArrowLeft,
  Save,
  X,
  BookmarkPlus,
} from 'lucide-react';
import { notesApi } from '../api';
import type { Note } from '../types';

export default function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editTags, setEditTags] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showTagInput, setShowTagInput] = useState(false);
  const [newTagName, setNewTagName] = useState('');

  const loadNotes = useCallback(async () => {
    try {
      setIsLoading(true);
      const params: any = {};
      if (searchQuery) params.search = searchQuery;
      if (activeTag) params.tag = activeTag;
      const { notes } = await notesApi.getNotes(params);
      setNotes(notes);
    } catch (err) {
      console.error('Failed to load notes:', err);
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, activeTag]);

  const loadTags = useCallback(async () => {
    try {
      const { tags } = await notesApi.getTags();
      setTags(tags);
    } catch (err) {
      console.error('Failed to load tags:', err);
    }
  }, []);

  useEffect(() => {
    loadNotes();
    loadTags();
  }, [loadNotes, loadTags]);

  const createNote = async () => {
    try {
      const { note } = await notesApi.createNote({ title: '无标题笔记', content: '', tags: [] });
      setNotes(prev => [note, ...prev]);
      setSelectedNote(note);
      setEditTitle(note.title);
      setEditContent(note.content);
      setEditTags(note.tags?.join(', ') || '');
      setIsEditing(true);
    } catch (err) {
      console.error('Failed to create note:', err);
    }
  };

  const openNote = (note: Note) => {
    setSelectedNote(note);
    setEditTitle(note.title);
    setEditContent(note.content);
    setEditTags(note.tags?.join(', ') || '');
    setIsEditing(false);
  };

  const saveNote = async () => {
    if (!selectedNote) return;
    try {
      const tagArray = editTags
        .split(/[,，]/)
        .map(t => t.trim())
        .filter(Boolean);
      const { note } = await notesApi.updateNote(selectedNote.id, {
        title: editTitle,
        content: editContent,
        tags: tagArray,
      });
      setNotes(prev => prev.map(n => (n.id === note.id ? note : n)));
      setSelectedNote(note);
      setIsEditing(false);
      loadTags();
    } catch (err) {
      console.error('Failed to save note:', err);
    }
  };

  const deleteNote = async (id: string) => {
    if (!confirm('确定要删除这篇笔记吗？')) return;
    try {
      await notesApi.deleteNote(id);
      setNotes(prev => prev.filter(n => n.id !== id));
      if (selectedNote?.id === id) {
        setSelectedNote(null);
        setIsEditing(false);
      }
    } catch (err) {
      console.error('Failed to delete note:', err);
    }
  };

  const togglePin = async (note: Note, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const { note: updated } = await notesApi.updateNote(note.id, {
        is_pinned: !note.is_pinned,
      });
      setNotes(prev => prev.map(n => (n.id === updated.id ? updated : n)));
      if (selectedNote?.id === updated.id) {
        setSelectedNote(updated);
      }
    } catch (err) {
      console.error('Failed to toggle pin:', err);
    }
  };

  const addTagToNote = (tag: string) => {
    const currentTags = editTags
      .split(/[,，]/)
      .map(t => t.trim())
      .filter(Boolean);
    if (!currentTags.includes(tag)) {
      currentTags.push(tag);
      setEditTags(currentTags.join(', '));
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    if (days < 7) return `${days}天前`;
    return date.toLocaleDateString('zh-CN');
  };

  const pinnedNotes = notes.filter(n => n.is_pinned);
  const unpinnedNotes = notes.filter(n => !n.is_pinned);
  const sortedNotes = [...pinnedNotes, ...unpinnedNotes];

  // 笔记详情视图
  if (selectedNote) {
    return (
      <div className="h-full flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#30363d]">
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setSelectedNote(null); setIsEditing(false); }}
              className="p-2 hover:bg-[#21262d] rounded-lg transition-colors"
            >
              <ArrowLeft size={20} />
            </button>
            <span className="text-sm text-[#8b949e]">返回列表</span>
          </div>
          <div className="flex items-center gap-2">
            {isEditing ? (
              <>
                <button
                  onClick={() => { setIsEditing(false); setEditTitle(selectedNote.title); setEditContent(selectedNote.content); setEditTags(selectedNote.tags?.join(', ') || ''); }}
                  className="px-4 py-2 text-sm text-[#8b949e] hover:bg-[#21262d] rounded-lg transition-colors flex items-center gap-2"
                >
                  <X size={16} />
                  取消
                </button>
                <button
                  onClick={saveNote}
                  className="px-4 py-2 text-sm bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg hover:opacity-90 transition-opacity flex items-center gap-2"
                >
                  <Save size={16} />
                  保存
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={(e) => togglePin(selectedNote, e)}
                  className={`p-2 rounded-lg transition-colors ${selectedNote.is_pinned ? 'text-yellow-400 bg-yellow-400/10' : 'text-[#8b949e] hover:bg-[#21262d]'}`}
                >
                  <Pin size={18} />
                </button>
                <button
                  onClick={() => setIsEditing(true)}
                  className="px-4 py-2 text-sm text-[#8b949e] hover:bg-[#21262d] rounded-lg transition-colors flex items-center gap-2"
                >
                  <Edit3 size={16} />
                  编辑
                </button>
                <button
                  onClick={() => deleteNote(selectedNote.id)}
                  className="p-2 text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                >
                  <Trash2 size={18} />
                </button>
              </>
            )}
          </div>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-4xl mx-auto">
            {isEditing ? (
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="输入标题..."
                className="w-full text-3xl font-bold bg-transparent border-none outline-none mb-6 text-white placeholder-[#6e7681]"
              />
            ) : (
              <h1 className="text-3xl font-bold mb-6 text-white">{selectedNote.title || '无标题'}</h1>
            )}

            {/* 标签 */}
            <div className="flex items-center gap-2 mb-6 flex-wrap">
              <Tag size={16} className="text-[#8b949e]" />
              {isEditing ? (
                <>
                  {editTags
                    .split(/[,，]/)
                    .map(t => t.trim())
                    .filter(Boolean)
                    .map((tag, i) => (
                      <span key={i} className="px-2 py-1 bg-[#21262d] text-xs text-blue-400 rounded-md">
                        {tag}
                      </span>
                    ))}
                  <div className="relative">
                    <button
                      onClick={() => setShowTagInput(!showTagInput)}
                      className="px-2 py-1 text-xs text-[#8b949e] hover:bg-[#21262d] rounded-md transition-colors flex items-center gap-1"
                    >
                      <Plus size={12} />
                      添加标签
                    </button>
                    {showTagInput && (
                      <div className="absolute top-full left-0 mt-1 bg-[#1c2128] border border-[#30363d] rounded-lg p-2 z-10 min-w-[200px]">
                        <input
                          type="text"
                          value={newTagName}
                          onChange={(e) => setNewTagName(e.target.value)}
                          placeholder="输入标签名..."
                          className="w-full px-3 py-1.5 bg-[#0f1419] border border-[#30363d] rounded-md text-sm text-white outline-none focus:border-blue-500"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && newTagName.trim()) {
                              addTagToNote(newTagName.trim());
                              setNewTagName('');
                              setShowTagInput(false);
                            }
                          }}
                        />
                        {tags.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-[#30363d]">
                            <p className="text-xs text-[#6e7681] mb-2">已有标签</p>
                            <div className="flex flex-wrap gap-1">
                              {tags.map(tag => (
                                <button
                                  key={tag}
                                  onClick={() => { addTagToNote(tag); setShowTagInput(false); }}
                                  className="px-2 py-1 text-xs bg-[#21262d] text-[#8b949e] hover:text-blue-400 rounded transition-colors"
                                >
                                  {tag}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <input
                    type="text"
                    value={editTags}
                    onChange={(e) => setEditTags(e.target.value)}
                    placeholder="标签用逗号分隔"
                    className="flex-1 max-w-xs px-3 py-1 bg-[#0f1419] border border-[#30363d] rounded-md text-sm text-white outline-none focus:border-blue-500"
                  />
                </>
              ) : (
                selectedNote.tags?.length > 0 ? (
                  selectedNote.tags.map((tag, i) => (
                    <span key={i} className="px-2 py-1 bg-[#21262d] text-xs text-blue-400 rounded-md">
                      {tag}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-[#6e7681]">无标签</span>
                )
              )}
            </div>

            {/* 正文 */}
            {isEditing ? (
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                placeholder="开始写作... (支持 Markdown)"
                className="w-full min-h-[500px] bg-[#1c2128] border border-[#30363d] rounded-xl p-4 text-white outline-none focus:border-blue-500 resize-y leading-relaxed font-mono text-sm"
              />
            ) : (
              <div className="prose prose-invert max-w-none whitespace-pre-wrap leading-relaxed text-[#d0d7de]">
                {selectedNote.content || <span className="text-[#6e7681]">暂无内容，点击编辑开始写作</span>}
              </div>
            )}

            {/* 时间信息 */}
            <div className="mt-8 pt-4 border-t border-[#30363d] flex items-center gap-4 text-sm text-[#6e7681]">
              <span className="flex items-center gap-1.5">
                <Clock size={14} />
                创建于 {new Date(selectedNote.created_at).toLocaleString('zh-CN')}
              </span>
              <span className="flex items-center gap-1.5">
                <Clock size={14} />
                更新于 {formatDate(selectedNote.updated_at)}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 列表视图
  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#30363d]">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold">笔记</h1>
          <span className="text-sm text-[#8b949e]">{notes.length} 篇</span>
        </div>
        <div className="flex items-center gap-3">
          {/* 搜索框 */}
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6e7681]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索笔记..."
              className="pl-9 pr-4 py-2 bg-[#1c2128] border border-[#30363d] rounded-lg text-sm text-white outline-none focus:border-blue-500 w-64"
            />
          </div>
          {/* 视图切换 */}
          <div className="flex bg-[#1c2128] rounded-lg p-1 border border-[#30363d]">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-[#21262d] text-white' : 'text-[#8b949e]'}`}
            >
              <Grid3X3 size={18} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 rounded-md transition-colors ${viewMode === 'list' ? 'bg-[#21262d] text-white' : 'text-[#8b949e]'}`}
            >
              <List size={18} />
            </button>
          </div>
          {/* 新建按钮 */}
          <button
            onClick={createNote}
            className="px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity flex items-center gap-2"
          >
            <Plus size={18} />
            新建笔记
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* 侧边标签栏 */}
        <div className="w-48 border-r border-[#30363d] p-4 overflow-y-auto">
          <div className="mb-4">
            <button
              onClick={() => setActiveTag(null)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                !activeTag ? 'bg-blue-500/20 text-blue-400' : 'text-[#8b949e] hover:bg-[#21262d]'
              }`}
            >
              <BookmarkPlus size={16} />
              全部笔记
            </button>
          </div>
          {tags.length > 0 && (
            <div>
              <p className="text-xs text-[#6e7681] px-3 mb-2 uppercase tracking-wider">标签</p>
              <div className="space-y-1">
                {tags.map(tag => (
                  <button
                    key={tag}
                    onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                      activeTag === tag ? 'bg-blue-500/20 text-blue-400' : 'text-[#8b949e] hover:bg-[#21262d]'
                    }`}
                  >
                    <Tag size={14} />
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 笔记列表 */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex items-center justify-center h-40 text-[#8b949e]">加载中...</div>
          ) : sortedNotes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-[#8b949e]">
              <BookmarkPlus size={48} className="mb-4 opacity-30" />
              <p className="text-lg mb-2">还没有笔记</p>
              <p className="text-sm mb-4">点击上方按钮创建你的第一篇笔记</p>
              <button
                onClick={createNote}
                className="px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg text-sm hover:opacity-90 transition-opacity"
              >
                创建笔记
              </button>
            </div>
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {sortedNotes.map(note => (
                <div
                  key={note.id}
                  onClick={() => openNote(note)}
                  className="bg-[#1c2128] border border-[#30363d] rounded-xl p-4 cursor-pointer hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/5 transition-all group"
                >
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="font-medium text-white line-clamp-1 flex-1">{note.title || '无标题'}</h3>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-2">
                      <button
                        onClick={(e) => togglePin(note, e)}
                        className={`p-1 rounded ${note.is_pinned ? 'text-yellow-400' : 'text-[#8b949e] hover:text-white'}`}
                      >
                        <Pin size={14} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteNote(note.id); }}
                        className="p-1 text-[#8b949e] hover:text-red-400 rounded"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  <p className="text-sm text-[#8b949e] line-clamp-3 mb-3 min-h-[3.5rem]">
                    {note.content || '无内容'}
                  </p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1 flex-wrap">
                      {note.tags?.slice(0, 2).map((tag, i) => (
                        <span key={i} className="px-2 py-0.5 bg-[#21262d] text-xs text-blue-400 rounded">
                          {tag}
                        </span>
                      ))}
                      {note.tags?.length > 2 && (
                        <span className="text-xs text-[#6e7681]">+{note.tags.length - 2}</span>
                      )}
                    </div>
                    <span className="text-xs text-[#6e7681]">{formatDate(note.updated_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {sortedNotes.map(note => (
                <div
                  key={note.id}
                  onClick={() => openNote(note)}
                  className="bg-[#1c2128] border border-[#30363d] rounded-xl p-4 cursor-pointer hover:border-blue-500/50 transition-all group flex items-center gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {note.is_pinned && <Pin size={14} className="text-yellow-400 flex-shrink-0" />}
                      <h3 className="font-medium text-white truncate">{note.title || '无标题'}</h3>
                    </div>
                    <p className="text-sm text-[#8b949e] truncate">{note.content || '无内容'}</p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="flex items-center gap-1">
                      {note.tags?.slice(0, 2).map((tag, i) => (
                        <span key={i} className="px-2 py-0.5 bg-[#21262d] text-xs text-blue-400 rounded">
                          {tag}
                        </span>
                      ))}
                    </div>
                    <span className="text-xs text-[#6e7681] w-20 text-right">{formatDate(note.updated_at)}</span>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => togglePin(note, e)}
                        className={`p-1.5 rounded ${note.is_pinned ? 'text-yellow-400' : 'text-[#8b949e] hover:text-white'}`}
                      >
                        <Pin size={16} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteNote(note.id); }}
                        className="p-1.5 text-[#8b949e] hover:text-red-400 rounded"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
