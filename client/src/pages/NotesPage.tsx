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
  BookOpen,
  Loader,
  FileUp,
  Link2,
  Wand2,
  Film,
  Globe,
} from 'lucide-react';
import { notesApi, knowledgeApi, filesApi, captureApi } from '../api';
import type { CaptureData, VideoCaptureData, WebCaptureData } from '../api';
import { useToast, showApiError } from '../components/Toast';
import { formatRelative, formatDateTime } from '../utils/format';
import type { Note } from '../types';

// 网页抓取结果预览
function WebPreview({ result }: { result: WebCaptureData }) {
  const [expanded, setExpanded] = useState(false);
  const text = result.content || '';
  const preview = expanded ? text : text.slice(0, 1200);
  return (
    <div>
      <div className="p-4 bg-[#0f1419] border border-[#30363d] rounded-xl">
        <div className="flex items-start gap-2 mb-2">
          <Globe size={16} className="text-blue-400 mt-0.5 shrink-0" />
          <h4 className="text-sm font-medium text-white leading-snug">{result.title}</h4>
        </div>
        <a
          href={result.url}
          target="_blank"
          rel="noreferrer"
          className="block text-xs text-blue-400 hover:underline mb-3 break-all"
        >
          {result.url}
        </a>
        {text ? (
          <>
            <p className="text-sm text-[#c9d1d9] whitespace-pre-wrap leading-relaxed">
              {preview}
              {!expanded && text.length > 1200 ? '…' : ''}
            </p>
            {text.length > 1200 && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="mt-2 text-xs text-blue-400 hover:underline"
              >
                {expanded ? '收起' : `展开全部（约 ${text.length} 字）`}
              </button>
            )}
          </>
        ) : (
          <p className="text-sm text-[#f85149]">
            没能提取到正文（可能是需要登录、反爬限制或页面内容特殊），可以试试「大模型一键整理」或换一个链接。
          </p>
        )}
      </div>
      <p className="text-xs text-[#6e7681] mt-2">
        保存时会自动保留标题、链接与来源；内容较长可先点「大模型一键整理」成结构化摘要。
      </p>
    </div>
  );
}

// 视频抓取结果预览
function VideoPreview({
  result,
  formatDuration,
}: {
  result: VideoCaptureData;
  formatDuration: (sec?: number) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const desc = result.description || '';
  const preview = expanded ? desc : desc.slice(0, 600);
  const duration = formatDuration(result.duration_seconds);
  return (
    <div>
      <div className="p-4 bg-[#0f1419] border border-[#30363d] rounded-xl">
        <div className="flex gap-4">
          {result.thumbnail && (
            <img
              src={result.thumbnail}
              alt="封面"
              referrerPolicy="no-referrer"
              className="w-40 aspect-video object-cover rounded-lg border border-[#30363d] shrink-0 bg-black"
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1.5">
              <Film size={15} className="text-purple-400 shrink-0" />
              {result.platform !== 'unknown' && (
                <span className="text-[11px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/30">
                  {result.platform}
                </span>
              )}
              {duration && <span className="text-xs text-[#8b949e]">时长 {duration}</span>}
            </div>
            <h4 className="text-sm font-medium text-white leading-snug mb-1">{result.title}</h4>
            {result.author && <p className="text-xs text-[#8b949e] mb-1">作者：{result.author}</p>}
            <a
              href={result.url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-blue-400 hover:underline break-all"
            >
              {result.url}
            </a>
          </div>
        </div>

        {desc ? (
          <div className="mt-3">
            <p className="text-xs text-[#8b949e] mb-1">简介：</p>
            <p className="text-sm text-[#c9d1d9] whitespace-pre-wrap leading-relaxed">
              {preview}
              {!expanded && desc.length > 600 ? '…' : ''}
            </p>
            {desc.length > 600 && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="mt-1 text-xs text-blue-400 hover:underline"
              >
                {expanded ? '收起' : '展开全部'}
              </button>
            )}
          </div>
        ) : (
          <p className="mt-3 text-sm text-[#6e7681]">
            该平台未公开视频简介，只能保存标题、作者等基本信息。
          </p>
        )}
      </div>
      <p className="text-xs text-[#6e7681] mt-2">
        视频字幕/正文多数平台不开放，这里只抓取公开元信息与简介，不会编造内容；有简介时可点「大模型一键整理」生成摘要。
      </p>
    </div>
  );
}

export default function NotesPage() {
  const toast = useToast();
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
  const [showImportKbModal, setShowImportKbModal] = useState(false);
  const [kbList, setKbList] = useState<any[]>([]);
  const [selectedKbImport, setSelectedKbImport] = useState<string | null>(null);
  const [isImportingKb, setIsImportingKb] = useState(false);
  const [loadingKbList, setLoadingKbList] = useState(false);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const uploadDocInputRef = React.useRef<HTMLInputElement>(null);

  // 抓取链接
  const [showCaptureModal, setShowCaptureModal] = useState(false);
  const [captureUrl, setCaptureUrl] = useState('');
  const [captureLoading, setCaptureLoading] = useState(false);
  const [captureResult, setCaptureResult] = useState<CaptureData | null>(null);
  const [organizing, setOrganizing] = useState(false);
  const [savingCapture, setSavingCapture] = useState(false);

  const handlePickUploadDoc = () => uploadDocInputRef.current?.click();

  const handleUploadDoc = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    setUploadingDoc(true);
    let successCount = 0;
    try {
      for (const file of Array.from(fileList)) {
        try {
          const { note } = await filesApi.toNote(file);
          setNotes((prev) => [note, ...prev]);
          successCount += 1;
        } catch (err: any) {
          toast.error(`「${file.name}」导入失败：${err?.message || '请稍后重试'}`);
        }
      }
      if (successCount > 0) {
        toast.success(`成功导入 ${successCount} 个文档为笔记`);
        loadNotes();
        loadTags();
      }
    } finally {
      setUploadingDoc(false);
      if (uploadDocInputRef.current) uploadDocInputRef.current.value = '';
    }
  };

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

  const openImportKbModal = async () => {
    setShowImportKbModal(true);
    setSelectedKbImport(null);
    setKbList([]);
    setLoadingKbList(true);
    try {
      const res = await knowledgeApi.getBases();
      setKbList(res.bases);
    } catch (err) {
      showApiError(err, toast);
    } finally {
      setLoadingKbList(false);
    }
  };

  const doImportToKb = async () => {
    if (!selectedKbImport || !selectedNote) return;
    setIsImportingKb(true);
    try {
      const res = await knowledgeApi.importNote(selectedKbImport, selectedNote.id);
      if (res.embedding_ready) {
        toast.success('已导入知识库并完成向量化');
      } else {
        toast.warning('已导入知识库（未向量化，配置 Embedding 后重新编辑保存即可生效）');
      }
      setShowImportKbModal(false);
    } catch (err) {
      showApiError(err, toast);
    } finally {
      setIsImportingKb(false);
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

  const formatDate = (dateStr: string) => formatRelative(dateStr);

  const pinnedNotes = notes.filter(n => n.is_pinned);
  const unpinnedNotes = notes.filter(n => !n.is_pinned);
  const sortedNotes = [...pinnedNotes, ...unpinnedNotes];

  // ===== 抓取链接：网页 / 视频 =====
  const openCaptureModal = () => {
    setShowCaptureModal(true);
    setCaptureUrl('');
    setCaptureResult(null);
  };

  const closeCaptureModal = () => {
    if (captureLoading || organizing || savingCapture) return;
    setShowCaptureModal(false);
    setCaptureUrl('');
    setCaptureResult(null);
  };

  const isVideoResult = (r: CaptureData | null): r is VideoCaptureData =>
    !!r && (r as VideoCaptureData).platform !== undefined;

  const handleCapture = async () => {
    const url = captureUrl.trim();
    if (!url) {
      toast.warning('请先粘贴要抓取的链接');
      return;
    }
    if (!/^https?:\/\//i.test(url) && !/^[\w-]+(\.[\w-]+)+/.test(url)) {
      toast.warning('链接格式不对，请粘贴完整的网址');
      return;
    }
    setCaptureLoading(true);
    setCaptureResult(null);
    try {
      const result = await captureApi.fetch(url);
      setCaptureResult(result);
      if (isVideoResult(result)) {
        toast.success(`已获取视频信息：${result.title.slice(0, 20)}`);
      } else {
        toast.success('网页内容抓取成功，可以预览后保存');
      }
    } catch (e: any) {
      toast.error(e?.message || '抓取失败，请稍后重试');
    } finally {
      setCaptureLoading(false);
    }
  };

  const handleOrganize = async () => {
    if (!captureResult) return;
    const video = isVideoResult(captureResult);
    // 视频用简介作为整理素材；网页用正文
    const rawContent = video
      ? (captureResult as VideoCaptureData).description || ''
      : (captureResult as WebCaptureData).content;
    if (!rawContent.trim()) {
      toast.warning(video ? '没有抓到视频简介，暂时无法整理' : '没有可整理的正文');
      return;
    }
    setOrganizing(true);
    try {
      const organized = await captureApi.organize({
        kind: video ? 'video' : 'web',
        title: captureResult.title,
        content: rawContent,
        url: captureResult.url,
      });
      setCaptureResult({
        ...(captureResult as any),
        content: organized.content,
        _organized: true,
      });
      toast.success('整理完成，可预览后存为笔记');
    } catch (e: any) {
      toast.error(e?.message || '大模型整理失败，请稍后重试');
    } finally {
      setOrganizing(false);
    }
  };

  const handleSaveCapture = async () => {
    if (!captureResult) return;
    const video = isVideoResult(captureResult);
    const content = (captureResult as any).content || '';
    if (!content.trim()) {
      toast.warning('没有可保存的内容');
      return;
    }
    setSavingCapture(true);
    try {
      const { note } = await captureApi.toNote({
        kind: video ? 'video' : 'web',
        title: captureResult.title,
        content,
        url: captureResult.url,
        author: video ? (captureResult as VideoCaptureData).author : undefined,
        organized: !!(captureResult as any)._organized,
      });
      toast.success('已保存为笔记');
      setShowCaptureModal(false);
      setCaptureResult(null);
      setCaptureUrl('');
      setNotes((prev) => [note, ...prev]);
      loadNotes();
      loadTags();
    } catch (e: any) {
      toast.error(e?.message || '保存失败，请稍后重试');
    } finally {
      setSavingCapture(false);
    }
  };

  const formatDuration = (sec?: number): string => {
    if (!sec || sec <= 0) return '';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  };

  // 抓取链接弹窗（提取为变量，详情/列表视图下都渲染）
  const captureModal = showCaptureModal ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl bg-[#1c2128] border border-[#30363d] rounded-2xl shadow-2xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between p-5 border-b border-[#30363d]">
          <h3 className="text-base font-medium text-white flex items-center gap-2">
            <Link2 size={18} className="text-blue-400" />
            抓取网页 / 视频链接
          </h3>
          <button
            onClick={closeCaptureModal}
            disabled={captureLoading || organizing || savingCapture}
            className="p-2 hover:bg-[#21262d] rounded-lg transition-colors disabled:opacity-40"
          >
            <X size={18} className="text-[#8b949e]" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1">
          {/* URL 输入 */}
          <div className="flex gap-2">
            <input
              type="text"
              value={captureUrl}
              onChange={(e) => setCaptureUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !captureLoading && !captureResult) handleCapture();
              }}
              placeholder="粘贴网页或视频链接，如 https://example.com/article 或 B站/YouTube 视频链接"
              disabled={captureLoading}
              className="flex-1 px-3 py-2.5 bg-[#0f1419] border border-[#30363d] rounded-lg text-sm text-white placeholder-[#6e7681] focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={handleCapture}
              disabled={captureLoading || !captureUrl.trim()}
              className="px-4 py-2.5 bg-gradient-to-r from-blue-500 to-purple-600 hover:opacity-90 disabled:opacity-50 text-white rounded-lg text-sm font-medium flex items-center gap-2 transition-opacity"
            >
              {captureLoading ? <Loader size={16} className="animate-spin" /> : <Globe size={16} />}
              {captureResult && !captureLoading ? '重新抓取' : '开始抓取'}
            </button>
          </div>
          <p className="text-xs text-[#6e7681] mt-2">
            支持普通文章网页，以及哔哩哔哩、YouTube、抖音、快手、微博等常见视频平台；视频可获取标题、作者、简介、封面等公开信息。
          </p>

          {/* 抓取进度 */}
          {captureLoading && (
            <div className="mt-6 py-10 flex flex-col items-center justify-center gap-3 text-[#8b949e] text-sm">
              <Loader size={28} className="animate-spin text-blue-400" />
              <span>正在抓取并整理内容，请稍候…</span>
            </div>
          )}

          {/* 抓取结果预览 */}
          {!captureLoading && captureResult && (
            <div className="mt-5">
              {isVideoResult(captureResult) ? (
                <VideoPreview result={captureResult} formatDuration={formatDuration} />
              ) : (
                <WebPreview result={captureResult as WebCaptureData} />
              )}
            </div>
          )}
        </div>

        {/* 底部操作 */}
        {captureResult && !captureLoading && (
          <div className="flex items-center justify-between gap-3 p-4 border-t border-[#30363d]">
            <button
              onClick={handleOrganize}
              disabled={organizing || savingCapture}
              className="flex items-center gap-2 px-4 py-2.5 border border-purple-500/40 text-purple-300 hover:bg-purple-500/10 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {organizing ? <Loader size={16} className="animate-spin" /> : <Wand2 size={16} />}
              {(captureResult as any)._organized ? '再次整理' : '大模型一键整理'}
            </button>
            <div className="flex items-center gap-3">
              <button
                onClick={closeCaptureModal}
                disabled={savingCapture || organizing}
                className="px-4 py-2.5 bg-[#21262d] hover:bg-[#30363d] text-white rounded-lg transition-colors text-sm disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handleSaveCapture}
                disabled={savingCapture || organizing}
                className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-500 to-purple-600 hover:opacity-90 disabled:opacity-50 text-white rounded-lg transition-opacity text-sm font-medium"
              >
                {savingCapture ? <Loader size={16} className="animate-spin" /> : <Save size={16} />}
                存为笔记
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  ) : null;

  // 导入知识库弹窗（提取为变量，保证详情视图/列表视图下都能正常渲染，不受条件渲染影响）
  const importKbModal = showImportKbModal ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md bg-[#1c2128] border border-[#30363d] rounded-2xl shadow-2xl flex flex-col max-h-[70vh]">
        <div className="flex items-center justify-between p-5 border-b border-[#30363d]">
          <h3 className="text-base font-medium text-white">导入到知识库</h3>
          <button
            onClick={() => setShowImportKbModal(false)}
            className="p-2 hover:bg-[#21262d] rounded-lg transition-colors"
          >
            <X size={18} className="text-[#8b949e]" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {loadingKbList ? (
            <div className="py-12 flex items-center justify-center gap-2 text-[#8b949e] text-sm">
              <Loader size={16} className="animate-spin" />
              正在加载知识库列表...
            </div>
          ) : kbList.length === 0 ? (
            <div className="py-12 text-center text-[#6e7681] text-sm">
              暂无知识库，先去创建一个吧
            </div>
          ) : (
            kbList.map((kb) => (
              <div
                key={kb.id}
                onClick={() => setSelectedKbImport(kb.id)}
                className={`p-3 rounded-lg cursor-pointer transition-colors ${
                  selectedKbImport === kb.id
                    ? 'bg-gradient-to-r from-blue-500/15 to-purple-600/15 border border-blue-500/50'
                    : 'hover:bg-[#21262d] border border-transparent'
                }`}
              >
                <h4 className="text-sm font-medium text-white">{kb.name}</h4>
                {kb.description && (
                  <p className="text-xs text-[#8b949e] mt-1 line-clamp-1">{kb.description}</p>
                )}
              </div>
            ))
          )}
        </div>
        <div className="flex items-center justify-end gap-3 p-4 border-t border-[#30363d]">
          <button
            onClick={() => setShowImportKbModal(false)}
            className="px-4 py-2.5 bg-[#21262d] hover:bg-[#30363d] text-white rounded-lg transition-colors text-sm"
          >
            取消
          </button>
          <button
            onClick={doImportToKb}
            disabled={!selectedKbImport || isImportingKb}
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-500 to-purple-600 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-opacity text-sm"
          >
            {isImportingKb ? <Loader size={16} className="animate-spin" /> : <BookmarkPlus size={16} />}
            导入
          </button>
        </div>
      </div>
    </div>
  ) : null;

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
                  onClick={openImportKbModal}
                  className="px-4 py-2 text-sm text-[#8b949e] hover:bg-[#21262d] rounded-lg transition-colors flex items-center gap-2"
                  title="导入到知识库"
                >
                  <BookOpen size={16} />
                  导入知识库
                </button>
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
                创建于 {formatDateTime(selectedNote.created_at)}
              </span>
              <span className="flex items-center gap-1.5">
                <Clock size={14} />
                更新于 {formatDate(selectedNote.updated_at)}
              </span>
            </div>
          </div>
        </div>
        {importKbModal}
        {captureModal}
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
          {/* 操作按钮 */}
          <div className="flex items-center gap-2">
            <input
              ref={uploadDocInputRef}
              type="file"
              multiple
              accept=".pdf,.doc,.docx,.txt,.md,.markdown"
              onChange={handleUploadDoc}
              className="hidden"
            />
            <button
              onClick={openCaptureModal}
              title="粘贴网页或视频链接，自动抓取内容并存为笔记"
              className="px-3 py-2 border border-[#30363d] text-[#c9d1d9] rounded-lg text-sm font-medium hover:bg-[#21262d] transition-colors flex items-center gap-2"
            >
              <Link2 size={18} />
              <span className="hidden sm:inline">抓取链接</span>
            </button>
            <button
              onClick={handlePickUploadDoc}
              disabled={uploadingDoc}
              title="上传 Word / PDF / TXT / Markdown 文档，自动识别文字并保存为笔记"
              className="px-3 py-2 border border-[#30363d] text-[#c9d1d9] rounded-lg text-sm font-medium hover:bg-[#21262d] disabled:opacity-50 transition-colors flex items-center gap-2"
            >
              {uploadingDoc ? <Loader size={18} className="animate-spin" /> : <FileUp size={18} />}
              <span className="hidden sm:inline">{uploadingDoc ? '导入中…' : '上传文档'}</span>
            </button>
            <button
              onClick={createNote}
              className="px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity flex items-center gap-2"
            >
              <Plus size={18} />
              新建笔记
            </button>
          </div>
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
      {importKbModal}
      {captureModal}
    </div>
  );
}
