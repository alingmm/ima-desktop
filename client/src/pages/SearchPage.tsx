import { useEffect, useState } from 'react';
import { Search, ExternalLink, Clock, Sparkles, Loader, Globe, Database, BookmarkPlus, ChevronLeft, Link as LinkIcon, Copy, Check, Trash2, X, StickyNote, CheckSquare, Square } from 'lucide-react';
import { searchApi, knowledgeApi } from '../api';
import type { SearchResult, BrowseResult, KnowledgeBase } from '../types';
import { useToast, showApiError } from '../components/Toast';

type TabType = 'search' | 'browse';

function SearchPage() {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<TabType>('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [summary, setSummary] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // 搜索历史（后端落库）
  const [history, setHistory] = useState<{ id: string; query: string; created_at: string }[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [deletingHistoryId, setDeletingHistoryId] = useState<string | null>(null);

  // 搜索结果多选 + 导入知识库/转笔记
  const [selectedResults, setSelectedResults] = useState<Set<number>>(new Set());
  const [showImportModal, setShowImportModal] = useState(false);
  const [importItems, setImportItems] = useState<{ title: string; url: string; content: string }[]>([]);
  const [importBases, setImportBases] = useState<KnowledgeBase[]>([]);
  const [loadingImportBases, setLoadingImportBases] = useState(false);
  const [selectedImportBaseId, setSelectedImportBaseId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [savingNote, setSavingNote] = useState(false);

  // Browse state
  const [browseUrl, setBrowseUrl] = useState('');
  const [browseResult, setBrowseResult] = useState<BrowseResult | null>(null);
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [showIframe, setShowIframe] = useState(true);
  const [showAddToKbModal, setShowAddToKbModal] = useState(false);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [selectedBaseId, setSelectedBaseId] = useState<string | null>(null);
  const [newBaseName, setNewBaseName] = useState('');
  const [showNewBaseInput, setShowNewBaseInput] = useState(false);
  const [addingToKb, setAddingToKb] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadHistory = async () => {
    try {
      setLoadingHistory(true);
      const res = await searchApi.getHistory();
      setHistory(res.history || []);
    } catch (error: any) {
      console.error('Load history failed:', error);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const handleSearch = async (overrideQuery?: string) => {
    const q = (overrideQuery ?? query).trim();
    if (!q) return;
    if (overrideQuery) setQuery(overrideQuery);
    try {
      setIsSearching(true);
      setHasSearched(true);
      setSelectedResults(new Set());
      const res = await searchApi.webSearch(q);
      setResults(res.results || []);
      setSummary('');
      loadHistory(); // 搜索成功后刷新历史（后端已去重落库）
    } catch (error: any) {
      console.error('Search failed:', error);
      showApiError(error, toast);
    } finally {
      setIsSearching(false);
    }
  };

  // 历史：单条删除
  const handleDeleteHistory = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      setDeletingHistoryId(id);
      await searchApi.deleteHistory(id);
      setHistory((prev) => prev.filter((h) => h.id !== id));
      toast.success('已删除该条历史');
    } catch (error: any) {
      showApiError(error, toast);
    } finally {
      setDeletingHistoryId(null);
    }
  };

  // 历史：清空
  const handleClearHistory = async () => {
    try {
      setClearingHistory(true);
      await searchApi.clearHistory();
      setHistory([]);
      toast.success('已清空搜索历史');
    } catch (error: any) {
      showApiError(error, toast);
    } finally {
      setClearingHistory(false);
    }
  };

  // 多选切换
  const toggleResultSelect = (idx: number) => {
    setSelectedResults((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const toImportItems = (list: SearchResult[]) =>
    list.map((r) => ({ title: r.title, url: r.url || '', content: r.snippet || '' }));

  // 打开导入知识库弹窗（单条或多选）
  const openImportModal = async (items: { title: string; url: string; content: string }[]) => {
    setImportItems(items);
    setSelectedImportBaseId(null);
    setShowImportModal(true);
    try {
      setLoadingImportBases(true);
      const res = await knowledgeApi.getBases();
      setImportBases(res.bases || []);
    } catch (err: any) {
      showApiError(err, toast);
      setImportBases([]);
    } finally {
      setLoadingImportBases(false);
    }
  };

  // 导入知识库
  const handleImportToKb = async () => {
    if (!selectedImportBaseId || importItems.length === 0) return;
    try {
      setImporting(true);
      const res = await searchApi.importToKb(
        selectedImportBaseId,
        importItems,
        `联网搜索：${query.trim() || importItems[0]?.title || '搜索结果'}`
      );
      setShowImportModal(false);
      setSelectedResults(new Set());
      if (res.embedding_ready) {
        toast.success(`已导入知识库并完成向量化（${res.chunk_count ?? importItems.length} 个分块）`);
      } else {
        toast.warning(
          `已导入知识库，但未向量化：${res.embed_error_message || '请先在设置页配置向量模型'}`
        );
      }
    } catch (error: any) {
      showApiError(error, toast);
    } finally {
      setImporting(false);
    }
  };

  // 转笔记（单条或多选）
  const handleSaveToNote = async (items: { title: string; url: string; content: string }[]) => {
    if (items.length === 0) return;
    try {
      setSavingNote(true);
      await searchApi.toNote(
        items,
        `联网搜索：${query.trim() || items[0]?.title || '搜索结果'}`
      );
      setSelectedResults(new Set());
      toast.success('已保存到笔记');
    } catch (error: any) {
      showApiError(error, toast);
    } finally {
      setSavingNote(false);
    }
  };

  const handleSummary = async () => {
    if (!query.trim() || results.length === 0) return;
    try {
      setIsSummarizing(true);
      setSummary('');

      const response = await fetch('/api/search/summarize/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query.trim(),
          results: results.slice(0, 5),
        }),
      });

      if (!response.ok) throw new Error('Summary failed');

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(l => l.trim());

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content) {
                fullText += data.content;
                setSummary(fullText);
              }
            } catch (e) {
              // skip non-JSON lines
            }
          }
        }
      }
    } catch (error: any) {
      console.error('Summary failed:', error);
      showApiError(error, toast);
    } finally {
      setIsSummarizing(false);
    }
  };

  // Browse functions
  const handleBrowse = async () => {
    if (!browseUrl.trim()) return;
    let url = browseUrl.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    try {
      setIsBrowsing(true);
      const res = await searchApi.browse(url);
      setBrowseResult(res);
    } catch (error: any) {
      console.error('Browse failed:', error);
      showApiError(error, toast);
    } finally {
      setIsBrowsing(false);
    }
  };

  const openAddToKbModal = async () => {
    try {
      const res = await knowledgeApi.getBases();
      setKnowledgeBases(res.bases);
      setSelectedBaseId(null);
      setNewBaseName('');
      setShowNewBaseInput(false);
      setShowAddToKbModal(true);
    } catch (err) {
      console.error('Failed to load knowledge bases:', err);
    }
  };

  const handleAddToKnowledgeBase = async () => {
    if (!browseResult || (!selectedBaseId && !newBaseName.trim())) return;

    try {
      setAddingToKb(true);
      // 如果是新建知识库，先创建
      let baseId = selectedBaseId;
      if (!baseId && newBaseName.trim()) {
        const res = await knowledgeApi.createBase(newBaseName.trim(), '从网页添加');
        baseId = res.base.id;
      }
      if (!baseId) return;

      await knowledgeApi.addFromUrl(baseId, browseResult.url, browseResult.title);
      setShowAddToKbModal(false);
      setAddingToKb(false);
      // 显示成功提示
      const toast = document.createElement('div');
      toast.className = 'fixed top-4 right-4 bg-green-500 text-white px-4 py-2 rounded-lg z-50 text-sm';
      toast.textContent = '已添加到知识库，正在向量化处理';
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 2500);
    } catch (err) {
      console.error('Failed to add to knowledge base:', err);
      setAddingToKb(false);
      alert('添加失败，请重试');
    }
  };

  const copyContent = () => {
    if (!browseResult) return;
    navigator.clipboard.writeText(browseResult.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const quickBrowseFromSearch = (url?: string) => {
    if (!url) return;
    setBrowseUrl(url);
    setActiveTab('browse');
    setTimeout(() => handleBrowse(), 100);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header with tabs */}
      <div className="border-b border-[var(--color-border)] flex items-center px-6 gap-6">
        <button
          onClick={() => setActiveTab('search')}
          className={`py-3 px-1 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'search'
              ? 'border-blue-500 text-white'
              : 'border-transparent text-[var(--color-text-muted)] hover:text-white'
          }`}
        >
          <Search size={16} />
          搜索
        </button>
        <button
          onClick={() => setActiveTab('browse')}
          className={`py-3 px-1 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'browse'
              ? 'border-blue-500 text-white'
              : 'border-transparent text-[var(--color-text-muted)] hover:text-white'
          }`}
        >
          <Globe size={16} />
          浏览
        </button>
      </div>

      {activeTab === 'search' ? (
        // ============ Search Tab ============
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Search area */}
          <div className="p-8 border-b border-[var(--color-border)]">
            <div className="max-w-2xl mx-auto">
              {!hasSearched && (
                <div className="text-center mb-8">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center">
                    <Search size={28} className="text-white" />
                  </div>
                  <h1 className="text-2xl font-semibold text-white mb-2">智能搜索</h1>
                  <p className="text-[var(--color-text-secondary)]">
                    全网搜索 + AI 智能总结，高效获取信息
                  </p>
                </div>
              )}

              <div className="flex gap-3">
                <div className="flex-1 relative">
                  <Search
                    size={18}
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
                  />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    placeholder="输入关键词搜索..."
                    className="w-full h-12 pl-12 pr-4 bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-xl text-white placeholder-[var(--color-text-muted)] focus:outline-none focus:border-blue-500 transition-colors"
                  />
                </div>
                <button
                  onClick={() => handleSearch()}
                  disabled={isSearching || !query.trim()}
                  className="px-6 h-12 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-xl font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isSearching ? (
                    <Loader size={18} className="animate-spin" />
                  ) : (
                    <Search size={18} />
                  )}
                  搜索
                </button>
              </div>

              {hasSearched && results.length > 0 && !summary && (
                <button
                  onClick={handleSummary}
                  disabled={isSummarizing}
                  className="mt-4 flex items-center gap-2 px-4 py-2 text-sm text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                >
                  <Sparkles size={16} />
                  {isSummarizing ? 'AI总结中...' : 'AI 智能总结'}
                </button>
              )}
            </div>
          </div>

          {/* Results */}
          <div className="flex-1 overflow-y-auto">
            {isSearching ? (
              <div className="flex flex-col items-center justify-center py-20">
                <Loader size={32} className="animate-spin text-blue-500 mb-4" />
                <p className="text-[var(--color-text-muted)]">正在搜索中...</p>
              </div>
            ) : hasSearched && results.length > 0 ? (
              <div className="max-w-3xl mx-auto p-6">
                {(summary || isSummarizing) && (
                  <div className="bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-2xl p-6 mb-6">
                    <div className="flex items-center gap-2 mb-4">
                      <Sparkles size={20} className="text-purple-400" />
                      <h3 className="font-medium text-white">AI 智能总结</h3>
                      {isSummarizing && <Loader size={16} className="animate-spin text-blue-400" />}
                    </div>
                    <div className="text-[var(--color-text-primary)] leading-relaxed whitespace-pre-wrap">
                      {summary}
                      {isSummarizing && <span className="animate-pulse">▌</span>}
                    </div>
                  </div>
                )}

                {/* 多选操作栏 */}
                {selectedResults.size > 0 && (
                  <div className="flex items-center gap-3 mb-4 px-4 py-3 bg-blue-500/10 border border-blue-500/30 rounded-xl">
                    <span className="text-sm text-blue-300">已选 {selectedResults.size} 条</span>
                    <button
                      onClick={() =>
                        openImportModal(toImportItems(results.filter((_, i) => selectedResults.has(i))))
                      }
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 rounded-lg text-xs transition-colors"
                    >
                      <Database size={14} />
                      导入知识库
                    </button>
                    <button
                      onClick={() =>
                        handleSaveToNote(toImportItems(results.filter((_, i) => selectedResults.has(i))))
                      }
                      disabled={savingNote}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 rounded-lg text-xs transition-colors disabled:opacity-50"
                    >
                      {savingNote ? <Loader size={14} className="animate-spin" /> : <StickyNote size={14} />}
                      转为笔记
                    </button>
                    <button
                      onClick={() => setSelectedResults(new Set())}
                      className="ml-auto text-xs text-[var(--color-text-muted)] hover:text-white transition-colors"
                    >
                      取消选择
                    </button>
                  </div>
                )}

                <h3 className="text-lg font-medium text-white mb-4">搜索结果</h3>
                <div className="space-y-4">
                  {results.map((result, idx) => {
                    const selected = selectedResults.has(idx);
                    return (
                      <div
                        key={idx}
                        className={`bg-[var(--color-card-bg)] border rounded-xl p-4 transition-colors ${
                          selected
                            ? 'border-blue-500/60 bg-blue-500/5'
                            : 'border-[var(--color-border)] hover:border-blue-500/30'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <button
                            onClick={() => toggleResultSelect(idx)}
                            className="mt-0.5 text-[var(--color-text-muted)] hover:text-blue-400 transition-colors flex-shrink-0"
                            title={selected ? '取消选择' : '选择'}
                          >
                            {selected ? (
                              <CheckSquare size={18} className="text-blue-400" />
                            ) : (
                              <Square size={18} />
                            )}
                          </button>
                          <div className="flex-1 min-w-0">
                            <a
                              href={result.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-400 hover:underline flex items-center gap-2 mb-2"
                            >
                              {result.title}
                              <ExternalLink size={14} />
                            </a>
                            <p className="text-sm text-[var(--color-text-secondary)] line-clamp-2">
                              {result.snippet}
                            </p>
                            <div className="flex items-center justify-between mt-3 gap-2">
                              <span className="text-xs text-[var(--color-text-muted)] truncate">{result.url}</span>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <button
                                  onClick={() => openImportModal(toImportItems([result]))}
                                  className="text-xs text-[var(--color-text-muted)] hover:text-blue-400 flex items-center gap-1 px-2 py-1 rounded hover:bg-blue-500/10 transition-colors"
                                  title="导入知识库"
                                >
                                  <Database size={12} />
                                  入库
                                </button>
                                <button
                                  onClick={() => handleSaveToNote(toImportItems([result]))}
                                  disabled={savingNote}
                                  className="text-xs text-[var(--color-text-muted)] hover:text-purple-400 flex items-center gap-1 px-2 py-1 rounded hover:bg-purple-500/10 transition-colors disabled:opacity-50"
                                  title="转为笔记"
                                >
                                  <StickyNote size={12} />
                                  转笔记
                                </button>
                                <button
                                  onClick={() => quickBrowseFromSearch(result.url)}
                                  className="text-xs text-[var(--color-text-muted)] hover:text-blue-400 flex items-center gap-1 px-2 py-1 rounded hover:bg-blue-500/10 transition-colors"
                                >
                                  <Globe size={12} />
                                  浏览
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : hasSearched && results.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20">
                <Search size={48} className="text-[var(--color-text-muted)] mb-4 opacity-30" />
                <p className="text-[var(--color-text-muted)]">未找到相关结果</p>
              </div>
            ) : (
              !hasSearched && (
                <div className="max-w-2xl mx-auto p-6">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm text-[var(--color-text-muted)] flex items-center gap-2">
                      <Clock size={16} />
                      搜索历史
                    </h3>
                    {history.length > 0 && (
                      <button
                        onClick={handleClearHistory}
                        disabled={clearingHistory}
                        className="text-xs text-[var(--color-text-muted)] hover:text-red-400 flex items-center gap-1 transition-colors disabled:opacity-50"
                      >
                        {clearingHistory ? (
                          <Loader size={12} className="animate-spin" />
                        ) : (
                          <Trash2 size={12} />
                        )}
                        清空历史
                      </button>
                    )}
                  </div>
                  {loadingHistory ? (
                    <div className="flex items-center gap-2 py-4 text-sm text-[var(--color-text-muted)]">
                      <Loader size={14} className="animate-spin" />
                      正在加载历史...
                    </div>
                  ) : history.length === 0 ? (
                    <p className="text-sm text-[var(--color-text-muted)] py-2">暂无搜索历史</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {history.map((item) => (
                        <div
                          key={item.id}
                          className="group flex items-center gap-1 pl-3 pr-1.5 py-1.5 bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-full text-sm hover:border-blue-500/50 transition-colors"
                        >
                          <button
                            onClick={() => handleSearch(item.query)}
                            className="text-[var(--color-text-secondary)] hover:text-white transition-colors"
                            title="重新搜索"
                          >
                            {item.query}
                          </button>
                          <button
                            onClick={(e) => handleDeleteHistory(item.id, e)}
                            disabled={deletingHistoryId === item.id}
                            className="p-0.5 text-[var(--color-text-muted)] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all disabled:opacity-50"
                            title="删除该条"
                          >
                            {deletingHistoryId === item.id ? (
                              <Loader size={12} className="animate-spin" />
                            ) : (
                              <X size={12} />
                            )}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            )}
          </div>
        </div>
      ) : (
        // ============ Browse Tab ============
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* URL Bar */}
          <div className="p-4 border-b border-[var(--color-border)]">
            <div className="max-w-4xl mx-auto flex gap-3">
              <div className="flex-1 relative">
                <LinkIcon
                  size={16}
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
                />
                <input
                  type="text"
                  value={browseUrl}
                  onChange={(e) => setBrowseUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleBrowse()}
                  placeholder="输入网址，例如 https://example.com"
                  className="w-full h-10 pl-10 pr-4 bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-lg text-white placeholder-[var(--color-text-muted)] focus:outline-none focus:border-blue-500 transition-colors text-sm"
                />
              </div>
              <button
                onClick={handleBrowse}
                disabled={isBrowsing || !browseUrl.trim()}
                className="px-5 h-10 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 text-sm"
              >
                {isBrowsing ? (
                  <Loader size={16} className="animate-spin" />
                ) : (
                  <Globe size={16} />
                )}
                访问
              </button>
            </div>
          </div>

          {/* Browse Content Area */}
          <div className="flex-1 overflow-hidden">
            {!browseResult && !isBrowsing ? (
              <div className="h-full flex flex-col items-center justify-center text-[var(--color-text-muted)]">
                <Globe size={64} className="mb-4 opacity-20" />
                <p className="text-lg mb-2">网页浏览</p>
                <p className="text-sm">输入网址开始浏览网页内容</p>
                <div className="mt-6 space-y-2">
                  <p className="text-xs text-[var(--color-text-muted)] mb-2">快速访问示例：</p>
                  <div className="flex gap-2 flex-wrap justify-center">
                    {['https://www.zhihu.com', 'https://www.github.com', 'https://www.wikipedia.org'].map((url, i) => (
                      <button
                        key={i}
                        onClick={() => { setBrowseUrl(url); handleBrowse(); }}
                        className="px-3 py-1.5 bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-full text-xs hover:border-blue-500/50 hover:text-white transition-colors"
                      >
                        {url.replace('https://', '')}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : isBrowsing ? (
              <div className="h-full flex flex-col items-center justify-center">
                <Loader size={32} className="animate-spin text-blue-500 mb-4" />
                <p className="text-[var(--color-text-muted)]">正在加载网页...</p>
              </div>
            ) : browseResult ? (
              <div className="h-full flex flex-col">
                {/* Toolbar */}
                <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-card-bg)]">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowIframe(!showIframe)}
                      className={`px-3 py-1.5 rounded-md text-xs transition-colors ${
                        showIframe ? 'bg-blue-500/20 text-blue-400' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-sidebar-hover)]'
                      }`}
                    >
                      网页预览
                    </button>
                    <button
                      onClick={() => setShowIframe(!showIframe)}
                      className={`px-3 py-1.5 rounded-md text-xs transition-colors ${
                        !showIframe ? 'bg-blue-500/20 text-blue-400' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-sidebar-hover)]'
                      }`}
                    >
                      文本提取
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={copyContent}
                      className="p-1.5 text-[var(--color-text-muted)] hover:text-white hover:bg-[var(--color-sidebar-hover)] rounded-md transition-colors"
                      title="复制正文"
                    >
                      {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
                    </button>
                    <button
                      onClick={openAddToKbModal}
                      className="px-3 py-1.5 bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 rounded-md transition-colors text-xs flex items-center gap-1.5"
                    >
                      <Database size={14} />
                      加入知识库
                    </button>
                    <a
                      href={browseResult.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 text-[var(--color-text-muted)] hover:text-white hover:bg-[var(--color-sidebar-hover)] rounded-md transition-colors"
                      title="新窗口打开"
                    >
                      <ExternalLink size={16} />
                    </a>
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-hidden">
                  {showIframe ? (
                    <iframe
                      src={browseResult.url}
                      title={browseResult.title}
                      className="w-full h-full bg-white"
                      sandbox="allow-scripts allow-same-origin allow-forms"
                    />
                  ) : (
                    <div className="h-full overflow-y-auto p-6">
                      <div className="max-w-4xl mx-auto">
                        <h1 className="text-2xl font-bold text-white mb-2">{browseResult.title}</h1>
                        {browseResult.description && (
                          <p className="text-[var(--color-text-secondary)] mb-6">{browseResult.description}</p>
                        )}
                        <div className="flex items-center gap-4 mb-6 text-xs text-[var(--color-text-muted)]">
                          <span className="flex items-center gap-1">
                            <LinkIcon size={12} />
                            {browseResult.url}
                          </span>
                          <span>{(browseResult.content_length / 1024).toFixed(1)} KB 文本</span>
                          {browseResult.is_truncated && <span className="text-yellow-400">内容已截断</span>}
                        </div>
                        <div className="bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-xl p-6">
                          <pre className="whitespace-pre-wrap text-sm text-[var(--color-text-primary)] leading-relaxed font-sans">
                            {browseResult.content}
                          </pre>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Add to Knowledge Base Modal */}
      {showAddToKbModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowAddToKbModal(false)}>
          <div
            className="bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-2xl w-full max-w-md mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
              <h3 className="font-medium text-white">添加到知识库</h3>
              <button
                onClick={() => setShowAddToKbModal(false)}
                className="p-1.5 hover:bg-[var(--color-sidebar-hover)] rounded-lg text-[var(--color-text-muted)] transition-colors"
              >
                <ChevronLeft size={18} />
              </button>
            </div>

            <div className="p-5 max-h-96 overflow-y-auto">
              <div className="mb-4">
                <button
                  onClick={() => setShowNewBaseInput(!showNewBaseInput)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-500/20 to-purple-500/20 border border-blue-500/30 text-blue-400 rounded-lg hover:from-blue-500/30 hover:to-purple-500/30 transition-all text-sm font-medium"
                >
                  <BookmarkPlus size={16} />
                  创建新知识库
                </button>
                {showNewBaseInput && (
                  <input
                    type="text"
                    value={newBaseName}
                    onChange={(e) => { setNewBaseName(e.target.value); setSelectedBaseId(null); }}
                    placeholder="输入知识库名称..."
                    className="w-full mt-3 px-4 py-2.5 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg text-white text-sm outline-none focus:border-blue-500"
                    autoFocus
                  />
                )}
              </div>

              <div className="relative">
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex-1 h-px bg-[var(--color-border)]"></div>
                  <span className="text-xs text-[var(--color-text-muted)]">或选择已有知识库</span>
                  <div className="flex-1 h-px bg-[var(--color-border)]"></div>
                </div>
              </div>

              <div className="space-y-2">
                {knowledgeBases.length === 0 ? (
                  <p className="text-center text-[var(--color-text-muted)] text-sm py-4">
                    暂无知识库
                  </p>
                ) : (
                  knowledgeBases.map((base) => (
                    <div
                      key={base.id}
                      onClick={() => { setSelectedBaseId(base.id); setShowNewBaseInput(false); setNewBaseName(''); }}
                      className={`flex items-center gap-3 px-4 py-3 rounded-lg cursor-pointer transition-all border ${
                        selectedBaseId === base.id
                          ? 'bg-blue-500/20 border-blue-500/50'
                          : 'bg-[var(--color-bg-secondary)] border-[var(--color-border)] hover:border-blue-500/30'
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        selectedBaseId === base.id ? 'bg-blue-500/30 text-blue-400' : 'bg-[var(--color-card-bg)] text-[var(--color-text-muted)]'
                      }`}>
                        <Database size={16} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{base.name}</p>
                        <p className="text-xs text-[var(--color-text-muted)] truncate">{base.description || '暂无描述'}</p>
                      </div>
                      {selectedBaseId === base.id && (
                        <Check size={18} className="text-blue-400 flex-shrink-0" />
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 px-5 py-4 border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
              <button
                onClick={() => setShowAddToKbModal(false)}
                className="flex-1 px-4 py-2.5 text-[var(--color-text-muted)] hover:text-white hover:bg-[var(--color-sidebar-hover)] rounded-lg transition-colors text-sm"
              >
                取消
              </button>
              <button
                onClick={handleAddToKnowledgeBase}
                disabled={addingToKb || (!selectedBaseId && !newBaseName.trim())}
                className="flex-1 px-4 py-2.5 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg hover:opacity-90 transition-opacity text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {addingToKb ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    添加中...
                  </>
                ) : (
                  '添加'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Search Results to Knowledge Base Modal */}
      {showImportModal && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={() => !importing && setShowImportModal(false)}
        >
          <div
            className="bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-2xl w-full max-w-md mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
              <h3 className="font-medium text-white">导入搜索结果到知识库</h3>
              <button
                onClick={() => !importing && setShowImportModal(false)}
                className="p-1.5 hover:bg-[var(--color-sidebar-hover)] rounded-lg text-[var(--color-text-muted)] transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 max-h-96 overflow-y-auto">
              <p className="text-xs text-[var(--color-text-muted)] mb-4">
                将 {importItems.length} 条搜索结果导入所选知识库（自动分块并向量化）
              </p>
              {loadingImportBases ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-[var(--color-text-muted)]">
                  <Loader size={16} className="animate-spin" />
                  正在加载知识库...
                </div>
              ) : importBases.length === 0 ? (
                <p className="text-center text-[var(--color-text-muted)] text-sm py-4">
                  暂无知识库，请先在知识库页创建
                </p>
              ) : (
                <div className="space-y-2">
                  {importBases.map((base) => (
                    <div
                      key={base.id}
                      onClick={() => setSelectedImportBaseId(base.id)}
                      className={`flex items-center gap-3 px-4 py-3 rounded-lg cursor-pointer transition-all border ${
                        selectedImportBaseId === base.id
                          ? 'bg-blue-500/20 border-blue-500/50'
                          : 'bg-[var(--color-bg-secondary)] border-[var(--color-border)] hover:border-blue-500/30'
                      }`}
                    >
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                          selectedImportBaseId === base.id
                            ? 'bg-blue-500/30 text-blue-400'
                            : 'bg-[var(--color-card-bg)] text-[var(--color-text-muted)]'
                        }`}
                      >
                        <Database size={16} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{base.name}</p>
                        <p className="text-xs text-[var(--color-text-muted)] truncate">
                          {base.description || '暂无描述'}
                        </p>
                      </div>
                      {selectedImportBaseId === base.id && (
                        <Check size={18} className="text-blue-400 flex-shrink-0" />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 px-5 py-4 border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
              <button
                onClick={() => setShowImportModal(false)}
                disabled={importing}
                className="flex-1 px-4 py-2.5 text-[var(--color-text-muted)] hover:text-white hover:bg-[var(--color-sidebar-hover)] rounded-lg transition-colors text-sm disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handleImportToKb}
                disabled={importing || !selectedImportBaseId}
                className="flex-1 px-4 py-2.5 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg hover:opacity-90 transition-opacity text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {importing ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    导入中...
                  </>
                ) : (
                  '导入'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SearchPage;
