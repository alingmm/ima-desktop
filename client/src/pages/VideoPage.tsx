import { useState, useRef, useEffect } from 'react';
import {
  Video,
  Wand2,
  Save,
  Lightbulb,
  Copy as CopyIcon,
  Clapperboard,
  FileText,
  Sparkles,
  Scissors,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { videoApi, notesApi } from '../api';
import { useToast, showApiError } from '../components/Toast';

type AssistType = 'script' | 'storyboard' | 'copy' | 'plan';

const ASSIST_TYPES: { key: AssistType; label: string; icon: any; desc: string }[] = [
  { key: 'script', label: '视频脚本', icon: Clapperboard, desc: '开场白+正文+结尾+完整台词' },
  { key: 'storyboard', label: '分镜脚本', icon: Video, desc: '场景/景别/画面/台词/运镜' },
  { key: 'copy', label: '口播文案', icon: FileText, desc: '口播稿+字幕+标题+标签' },
  { key: 'plan', label: '完整策划', icon: Sparkles, desc: '定位+脚本+分镜+发布建议' },
];

const EXAMPLE_TOPICS = [
  '如何用手机拍出电影感Vlog',
  '3分钟讲清楚什么是AI绘画',
  '新手第一次创业失败经验分享',
  '城市夜景氛围感大片',
];

function VideoPage() {
  const toast = useToast();
  const [assistType, setAssistType] = useState<AssistType>('script');
  const [topic, setTopic] = useState('');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState('');
  const esRef = useRef<any>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const [showToolsGuide, setShowToolsGuide] = useState(true);

  useEffect(() => {
    return () => {
      if (esRef.current) esRef.current.close();
    };
  }, []);

  const handleGenerate = async () => {
    if (!topic.trim() || generating) return;
    setGenerating(true);
    setResult('');

    try {
      const es = videoApi.assistStream({ topic: topic.trim(), type: assistType });
      esRef.current = es;

      es.onmessage = (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          if (data.error) {
            showApiError({ error: data.error, message: data.message }, toast);
            setGenerating(false);
            es.close();
            return;
          }
          if (data.content) {
            setResult((prev) => prev + data.content);
          }
          if (data.done) {
            setGenerating(false);
            es.close();
            toast.success('生成完成');
          }
        } catch (err) {
          console.error('Parse error:', err);
        }
      };

      es.onerror = () => {
        setGenerating(false);
        toast.error('连接失败，请检查网络或 API 配置');
        es.close();
      };
    } catch (error: any) {
      showApiError(error, toast);
      setGenerating(false);
    }
  };

  const handleCopy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result);
      toast.success('已复制到剪贴板');
    } catch {
      toast.error('复制失败');
    }
  };

  const handleSaveAsNote = async () => {
    if (!result) return;
    try {
      const title = topic.trim().slice(0, 30) || '视频创作';
      const typeLabel = ASSIST_TYPES.find((t) => t.key === assistType)?.label || '创作';
      const noteContent = `# ${title} - ${typeLabel}\n\n> 主题：${topic}\n\n---\n\n${result}\n\n---\n\n_来自 IMA 工作台 - 视频创作助手生成`;
      await notesApi.createNote({
        title: `${title} - ${typeLabel}`,
        content: noteContent,
        tags: ['视频创作', typeLabel],
      });
      toast.success('已保存为笔记');
    } catch (error) {
      showApiError(error, toast);
    }
  };

  const currentTypeInfo = ASSIST_TYPES.find((t) => t.key === assistType);
  const TypeIcon = currentTypeInfo?.icon;

  return (
    <div className="h-full flex flex-col bg-[var(--color-main-bg)]">
      {/* Header */}
      <div className="px-6 py-4 border-b border-[var(--color-border)] flex items-center justify-between bg-[var(--color-card-bg)]">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 text-white">
            <Wand2 size={20} />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">视频创作助手</h1>
            <p className="text-xs text-[var(--color-text-muted)]">
              AI 帮你写脚本、分镜、文案，一键复制到剪辑软件即可制作
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left panel - Input */}
        <div className="w-[420px] h-full border-r border-[var(--color-border)] flex flex-col bg-[var(--color-sidebar-bg)] overflow-y-auto">
          <div className="p-6 space-y-5">
            {/* Creation Type */}
            <div>
              <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-3">
                选择创作类型
              </label>
              <div className="grid grid-cols-2 gap-2">
                {ASSIST_TYPES.map((type) => {
                  const Icon = type.icon;
                  const active = assistType === type.key;
                  return (
                    <button
                      key={type.key}
                      onClick={() => setAssistType(type.key)}
                      className={`p-3 rounded-lg border text-left transition-all ${
                        active
                          ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 ring-1 ring-[var(--color-primary)]/30'
                          : 'border-[var(--color-border)] hover:border-[var(--color-primary)]/30'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Icon
                          size={16}
                          className={active ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-muted)]'}
                        />
                        <span className={`text-sm font-medium ${active ? 'text-white' : 'text-[var(--color-text-primary)]'}`}>
                          {type.label}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--color-text-muted)] line-clamp-1">{type.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Topic Input */}
            <div>
              <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                视频主题 / 创意描述
              </label>
              <textarea
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder={`例如：${EXAMPLE_TOPICS[0]}`}
                rows={6}
                className="w-full px-4 py-3 bg-[var(--color-main-bg)] border border-[var(--color-border)] rounded-lg text-white text-sm resize-none focus:outline-none focus:border-[var(--color-primary)]/50 placeholder:text-[var(--color-text-muted)]"
              />
            </div>

            {/* Quick examples */}
            <div>
              <p className="text-xs text-[var(--color-text-muted)] mb-2 flex items-center gap-1">
                <Lightbulb size={12} />
                试试这些主题
              </p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLE_TOPICS.map((ex, i) => (
                  <button
                    key={i}
                    onClick={() => setTopic(ex)}
                    className="px-3 py-1.5 text-xs bg-[var(--color-main-bg)] border border-[var(--color-border)] rounded-full text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]/50 hover:text-[var(--color-primary)] transition-colors"
                  >
                    {ex.length > 14 ? ex.slice(0, 14) + '...' : ex}
                  </button>
                ))}
              </div>
            </div>

            {/* Generate button */}
            <button
              onClick={handleGenerate}
              disabled={!topic.trim() || generating}
              className="w-full py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg font-medium text-sm hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {generating ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  生成中...
                </>
              ) : (
                <>
                  <Wand2 size={16} />
                  开始生成
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right panel - Result */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Result header */}
          <div className="px-6 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
            <div className="flex items-center gap-2">
              {TypeIcon && <TypeIcon size={16} className="text-[var(--color-primary)]" />}
              <span className="text-sm font-medium text-white">{currentTypeInfo?.label}</span>
              {generating && (
                <span className="text-xs text-[var(--color-text-muted)] ml-2">（正在生成...）</span>
              )}
            </div>
            {result && (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:text-white bg-[var(--color-sidebar-bg)] hover:bg-[var(--color-hover-bg)] rounded-md transition-colors border border-[var(--color-border)]"
                >
                  <CopyIcon size={14} />
                  复制
                </button>
                <button
                  onClick={handleSaveAsNote}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:text-white bg-[var(--color-sidebar-bg)] hover:bg-[var(--color-hover-bg)] rounded-md transition-colors border border-[var(--color-border)]"
                >
                  <Save size={14} />
                  保存为笔记
                </button>
              </div>
            )}
          </div>

          {/* Result content */}
          <div ref={resultRef} className="flex-1 overflow-y-auto p-6">
            {result ? (
              <div className="text-[var(--color-text-primary)] text-sm leading-relaxed whitespace-pre-wrap break-words">
                {result}
                {generating && (
                  <span className="inline-block w-2 h-4 ml-1 bg-[var(--color-primary)] animate-pulse align-middle" />
                )}
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center px-8">
                <div className="p-4 rounded-full bg-[var(--color-sidebar-bg)] mb-4">
                  <Wand2 size={32} className="text-[var(--color-text-muted)]" />
                </div>
                <h3 className="text-lg font-medium text-white mb-2">开始你的视频创作</h3>
                <p className="text-sm text-[var(--color-text-muted)] max-w-md">
                  在左侧输入视频主题，选择创作类型，AI 将为你生成专业的脚本、分镜或文案
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tools guide */}
      <div className="border-t border-[var(--color-border)] bg-[var(--color-card-bg)]">
        <button
          onClick={() => setShowToolsGuide(!showToolsGuide)}
          className="w-full px-6 py-3 flex items-center justify-between text-left hover:bg-[var(--color-hover-bg)]/30 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Scissors size={16} className="text-[var(--color-primary)]" />
            <span className="text-sm font-medium text-white">第三方剪辑工具推荐</span>
            <span className="text-xs text-[var(--color-text-muted)]">
              把上面生成的脚本/分镜复制后，用这些工具完成视频制作
            </span>
          </div>
          {showToolsGuide ? (
            <ChevronUp size={16} className="text-[var(--color-text-muted)]" />
          ) : (
            <ChevronDown size={16} className="text-[var(--color-text-muted)]" />
          )}
        </button>
        {showToolsGuide && (
          <div className="px-6 pb-5 grid grid-cols-3 gap-4">
            {[
              { name: '剪映', desc: '新手友好，模板多，免费够用', tag: '推荐新手' },
              { name: 'Premiere Pro', desc: '专业级剪辑，功能全面', tag: '进阶' },
              { name: 'DaVinci Resolve（达芬奇）', desc: '调色强，免费版够用', tag: '调色' },
            ].map((tool, i) => (
              <div key={i} className="p-4 bg-[var(--color-main-bg)] rounded-lg border border-[var(--color-border)]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-white">{tool.name}</span>
                  <span className="text-xs px-2 py-0.5 bg-[var(--color-primary)]/10 text-[var(--color-primary)] rounded-full">
                    {tool.tag}
                  </span>
                </div>
                <p className="text-xs text-[var(--color-text-muted)]">{tool.desc}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default VideoPage;
