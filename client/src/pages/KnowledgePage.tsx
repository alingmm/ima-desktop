import { useState, useEffect } from 'react';
import {
  Plus,
  Search,
  Upload,
  BookOpen,
  FileText,
  Trash2,
  Share2,
  Users,
  Clock,
  X,
  Link,
  Copy,
  CheckCircle,
  AlertCircle,
  Loader,
  Edit3,
  Save,
  BookmarkPlus,
} from 'lucide-react';
import { knowledgeApi, notesApi } from '../api';
import type { KnowledgeBase, Document } from '../types';
import { useToast, showApiError } from '../components/Toast';

function KnowledgePage() {
  const toast = useToast();
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [selectedKb, setSelectedKb] = useState<KnowledgeBase | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [newKbName, setNewKbName] = useState('');
  const [newKbDesc, setNewKbDesc] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [activeTab, setActiveTab] = useState<'docs' | 'chat'>('docs');
  const [chatQuery, setChatQuery] = useState('');
  const [chatAnswer, setChatAnswer] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [collaborators, setCollaborators] = useState<any[]>([]);
  const [shareLink, setShareLink] = useState('');
  const [copied, setCopied] = useState(false);

  // Document editing
  const [editingDoc, setEditingDoc] = useState<Document | null>(null);
  const [editDocContent, setEditDocContent] = useState('');
  const [editDocFilename, setEditDocFilename] = useState('');
  const [isLoadingDocContent, setIsLoadingDocContent] = useState(false);
  const [isSavingDoc, setIsSavingDoc] = useState(false);

  const openDocEditor = async (doc: Document) => {
    setEditingDoc(doc);
    setEditDocFilename(doc.filename);
    setEditDocContent('');
    setIsLoadingDocContent(true);
    try {
      const res = await knowledgeApi.getDocumentContent(doc.id);
      setEditDocContent(res.content);
    } catch (err) {
      showApiError(err, toast);
    } finally {
      setIsLoadingDocContent(false);
    }
  };

  const saveDocEdit = async () => {
    if (!editingDoc) return;
    setIsSavingDoc(true);
    try {
      const res = await knowledgeApi.updateDocument(editingDoc.id, {
        content: editDocContent,
        filename: editDocFilename,
      });
      toast.success(`文档已保存${res.embedding_ready ? '并完成向量化' : ''}，共 ${res.chunk_count} 个片段`);
      setEditingDoc(null);
      loadDocuments(selectedKb!.id);
    } catch (err) {
      showApiError(err, toast);
    } finally {
      setIsSavingDoc(false);
    }
  };

  const docToNote = async (doc: Document) => {
    try {
      const res = await notesApi.createFromDocument(doc.id);
      toast.success(`已转为笔记：${res.note.title}`);
    } catch (err) {
      showApiError(err, toast);
    }
  };

  // Import note to knowledge base
  const [showImportNoteModal, setShowImportNoteModal] = useState(false);
  const [importNotes, setImportNotes] = useState<any[]>([]);
  const [importSearch, setImportSearch] = useState('');
  const [selectedNoteImport, setSelectedNoteImport] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const loadNotesForImport = async () => {
    try {
      const res = await notesApi.getNotes(importSearch ? { search: importSearch } : undefined);
      setImportNotes(res.notes);
    } catch (err) {
      showApiError(err, toast);
    }
  };

  const openImportNoteModal = () => {
    setShowImportNoteModal(true);
    setSelectedNoteImport(null);
    setImportSearch('');
    loadNotesForImport();
  };

  const doImportNote = async () => {
    if (!selectedNoteImport || !selectedKb) return;
    setIsImporting(true);
    try {
      const res = await knowledgeApi.importNote(selectedKb.id, selectedNoteImport);
      toast.success(`笔记已导入知识库${res.embedding_ready ? '并完成向量化' : ''}`);
      setShowImportNoteModal(false);
      loadDocuments(selectedKb.id);
    } catch (err) {
      showApiError(err, toast);
    } finally {
      setIsImporting(false);
    }
  };

  useEffect(() => {
    loadKnowledgeBases();
  }, []);

  useEffect(() => {
    if (selectedKb) {
      loadDocuments(selectedKb.id);
    }
  }, [selectedKb]);

  const loadKnowledgeBases = async () => {
    try {
      setLoading(true);
      const res = await knowledgeApi.getBases();
      setKnowledgeBases(res.bases);
    } catch (error) {
      console.error('Failed to load knowledge bases:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadDocuments = async (kbId: string) => {
    try {
      const res = await knowledgeApi.getDocuments(kbId);
      setDocuments(res.documents);
    } catch (error) {
      console.error('Failed to load documents:', error);
    }
  };

  const handleCreateKb = async () => {
    if (!newKbName.trim()) return;
    try {
      const res = await knowledgeApi.createBase(newKbName, newKbDesc);
      setKnowledgeBases([res.base, ...knowledgeBases]);
      setSelectedKb(res.base);
      setShowCreateModal(false);
      setNewKbName('');
      setNewKbDesc('');
    } catch (error: any) {
      console.error('Failed to create knowledge base:', error);
      showApiError(error, toast);
    }
  };

  const handleDeleteKb = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('确定要删除这个知识库吗？所有文档将被永久删除。')) return;
    try {
      await knowledgeApi.deleteBase(id);
      setKnowledgeBases(knowledgeBases.filter((kb) => kb.id !== id));
      if (selectedKb?.id === id) {
        setSelectedKb(null);
      }
    } catch (error: any) {
      console.error('Failed to delete knowledge base:', error);
      showApiError(error, toast);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedKb || !e.target.files?.length) return;
    const files = Array.from(e.target.files);
    try {
      setUploading(true);
      for (const file of files) {
        await knowledgeApi.uploadDocument(selectedKb.id, file);
      }
      await loadDocuments(selectedKb.id);
    } catch (error: any) {
      console.error('Failed to upload document:', error);
      showApiError(error, toast);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleDeleteDoc = async (docId: string) => {
    if (!selectedKb || !confirm('确定要删除这个文档吗？')) return;
    try {
      await knowledgeApi.deleteDocument(docId);
      setDocuments(documents.filter((d) => d.id !== docId));
    } catch (error: any) {
      console.error('Failed to delete document:', error);
      showApiError(error, toast);
    }
  };

  const handleRagSearch = async () => {
    if (!selectedKb || !chatQuery.trim()) return;
    try {
      setIsSearching(true);
      setChatAnswer('');
      const response = await fetch(`/api/knowledge/${selectedKb.id}/search/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: chatQuery, limit: 5 }),
      });

      if (!response.ok) throw new Error('Search failed');

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullText = '';

      if (reader) {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.done) {
                  break;
                } else if (data.content) {
                  fullText += data.content;
                  setChatAnswer(fullText);
                }
              } catch (e) {
                // ignore
              }
            }
          }
        }
      }
    } catch (error: any) {
      console.error('RAG search error:', error);
      showApiError(error, toast);
      setChatAnswer('搜索失败，请稍后重试。');
    } finally {
      setIsSearching(false);
    }
  };

  const openShareModal = async () => {
    if (!selectedKb) return;
    setShowShareModal(true);
    try {
      const [collabRes, shareRes] = await Promise.all([
        knowledgeApi.getShareInfo(selectedKb.id),
        knowledgeApi.createShare(selectedKb.id, 'read'),
      ]);
      setCollaborators(collabRes.collaborators || []);
      setShareLink(`${window.location.origin}/share/${shareRes.share?.share_token}`);
    } catch (error) {
      console.error('Failed to load share data:', error);
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(shareLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const filteredKbs = knowledgeBases.filter((kb) =>
    kb.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'text-green-400';
      case 'processing':
        return 'text-blue-400';
      case 'failed':
        return 'text-red-400';
      default:
        return 'text-[var(--color-text-muted)]';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle size={14} />;
      case 'processing':
        return <Loader size={14} className="animate-spin" />;
      case 'failed':
        return <AlertCircle size={14} />;
      default:
        return <Clock size={14} />;
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="h-full flex">
      {/* Knowledge base list sidebar */}
      <div className="w-72 h-full border-r border-[var(--color-border)] flex flex-col bg-[var(--color-sidebar-bg)]">
        <div className="p-4 border-b border-[var(--color-border)]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-white">知识库</h2>
            <button
              onClick={() => setShowCreateModal(true)}
              className="p-2 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white rounded-lg transition-colors"
            >
              <Plus size={16} />
            </button>
          </div>
          <div className="relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索知识库..."
              className="w-full pl-9 pr-4 py-2 bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)]"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {loading ? (
            <div className="text-center py-8 text-[var(--color-text-muted)] text-sm">加载中...</div>
          ) : filteredKbs.length === 0 ? (
            <div className="text-center py-8">
              <BookOpen size={32} className="mx-auto text-[var(--color-text-muted)] mb-2 opacity-50" />
              <p className="text-sm text-[var(--color-text-muted)]">暂无知识库</p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="mt-3 text-sm text-[var(--color-primary)] hover:underline"
              >
                创建第一个知识库
              </button>
            </div>
          ) : (
            filteredKbs.map((kb) => (
              <div
                key={kb.id}
                onClick={() => setSelectedKb(kb)}
                className={`group flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors ${
                  selectedKb?.id === kb.id
                    ? 'bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/30'
                    : 'hover:bg-[var(--color-sidebar-hover)] border border-transparent'
                }`}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center flex-shrink-0">
                    <BookOpen size={16} className="text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white truncate">{kb.name}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      {kb.document_count || 0} 个文档
                    </p>
                  </div>
                </div>
                <button
                  onClick={(e) => handleDeleteKb(e, kb.id)}
                  className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-500/20 rounded transition-all ml-2"
                >
                  <Trash2 size={14} className="text-red-400" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col">
        {!selectedKb ? (
          <div className="flex-1 flex flex-col items-center justify-center">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center mb-6">
              <BookOpen size={36} className="text-white" />
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">选择或创建知识库</h2>
            <p className="text-[var(--color-text-secondary)] mb-6">
              创建知识库，上传文档，开启智能问答
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-6 py-3 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white rounded-xl transition-colors font-medium"
            >
              <Plus size={18} />
              创建知识库
            </button>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="h-14 border-b border-[var(--color-border)] flex items-center justify-between px-6">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center">
                  <BookOpen size={16} className="text-white" />
                </div>
                <div>
                  <h2 className="text-base font-medium text-white">{selectedKb.name}</h2>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={openImportNoteModal}
                  className="flex items-center gap-2 px-3 py-1.5 bg-[var(--color-card-bg)] border border-[var(--color-border)] hover:border-[var(--color-primary)] rounded-lg transition-colors text-sm text-[var(--color-text-primary)]"
                >
                  <BookmarkPlus size={14} />
                  导入笔记
                </button>
                <button
                  onClick={openShareModal}
                  className="flex items-center gap-2 px-3 py-1.5 bg-[var(--color-card-bg)] border border-[var(--color-border)] hover:border-[var(--color-primary)] rounded-lg transition-colors text-sm text-[var(--color-text-primary)]"
                >
                  <Share2 size={14} />
                  分享
                </button>
                <label className="flex items-center gap-2 px-3 py-1.5 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white rounded-lg cursor-pointer transition-colors text-sm">
                  <Upload size={14} />
                  上传文档
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.doc,.docx,.txt,.md"
                    onChange={handleUpload}
                    className="hidden"
                    disabled={uploading}
                  />
                </label>
              </div>
            </div>

            {/* Tabs */}
            <div className="border-b border-[var(--color-border)] px-6">
              <div className="flex gap-6">
                <button
                  onClick={() => setActiveTab('docs')}
                  className={`py-3 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === 'docs'
                      ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                      : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                  }`}
                >
                  文档列表
                </button>
                <button
                  onClick={() => setActiveTab('chat')}
                  className={`py-3 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === 'chat'
                      ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                      : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                  }`}
                >
                  智能问答
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              {activeTab === 'docs' ? (
                <div className="p-6">
                  {uploading && (
                    <div className="mb-4 p-4 bg-blue-500/10 border border-blue-500/30 rounded-xl flex items-center gap-3">
                      <Loader size={20} className="text-blue-400 animate-spin" />
                      <span className="text-sm text-blue-400">正在上传并处理文档...</span>
                    </div>
                  )}

                  {documents.length === 0 ? (
                    <div className="text-center py-16">
                      <FileText size={40} className="mx-auto text-[var(--color-text-muted)] mb-4 opacity-50" />
                      <p className="text-[var(--color-text-secondary)] mb-4">暂无文档</p>
                      <label className="inline-flex items-center gap-2 px-5 py-2.5 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white rounded-lg cursor-pointer transition-colors text-sm">
                        <Upload size={16} />
                        上传第一个文档
                        <input
                          type="file"
                          multiple
                          accept=".pdf,.doc,.docx,.txt,.md"
                          onChange={handleUpload}
                          className="hidden"
                        />
                      </label>
                      <p className="text-xs text-[var(--color-text-muted)] mt-3">
                        支持 PDF、Word、TXT、Markdown 格式
                      </p>
                    </div>
                  ) : (
                    <div className="grid gap-3">
                      {documents.map((doc) => (
                        <div
                          key={doc.id}
                          className="flex items-center gap-4 p-4 bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-xl hover:border-[var(--color-primary)]/50 transition-colors group"
                        >
                          <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                            <FileText size={20} className="text-blue-400" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="text-sm font-medium text-white truncate">{doc.filename}</h3>
                            <div className="flex items-center gap-4 mt-1">
                              <span className="text-xs text-[var(--color-text-muted)]">
                                {formatFileSize(doc.file_size)}
                              </span>
                              <span className={`text-xs flex items-center gap-1 ${getStatusColor(doc.status)}`}>
                                {getStatusIcon(doc.status)}
                                {doc.status === 'completed'
                                  ? '处理完成'
                                  : doc.status === 'processing'
                                  ? '处理中'
                                  : doc.status === 'failed'
                                  ? '处理失败'
                                  : doc.status}
                              </span>
                              {doc.chunk_count > 0 && (
                                <span className="text-xs text-[var(--color-text-muted)]">
                                  {doc.chunk_count} 个片段
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1">
                            <button
                              onClick={() => openDocEditor(doc)}
                              className="p-2 hover:bg-blue-500/20 rounded-lg transition-all"
                              title="编辑文档"
                            >
                              <Edit3 size={16} className="text-blue-400" />
                            </button>
                            <button
                              onClick={() => docToNote(doc)}
                              className="p-2 hover:bg-emerald-500/20 rounded-lg transition-all"
                              title="转为笔记"
                            >
                              <BookmarkPlus size={16} className="text-emerald-400" />
                            </button>
                            <button
                              onClick={() => handleDeleteDoc(doc.id)}
                              className="p-2 hover:bg-red-500/20 rounded-lg transition-all"
                            >
                              <Trash2 size={16} className="text-red-400" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-6 h-full flex flex-col">
                  {/* Chat area for RAG */}
                  <div className="flex-1 max-w-3xl mx-auto w-full">
                    {chatAnswer ? (
                      <div className="bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-xl p-5 mb-4">
                        <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                          <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                          </svg>
                          AI 回答
                        </h3>
                        <div className="text-sm text-[var(--color-text-primary)] whitespace-pre-wrap">
                          {isSearching && !chatAnswer ? (
                            <div className="flex gap-1">
                              <span className="typing-dot w-2 h-2 bg-[var(--color-text-muted)] rounded-full"></span>
                              <span className="typing-dot w-2 h-2 bg-[var(--color-text-muted)] rounded-full"></span>
                              <span className="typing-dot w-2 h-2 bg-[var(--color-text-muted)] rounded-full"></span>
                            </div>
                          ) : (
                            chatAnswer
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-12">
                        <BookOpen size={36} className="mx-auto text-[var(--color-text-muted)] mb-4 opacity-50" />
                        <p className="text-[var(--color-text-secondary)]">
                          基于知识库内容进行智能问答
                        </p>
                        <p className="text-sm text-[var(--color-text-muted)] mt-1">
                          已有 {documents.length} 个文档可供检索
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Input */}
                  <div className="max-w-3xl mx-auto w-full mt-auto">
                    <div className="bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-2xl focus-within:border-[var(--color-primary)] transition-colors">
                      <textarea
                        value={chatQuery}
                        onChange={(e) => setChatQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleRagSearch();
                          }
                        }}
                        placeholder="输入问题，基于知识库内容获取答案..."
                        rows={2}
                        className="w-full px-4 py-3 bg-transparent text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] resize-none outline-none text-sm"
                        disabled={isSearching}
                      />
                      <div className="flex items-center justify-between px-4 pb-3">
                        <span className="text-xs text-[var(--color-text-muted)]">
                          基于「{selectedKb.name}」知识库
                        </span>
                        <button
                          onClick={handleRagSearch}
                          disabled={!chatQuery.trim() || isSearching}
                          className="flex items-center gap-2 px-4 py-2 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] disabled:bg-[var(--color-text-muted)] disabled:cursor-not-allowed text-white rounded-lg transition-colors text-sm font-medium"
                        >
                          {isSearching ? '搜索中...' : '搜索'}
                          <Search size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Create KB Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-white">创建知识库</h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1 hover:bg-[var(--color-sidebar-hover)] rounded-lg transition-colors"
              >
                <X size={20} className="text-[var(--color-text-muted)]" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-[var(--color-text-secondary)] mb-2">知识库名称</label>
                <input
                  type="text"
                  value={newKbName}
                  onChange={(e) => setNewKbName(e.target.value)}
                  placeholder="输入知识库名称"
                  className="w-full px-4 py-2.5 bg-[var(--color-main-bg)] border border-[var(--color-border)] rounded-lg text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)]"
                />
              </div>
              <div>
                <label className="block text-sm text-[var(--color-text-secondary)] mb-2">描述（可选）</label>
                <textarea
                  value={newKbDesc}
                  onChange={(e) => setNewKbDesc(e.target.value)}
                  placeholder="简要描述这个知识库的用途"
                  rows={3}
                  className="w-full px-4 py-2.5 bg-[var(--color-main-bg)] border border-[var(--color-border)] rounded-lg text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)] resize-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 bg-[var(--color-sidebar-hover)] hover:bg-[var(--color-border)] text-[var(--color-text-primary)] rounded-lg transition-colors text-sm"
              >
                取消
              </button>
              <button
                onClick={handleCreateKb}
                disabled={!newKbName.trim()}
                className="px-4 py-2 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors text-sm"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share Modal */}
      {showShareModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-2xl w-full max-w-lg p-6 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-white">分享知识库</h3>
              <button
                onClick={() => setShowShareModal(false)}
                className="p-1 hover:bg-[var(--color-sidebar-hover)] rounded-lg transition-colors"
              >
                <X size={20} className="text-[var(--color-text-muted)]" />
              </button>
            </div>

            {/* Share Link */}
            <div className="mb-6">
              <h4 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                <Link size={16} />
                分享链接
              </h4>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={shareLink}
                  readOnly
                  className="flex-1 px-4 py-2.5 bg-[var(--color-main-bg)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-primary)] outline-none"
                />
                <button
                  onClick={handleCopyLink}
                  className="px-4 py-2.5 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white rounded-lg transition-colors text-sm flex items-center gap-2"
                >
                  {copied ? <CheckCircle size={16} /> : <Copy size={16} />}
                  {copied ? '已复制' : '复制'}
                </button>
              </div>
              <p className="text-xs text-[var(--color-text-muted)] mt-2">
                链接有效期 7 天，拥有链接的用户可查看知识库内容
              </p>
            </div>

            {/* Collaborators */}
            <div>
              <h4 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                <Users size={16} />
                协作者管理
              </h4>
              <div className="space-y-2 mb-4">
                {collaborators.length === 0 ? (
                  <p className="text-sm text-[var(--color-text-muted)] text-center py-4">
                    暂无协作者
                  </p>
                ) : (
                  collaborators.map((collab) => (
                    <div
                      key={collab.id}
                      className="flex items-center justify-between p-3 bg-[var(--color-main-bg)] border border-[var(--color-border)] rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-400 to-pink-500 flex items-center justify-center text-white text-xs">
                          {collab.user_email?.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-sm text-[var(--color-text-primary)]">
                          {collab.user_email}
                        </span>
                      </div>
                      <span
                        className={`text-xs px-2 py-1 rounded-full ${
                          collab.permission === 'write'
                            ? 'bg-blue-500/20 text-blue-400'
                            : 'bg-gray-500/20 text-gray-400'
                        }`}
                      >
                        {collab.permission === 'write' ? '可编辑' : '只读'}
                      </span>
                    </div>
                  ))
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type="email"
                  placeholder="输入协作者邮箱"
                  className="flex-1 px-4 py-2.5 bg-[var(--color-main-bg)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)]"
                />
                <select className="px-3 py-2.5 bg-[var(--color-main-bg)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-primary)] outline-none">
                  <option value="read">只读</option>
                  <option value="write">可编辑</option>
                </select>
                <button className="px-4 py-2.5 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white rounded-lg transition-colors text-sm">
                  邀请
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Edit Document Modal */}
      {editingDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-2xl shadow-2xl flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
              <h3 className="text-base font-medium text-white">编辑文档</h3>
              <button
                onClick={() => setEditingDoc(null)}
                className="p-2 hover:bg-[var(--color-hover-bg)] rounded-lg transition-colors"
              >
                <X size={18} className="text-[var(--color-text-secondary)]" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto flex-1 space-y-4">
              <div>
                <label className="block text-sm text-[var(--color-text-secondary)] mb-2">文档名称</label>
                <input
                  type="text"
                  value={editDocFilename}
                  onChange={(e) => setEditDocFilename(e.target.value)}
                  className="w-full px-4 py-2.5 bg-[var(--color-main-bg)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)]"
                />
              </div>
              <div>
                <label className="block text-sm text-[var(--color-text-secondary)] mb-2">正文内容</label>
                {isLoadingDocContent ? (
                  <div className="flex items-center justify-center py-20 text-[var(--color-text-muted)] text-sm">
                    <Loader size={18} className="animate-spin mr-2" />
                    加载中...
                  </div>
                ) : (
                  <textarea
                    value={editDocContent}
                    onChange={(e) => setEditDocContent(e.target.value)}
                    rows={18}
                    className="w-full px-4 py-3 bg-[var(--color-main-bg)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)] resize-none font-mono"
                    placeholder="在这里编辑文档内容..."
                  />
                )}
              </div>
              <p className="text-xs text-[var(--color-text-muted)]">
                保存后将自动重新分块并向量化。当前文档共 {editingDoc.chunk_count || 0} 个片段。
              </p>
            </div>
            <div className="flex items-center justify-end gap-3 p-5 border-t border-[var(--color-border)]">
              <button
                onClick={() => setEditingDoc(null)}
                className="px-4 py-2.5 bg-[var(--color-hover-bg)] hover:bg-[var(--color-border)] text-[var(--color-text-primary)] rounded-lg transition-colors text-sm"
              >
                取消
              </button>
              <button
                onClick={saveDocEdit}
                disabled={isSavingDoc || isLoadingDocContent || !editDocContent.trim()}
                className="flex items-center gap-2 px-4 py-2.5 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors text-sm"
              >
                {isSavingDoc ? <Loader size={16} className="animate-spin" /> : <Save size={16} />}
                保存更改
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Note Modal */}
      {showImportNoteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-2xl shadow-2xl flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
              <h3 className="text-base font-medium text-white">将笔记导入知识库</h3>
              <button
                onClick={() => setShowImportNoteModal(false)}
                className="p-2 hover:bg-[var(--color-hover-bg)] rounded-lg transition-colors"
              >
                <X size={18} className="text-[var(--color-text-secondary)]" />
              </button>
            </div>
            <div className="p-4 border-b border-[var(--color-border)]">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                <input
                  type="text"
                  placeholder="搜索笔记..."
                  value={importSearch}
                  onChange={(e) => { setImportSearch(e.target.value); }}
                  onKeyUp={(e) => e.key === 'Enter' && loadNotesForImport()}
                  className="w-full pl-9 pr-4 py-2.5 bg-[var(--color-main-bg)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)]"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {importNotes.length === 0 ? (
                <div className="py-12 text-center text-[var(--color-text-muted)] text-sm">
                  暂无笔记，先去创建一篇吧
                </div>
              ) : (
                importNotes.map((note: any) => (
                  <div
                    key={note.id}
                    onClick={() => setSelectedNoteImport(note.id)}
                    className={`p-3 rounded-lg cursor-pointer transition-colors ${
                      selectedNoteImport === note.id
                        ? 'bg-[var(--color-primary)]/15 border border-[var(--color-primary)]/50'
                        : 'hover:bg-[var(--color-hover-bg)] border border-transparent'
                    }`}
                  >
                    <h4 className="text-sm font-medium text-white truncate">{note.title || '无标题'}</h4>
                    <p className="text-xs text-[var(--color-text-muted)] mt-1 line-clamp-2">
                      {note.content ? note.content.slice(0, 80) : '(空内容)'}
                    </p>
                    {note.tags?.length > 0 && (
                      <div className="flex gap-1.5 mt-2">
                        {note.tags.slice(0, 3).map((t: string) => (
                          <span key={t} className="text-[10px] px-2 py-0.5 bg-[var(--color-hover-bg)] text-[var(--color-text-secondary)] rounded">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
            <div className="flex items-center justify-end gap-3 p-4 border-t border-[var(--color-border)]">
              <button
                onClick={() => setShowImportNoteModal(false)}
                className="px-4 py-2.5 bg-[var(--color-hover-bg)] hover:bg-[var(--color-border)] text-[var(--color-text-primary)] rounded-lg transition-colors text-sm"
              >
                取消
              </button>
              <button
                onClick={doImportNote}
                disabled={!selectedNoteImport || isImporting}
                className="flex items-center gap-2 px-4 py-2.5 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors text-sm"
              >
                {isImporting ? <Loader size={16} className="animate-spin" /> : <Upload size={16} />}
                导入
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default KnowledgePage;
