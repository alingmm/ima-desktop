import { useState } from 'react';
import { Search, ExternalLink, Clock, Sparkles, Loader } from 'lucide-react';
import { searchApi } from '../api';
import type { SearchResult } from '../types';

function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [summary, setSummary] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchHistory, setSearchHistory] = useState<string[]>([
    'AI 最新发展趋势',
    'React 19 新特性',
    '大模型对比评测',
  ]);

  const handleSearch = async () => {
    if (!query.trim()) return;
    try {
      setIsSearching(true);
      setHasSearched(true);
      const res = await searchApi.webSearch(query.trim());
      setResults(res.results || []);
      setSummary('');
      // Add to history
      if (!searchHistory.includes(query.trim())) {
        setSearchHistory([query.trim(), ...searchHistory.slice(0, 9)]);
      }
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setIsSearching(false);
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
                  setSummary(fullText);
                }
              } catch (e) {
                // ignore
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Summary error:', error);
      setSummary('生成总结失败，请稍后重试。');
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="h-14 border-b border-[var(--color-border)] flex items-center px-6">
        <h2 className="text-base font-medium text-white">联网搜索</h2>
      </div>

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
                onKeyDown={handleKeyDown}
                placeholder="输入关键词搜索..."
                className="w-full pl-12 pr-4 py-3.5 bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-xl text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)] text-base"
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={!query.trim() || isSearching}
              className="px-6 py-3.5 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl transition-colors font-medium flex items-center gap-2"
            >
              {isSearching ? (
                <>
                  <Loader size={18} className="animate-spin" />
                  搜索中
                </>
              ) : (
                <>
                  <Search size={18} />
                  搜索
                </>
              )}
            </button>
          </div>

          {/* Search history */}
          {!hasSearched && searchHistory.length > 0 && (
            <div className="mt-6">
              <p className="text-sm text-[var(--color-text-muted)] mb-3 flex items-center gap-2">
                <Clock size={14} />
                搜索历史
              </p>
              <div className="flex flex-wrap gap-2">
                {searchHistory.map((item, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setQuery(item);
                      handleSearch();
                    }}
                    className="px-3 py-1.5 bg-[var(--color-card-bg)] border border-[var(--color-border)] hover:border-[var(--color-primary)] text-sm text-[var(--color-text-secondary)] rounded-full transition-colors"
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Results area */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-6">
          {/* AI Summary */}
          {hasSearched && results.length > 0 && (
            <div className="mb-8">
              <div className="bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/30 rounded-2xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-medium text-white flex items-center gap-2">
                    <Sparkles size={18} className="text-blue-400" />
                    AI 智能总结
                  </h3>
                  {!summary && !isSummarizing && (
                    <button
                      onClick={handleSummary}
                      className="px-4 py-1.5 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white rounded-lg text-sm transition-colors"
                    >
                      生成总结
                    </button>
                  )}
                </div>

                {isSummarizing ? (
                  <div className="flex items-center gap-3 text-[var(--color-text-secondary)]">
                    <Loader size={18} className="animate-spin text-blue-400" />
                    <span className="text-sm">正在生成智能总结...</span>
                  </div>
                ) : summary ? (
                  <div className="text-sm text-[var(--color-text-primary)] leading-relaxed whitespace-pre-wrap">
                    {summary}
                  </div>
                ) : (
                  <p className="text-sm text-[var(--color-text-muted)]">
                    基于搜索结果，AI 可以为你生成一份结构化的智能总结
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Search results */}
          {isSearching ? (
            <div className="space-y-6">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="animate-pulse">
                  <div className="h-5 bg-[var(--color-card-bg)] rounded w-3/4 mb-2"></div>
                  <div className="h-4 bg-[var(--color-card-bg)] rounded w-full mb-1"></div>
                  <div className="h-4 bg-[var(--color-card-bg)] rounded w-5/6"></div>
                </div>
              ))}
            </div>
          ) : hasSearched && results.length > 0 ? (
            <div className="space-y-6">
              <p className="text-sm text-[var(--color-text-muted)]">
                找到 {results.length} 条相关结果
              </p>
              {results.map((result, idx) => (
                <div
                  key={idx}
                  className="group"
                >
                  <a
                    href={result.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block"
                  >
                    <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] mb-1">
                      <span className="truncate">{result.url}</span>
                      <ExternalLink size={12} className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <h3 className="text-lg font-medium text-blue-400 group-hover:underline mb-1.5">
                      {result.title}
                    </h3>
                    <p className="text-sm text-[var(--color-text-secondary)] line-clamp-3">
                      {result.snippet}
                    </p>
                  </a>
                </div>
              ))}
            </div>
          ) : hasSearched ? (
            <div className="text-center py-16">
              <Search size={36} className="mx-auto text-[var(--color-text-muted)] mb-4 opacity-50" />
              <p className="text-[var(--color-text-secondary)]">未找到相关结果</p>
              <p className="text-sm text-[var(--color-text-muted)] mt-1">
                请尝试其他关键词
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default SearchPage;
