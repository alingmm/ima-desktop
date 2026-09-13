import { useState, useEffect } from 'react';
import {
  Video,
  Image,
  Play,
  Clock,
  Loader,
  CheckCircle,
  XCircle,
  Plus,
  Upload,
} from 'lucide-react';
import { videoApi } from '../api';
import type { VideoTask } from '../types';

type TabType = 'text-to-video' | 'image-to-video';

function VideoPage() {
  const [activeTab, setActiveTab] = useState<TabType>('text-to-video');
  const [tasks, setTasks] = useState<VideoTask[]>([]);
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState(5);
  const [ratio, setRatio] = useState('16:9');
  const [resolution, setResolution] = useState('720p');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    loadTasks();
  }, []);

  const loadTasks = async () => {
    try {
      setLoading(true);
      const res = await videoApi.getTasks();
      setTasks(res.tasks);
    } catch (error) {
      console.error('Failed to load video tasks:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    try {
      setGenerating(true);
      let res;
      if (activeTab === 'text-to-video') {
        res = await videoApi.textToVideo({
          prompt: prompt.trim(),
          duration,
          ratio,
          resolution,
        });
      } else {
        res = await videoApi.imageToVideo({
          prompt: prompt.trim(),
          image_url: selectedImage || '',
          duration,
          ratio,
          resolution,
        });
      }
      setTasks([res.task, ...tasks]);
      setPrompt('');
      setSelectedImage(null);
    } catch (error) {
      console.error('Failed to create video task:', error);
      alert('生成失败，请稍后重试');
    } finally {
      setGenerating(false);
    }
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setSelectedImage(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'text-green-400 bg-green-500/10';
      case 'running':
      case 'queued':
        return 'text-blue-400 bg-blue-500/10';
      case 'failed':
        return 'text-red-400 bg-red-500/10';
      default:
        return 'text-gray-400 bg-gray-500/10';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle size={14} />;
      case 'running':
      case 'queued':
        return <Loader size={14} className="animate-spin" />;
      case 'failed':
        return <XCircle size={14} />;
      default:
        return <Clock size={14} />;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'completed':
        return '已完成';
      case 'running':
        return '生成中';
      case 'queued':
        return '排队中';
      case 'failed':
        return '失败';
      default:
        return status;
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="h-full flex">
      {/* Left panel - Generator */}
      <div className="w-96 h-full border-r border-[var(--color-border)] flex flex-col bg-[var(--color-sidebar-bg)]">
        <div className="p-6 border-b border-[var(--color-border)]">
          <h2 className="text-lg font-semibold text-white mb-4">视频生成</h2>

          {/* Tabs */}
          <div className="flex bg-[var(--color-main-bg)] rounded-lg p-1">
            <button
              onClick={() => setActiveTab('text-to-video')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'text-to-video'
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              <Video size={16} />
              文生视频
            </button>
            <button
              onClick={() => setActiveTab('image-to-video')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'image-to-video'
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              <Image size={16} />
              图生视频
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Image upload for image-to-video */}
          {activeTab === 'image-to-video' && (
            <div>
              <label className="block text-sm text-[var(--color-text-secondary)] mb-2">
                参考图片
              </label>
              {selectedImage ? (
                <div className="relative">
                  <img
                    src={selectedImage}
                    alt="Selected"
                    className="w-full aspect-video object-cover rounded-lg"
                  />
                  <button
                    onClick={() => setSelectedImage(null)}
                    className="absolute top-2 right-2 p-1.5 bg-black/60 hover:bg-black/80 rounded-full transition-colors"
                  >
                    <XCircle size={16} className="text-white" />
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-[var(--color-border)] rounded-lg cursor-pointer hover:border-[var(--color-primary)] transition-colors">
                  <Upload size={28} className="text-[var(--color-text-muted)] mb-2" />
                  <span className="text-sm text-[var(--color-text-muted)]">点击上传图片</span>
                  <span className="text-xs text-[var(--color-text-muted)] mt-1">
                    支持 JPG、PNG 格式
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageSelect}
                    className="hidden"
                  />
                </label>
              )}
            </div>
          )}

          {/* Prompt */}
          <div>
            <label className="block text-sm text-[var(--color-text-secondary)] mb-2">
              描述提示词
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="描述你想要生成的视频内容..."
              rows={5}
              className="w-full px-4 py-3 bg-[var(--color-main-bg)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)] resize-none"
            />
            <p className="text-xs text-[var(--color-text-muted)] mt-2">
              提示越详细，生成效果越好
            </p>
          </div>

          {/* Duration */}
          <div>
            <label className="block text-sm text-[var(--color-text-secondary)] mb-2">
              视频时长
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[3, 5, 10].map((d) => (
                <button
                  key={d}
                  onClick={() => setDuration(d)}
                  className={`py-2 rounded-lg text-sm transition-colors ${
                    duration === d
                      ? 'bg-[var(--color-primary)] text-white'
                      : 'bg-[var(--color-main-bg)] border border-[var(--color-border)] text-[var(--color-text-primary)] hover:border-[var(--color-primary)]'
                  }`}
                >
                  {d} 秒
                </button>
              ))}
            </div>
          </div>

          {/* Ratio */}
          <div>
            <label className="block text-sm text-[var(--color-text-secondary)] mb-2">
              画面比例
            </label>
            <div className="grid grid-cols-3 gap-2">
              {['16:9', '9:16', '1:1'].map((r) => (
                <button
                  key={r}
                  onClick={() => setRatio(r)}
                  className={`py-2 rounded-lg text-sm transition-colors ${
                    ratio === r
                      ? 'bg-[var(--color-primary)] text-white'
                      : 'bg-[var(--color-main-bg)] border border-[var(--color-border)] text-[var(--color-text-primary)] hover:border-[var(--color-primary)]'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Resolution */}
          <div>
            <label className="block text-sm text-[var(--color-text-secondary)] mb-2">
              分辨率
            </label>
            <div className="grid grid-cols-2 gap-2">
              {['480p', '720p', '1080p', '4K'].map((r) => (
                <button
                  key={r}
                  onClick={() => setResolution(r)}
                  className={`py-2 rounded-lg text-sm transition-colors ${
                    resolution === r
                      ? 'bg-[var(--color-primary)] text-white'
                      : 'bg-[var(--color-main-bg)] border border-[var(--color-border)] text-[var(--color-text-primary)] hover:border-[var(--color-primary)]'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Generate button */}
        <div className="p-4 border-t border-[var(--color-border)]">
          <button
            onClick={handleGenerate}
            disabled={!prompt.trim() || generating || (activeTab === 'image-to-video' && !selectedImage)}
            className="w-full flex items-center justify-center gap-2 py-3 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium"
          >
            {generating ? (
              <>
                <Loader size={18} className="animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Plus size={18} />
                生成视频
              </>
            )}
          </button>
        </div>
      </div>

      {/* Right panel - Task list */}
      <div className="flex-1 flex flex-col">
        <div className="h-14 border-b border-[var(--color-border)] flex items-center justify-between px-6">
          <h2 className="text-base font-medium text-white">历史任务</h2>
          <span className="text-sm text-[var(--color-text-muted)]">
            共 {tasks.length} 个任务
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="text-center py-16 text-[var(--color-text-muted)]">加载中...</div>
          ) : tasks.length === 0 ? (
            <div className="text-center py-16">
              <Video size={40} className="mx-auto text-[var(--color-text-muted)] mb-4 opacity-50" />
              <p className="text-[var(--color-text-secondary)] mb-2">暂无视频任务</p>
              <p className="text-sm text-[var(--color-text-muted)]">
                在左侧填写提示词，开始生成你的第一个视频
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-xl overflow-hidden hover:border-[var(--color-primary)]/50 transition-colors"
                >
                  {/* Video preview */}
                  <div className="relative aspect-video bg-[var(--color-main-bg)]">
                    {task.video_url ? (
                      <video
                        src={task.video_url}
                        poster={task.thumbnail_url}
                        className="w-full h-full object-cover"
                        controls
                      />
                    ) : task.status === 'running' || task.status === 'queued' ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <Loader size={32} className="text-blue-400 animate-spin mb-2" />
                        <span className="text-sm text-[var(--color-text-muted)]">生成中...</span>
                      </div>
                    ) : task.status === 'failed' ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <XCircle size={32} className="text-red-400 mb-2" />
                        <span className="text-sm text-red-400">生成失败</span>
                      </div>
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Video size={32} className="text-[var(--color-text-muted)] opacity-50" />
                      </div>
                    )}

                    {task.video_url && (
                      <div className="absolute bottom-2 right-2">
                        <button className="p-2 bg-black/60 hover:bg-black/80 rounded-full transition-colors">
                          <Play size={16} className="text-white" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="p-4">
                    <p className="text-sm text-[var(--color-text-primary)] line-clamp-2 h-10 mb-2">
                      {task.prompt}
                    </p>
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-xs px-2 py-1 rounded-full flex items-center gap-1 ${getStatusColor(
                          task.status
                        )}`}
                      >
                        {getStatusIcon(task.status)}
                        {getStatusText(task.status)}
                      </span>
                      <span className="text-xs text-[var(--color-text-muted)]">
                        {formatDate(task.created_at)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-2 text-xs text-[var(--color-text-muted)]">
                      <span>{task.duration}s</span>
                      <span>·</span>
                      <span>{task.ratio}</span>
                      <span>·</span>
                      <span>{task.resolution}</span>
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

export default VideoPage;
