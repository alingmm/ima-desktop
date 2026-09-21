import { useState, useEffect } from 'react';
import { Settings, User, Palette, Bell, Shield, HelpCircle, ChevronRight, Save, Cpu, RefreshCw, Download, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { localModelApi } from '../api';
import type { OllamaModel } from '../types';
import { useLocalSettings } from '../hooks/useLocalSettings';

type SettingsSection = 'profile' | 'appearance' | 'models' | 'notifications' | 'security' | 'about';

function SettingsPage() {
  const [activeSection, setActiveSection] = useState<SettingsSection>('profile');
  const [userName, setUserName] = useState('用户');
  const [email, setEmail] = useState('user@example.com');
  const [theme, setTheme] = useState('dark');
  const [language, setLanguage] = useState('zh-CN');
  const [saved, setSaved] = useState(false);

  const sections = [
    { id: 'profile' as SettingsSection, label: '个人信息', icon: User },
    { id: 'appearance' as SettingsSection, label: '外观设置', icon: Palette },
    { id: 'models' as SettingsSection, label: '模型偏好', icon: Settings },
    { id: 'notifications' as SettingsSection, label: '通知设置', icon: Bell },
    { id: 'security' as SettingsSection, label: '账号安全', icon: Shield },
    { id: 'about' as SettingsSection, label: '关于', icon: HelpCircle },
  ];

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const renderSection = () => {
    switch (activeSection) {
      case 'profile':
        return (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-white">个人信息</h2>
            <p className="text-[var(--color-text-secondary)] text-sm">
              管理您的个人资料信息
            </p>

            <div className="space-y-5 pt-4">
              {/* Avatar */}
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-white text-2xl font-medium">
                  {userName.charAt(0).toUpperCase()}
                </div>
                <button className="px-4 py-2 bg-[var(--color-card-bg)] border border-[var(--color-border)] hover:border-[var(--color-primary)] text-[var(--color-text-primary)] rounded-lg text-sm transition-colors">
                  更换头像
                </button>
              </div>

              {/* Username */}
              <div>
                <label className="block text-sm text-[var(--color-text-secondary)] mb-2">
                  用户名
                </label>
                <input
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  className="w-full max-w-md px-4 py-2.5 bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-lg text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)]"
                />
              </div>

              {/* Email */}
              <div>
                <label className="block text-sm text-[var(--color-text-secondary)] mb-2">
                  邮箱
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full max-w-md px-4 py-2.5 bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-lg text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)]"
                />
              </div>
            </div>
          </div>
        );

      case 'appearance':
        return (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-white">外观设置</h2>
            <p className="text-[var(--color-text-secondary)] text-sm">
              自定义界面外观和主题
            </p>

            <div className="space-y-5 pt-4">
              {/* Theme */}
              <div>
                <label className="block text-sm text-[var(--color-text-secondary)] mb-3">
                  主题模式
                </label>
                <div className="flex gap-3">
                  {[
                    { id: 'light', label: '浅色' },
                    { id: 'dark', label: '深色' },
                    { id: 'auto', label: '跟随系统' },
                  ].map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setTheme(t.id)}
                      className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                        theme === t.id
                          ? 'bg-[var(--color-primary)] text-white'
                          : 'bg-[var(--color-card-bg)] border border-[var(--color-border)] text-[var(--color-text-primary)] hover:border-[var(--color-primary)]'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Language */}
              <div>
                <label className="block text-sm text-[var(--color-text-secondary)] mb-2">
                  语言
                </label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full max-w-md px-4 py-2.5 bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-lg text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)]"
                >
                  <option value="zh-CN">简体中文</option>
                  <option value="zh-TW">繁體中文</option>
                  <option value="en-US">English</option>
                  <option value="ja-JP">日本語</option>
                </select>
              </div>
            </div>
          </div>
        );

      case 'models':
        return <ModelSettings />;

      case 'notifications':
        return (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-white">通知设置</h2>
            <p className="text-[var(--color-text-secondary)] text-sm">
              管理您的通知偏好
            </p>
            <div className="space-y-4 pt-4">
              {[
                { label: '邮件通知', desc: '接收重要更新和账单提醒', enabled: true },
                { label: '视频生成完成通知', desc: '视频生成完成时发送通知', enabled: true },
                { label: '知识库处理通知', desc: '文档处理完成时发送通知', enabled: false },
                { label: '营销邮件', desc: '接收产品更新和优惠活动', enabled: false },
              ].map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-4 bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-xl"
                >
                  <div>
                    <p className="text-sm text-[var(--color-text-primary)]">{item.label}</p>
                    <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{item.desc}</p>
                  </div>
                  <button className="relative w-12 h-6 rounded-full bg-[var(--color-primary)]">
                    <span className="absolute top-0.5 right-0.5 w-5 h-5 bg-white rounded-full"></span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        );

      case 'security':
        return (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-white">账号安全</h2>
            <p className="text-[var(--color-text-secondary)] text-sm">
              保护您的账号安全
            </p>
            <div className="space-y-3 pt-4">
              {[
                { label: '修改密码', desc: '定期更换密码以保护账号安全' },
                { label: '两步验证', desc: '启用后登录需要额外验证码' },
                { label: '登录设备', desc: '管理已登录的设备' },
                { label: 'API 密钥', desc: '管理您的 API 访问密钥' },
              ].map((item, idx) => (
                <button
                  key={idx}
                  className="w-full flex items-center justify-between p-4 bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-xl hover:border-[var(--color-primary)] transition-colors"
                >
                  <div className="text-left">
                    <p className="text-sm text-[var(--color-text-primary)]">{item.label}</p>
                    <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{item.desc}</p>
                  </div>
                  <ChevronRight size={18} className="text-[var(--color-text-muted)]" />
                </button>
              ))}
            </div>
          </div>
        );

      case 'about':
        return (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-white">关于</h2>
            <div className="pt-4 space-y-4">
              <div className="p-6 bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-xl text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-white mb-1">AI 工作台</h3>
                <p className="text-sm text-[var(--color-text-muted)]">版本 1.0.0</p>
              </div>
              <div className="space-y-3">
                <button className="w-full flex items-center justify-between p-4 bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-xl hover:border-[var(--color-primary)] transition-colors">
                  <span className="text-sm text-[var(--color-text-primary)]">使用条款</span>
                  <ChevronRight size={18} className="text-[var(--color-text-muted)]" />
                </button>
                <button className="w-full flex items-center justify-between p-4 bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-xl hover:border-[var(--color-primary)] transition-colors">
                  <span className="text-sm text-[var(--color-text-primary)]">隐私政策</span>
                  <ChevronRight size={18} className="text-[var(--color-text-muted)]" />
                </button>
                <button className="w-full flex items-center justify-between p-4 bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-xl hover:border-[var(--color-primary)] transition-colors">
                  <span className="text-sm text-[var(--color-text-primary)]">帮助中心</span>
                  <ChevronRight size={18} className="text-[var(--color-text-muted)]" />
                </button>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="h-full flex">
      {/* Settings sidebar */}
      <div className="w-64 h-full border-r border-[var(--color-border)] bg-[var(--color-sidebar-bg)]">
        <div className="p-4 border-b border-[var(--color-border)]">
          <h2 className="text-base font-semibold text-white">设置</h2>
        </div>
        <nav className="p-2 space-y-1">
          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                  activeSection === section.id
                    ? 'bg-[var(--color-primary)] text-white'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-sidebar-hover)] hover:text-white'
                }`}
              >
                <Icon size={18} />
                <span className="text-sm font-medium">{section.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Settings content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-8 pb-24">
          {renderSection()}

          {/* Save button */}
          <div className="fixed bottom-0 left-64 right-0 p-4 bg-gradient-to-t from-[var(--color-main-bg)] to-transparent">
            <div className="max-w-2xl mx-auto flex justify-end">
              <button
                onClick={handleSave}
                className="flex items-center gap-2 px-6 py-2.5 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white rounded-lg transition-colors font-medium"
              >
                {saved ? (
                  <>
                    <Settings size={16} />
                    已保存
                  </>
                ) : (
                  <>
                    <Save size={16} />
                    保存设置
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Local model settings component
function ModelSettings() {
  const { settings, updateSettings } = useLocalSettings();
  const [ollamaUrlInput, setOllamaUrlInput] = useState(settings.ollamaUrl);
  const [localModels, setLocalModels] = useState<OllamaModel[]>([]);
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [checkError, setCheckError] = useState('');
  const [pulling, setPulling] = useState(false);
  const [pullModelName, setPullModelName] = useState('');
  const [streamOutput, setStreamOutput] = useState(true);
  const [defaultCloudModel, setDefaultCloudModel] = useState('doubao-seed-2-0-pro-260215');

  useEffect(() => {
    setOllamaUrlInput(settings.ollamaUrl);
  }, [settings.ollamaUrl]);

  const checkOllama = async () => {
    setChecking(true);
    setCheckError('');
    setAvailable(null);
    try {
      const result = await localModelApi.checkHealth(ollamaUrlInput);
      setAvailable(result.available);
      if (result.available) {
        updateSettings({ ollamaUrl: ollamaUrlInput });
        loadModels();
      } else {
        setCheckError(result.hint || result.error || '无法连接到 Ollama');
      }
    } catch (e: any) {
      setAvailable(false);
      setCheckError(e.message || '检查失败');
    } finally {
      setChecking(false);
    }
  };

  const loadModels = async () => {
    try {
      const models = await localModelApi.getModels(ollamaUrlInput);
      setLocalModels(models);
    } catch (e) {
      console.warn('加载本地模型列表失败:', e);
    }
  };

  const pullModel = async () => {
    if (!pullModelName.trim()) return;
    setPulling(true);
    try {
      await localModelApi.pullModel(pullModelName.trim(), ollamaUrlInput);
      setPullModelName('');
      loadModels();
    } catch (e: any) {
      alert('拉取失败: ' + (e.message || e));
    } finally {
      setPulling(false);
    }
  };

  const toggleLocalModel = () => {
    if (!available) {
      alert('请先确保 Ollama 服务已启动并能正常连接');
      return;
    }
    updateSettings({ useLocalModel: !settings.useLocalModel });
  };

  return (
    <div className="space-y-8">
      {/* Cloud models */}
      <div className="space-y-5">
        <h2 className="text-xl font-semibold text-white">云端模型</h2>
        <div>
          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">
            默认对话模型
          </label>
          <select
            value={defaultCloudModel}
            onChange={(e) => setDefaultCloudModel(e.target.value)}
            className="w-full max-w-md px-4 py-2.5 bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-lg text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)]"
          >
            <option value="doubao-seed-2-0-pro-260215">豆包 Pro (推荐)</option>
            <option value="doubao-seed-2-0-lite-260215">豆包 Lite</option>
            <option value="minimax-m2-7-260318">MiniMax M2</option>
            <option value="qwen-3-5-plus-260215">通义千问</option>
          </select>
          <p className="text-xs text-[var(--color-text-muted)] mt-2">
            需配置 API Key 后可用，打包到本地运行时失效</p>
        </div>

        {/* Stream output */}
        <div className="flex items-center justify-between max-w-md">
          <div>
            <p className="text-sm text-[var(--color-text-primary)]">流式输出</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
              逐字显示 AI 回复内容
            </p>
          </div>
          <button
            onClick={() => setStreamOutput(!streamOutput)}
            className={`relative w-12 h-6 rounded-full transition-colors ${
              streamOutput ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border)]'
            }`}
          >
            <span
              className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                streamOutput ? 'translate-x-6' : 'translate-x-0.5'
              }`}
            ></span>
          </button>
        </div>
      </div>

      <div className="border-t border-[var(--color-border)]" />

      {/* Local models */}
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white flex items-center gap-2">
              <Cpu className="w-5 h-5 text-emerald-400" />
              本地模型 (Ollama)
            </h2>
            <p className="text-[var(--color-text-secondary)] text-sm mt-1">
              连接本地 Ollama 服务，完全离线运行，保护数据不出本机
            </p>
          </div>
        </div>

        {/* Ollama URL config */}
        <div className="p-4 bg-[var(--color-card-bg)] rounded-xl border border-[var(--color-border)] space-y-4">
          <div>
            <label className="block text-sm text-[var(--color-text-secondary)] mb-2">
              Ollama 服务地址
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={ollamaUrlInput}
                onChange={(e) => setOllamaUrlInput(e.target.value)}
                placeholder="http://127.0.0.1:11434"
                className="flex-1 px-4 py-2.5 bg-[#0f1419] border border-[var(--color-border)] rounded-lg text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)] text-sm"
              />
              <button
                onClick={checkOllama}
                disabled={checking}
                className="px-4 py-2.5 bg-[var(--color-primary)] hover:opacity-90 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-opacity flex items-center gap-2"
              >
                {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                {checking ? '检测中...' : '检测连接'}
              </button>
            </div>
            {available === true && (
              <div className="flex items-center gap-2 mt-3 text-emerald-400 text-sm">
                <CheckCircle className="w-4 h-4" />
                Ollama 服务运行正常，已发现 {localModels.length} 个模型
              </div>
            )}
            {available === false && (
              <div className="flex items-start gap-2 mt-3 text-amber-400 text-sm">
                <AlertCircle className="w-4 h-4 mt-0.5" />
                <div>
                  <p>无法连接到 Ollama 服务</p>
                  {checkError && <p className="text-xs mt-1 opacity-80">{checkError}</p>}
                  <p className="text-xs mt-1 opacity-70">
                    请先安装 Ollama：<a href="https://ollama.com" target="_blank" rel="noreferrer" className="underline">ollama.com</a>
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Use local model toggle */}
          <div className="flex items-center justify-between pt-3 border-t border-[var(--color-border)]">
            <div>
              <p className="text-sm text-[var(--color-text-primary)]">默认使用本地模型</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                对话优先走本地 Ollama，不依赖网络
              </p>
            </div>
            <button
              onClick={toggleLocalModel}
              disabled={!available}
              className={`relative w-12 h-6 rounded-full transition-colors disabled:opacity-40 ${
                settings.useLocalModel ? 'bg-emerald-500' : 'bg-[var(--color-border)]'
              }`}
            >
              <span
                className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                  settings.useLocalModel ? 'translate-x-6' : 'translate-x-0.5'
                }`}
              ></span>
            </button>
          </div>
        </div>

        {/* Local model list */}
        {available && (
          <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-[var(--color-text-primary)]">已安装模型</h3>
            <button
              onClick={loadModels}
              className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> 刷新
            </button>
          </div>

          {localModels.length === 0 ? (
            <div className="p-6 text-center bg-[var(--color-card-bg)] rounded-xl border border-dashed border-[var(--color-border)]">
              <p className="text-sm text-[var(--color-text-muted)]">
                暂无本地模型，先下载一个吧
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {localModels.map((model) => (
                <div
                  key={model.id}
                  className="p-3 bg-[var(--color-card-bg)] rounded-lg border border-[var(--color-border)] hover:border-[var(--color-primary)]/30"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[var(--color-text-primary)] font-medium">
                      {model.name}
                    </span>
                    <span className="text-xs text-[var(--color-text-muted)]">
                      {model.size ? (model.size / 1024 / 1024 / 1024).toFixed(1) + ' GB' : ''}
                    </span>
                  </div>
                  {model.details?.parameter_size && (
                    <p className="text-xs text-[var(--color-text-muted)] mt-1">
                      参数：{model.details.parameter_size}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
          </div>
        )}

        {/* Pull new model */}
        {available && (
          <div className="space-y-2">
            <label className="block text-sm font-medium text-[var(--color-text-primary)]">
              下载新模型
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={pullModelName}
                onChange={(e) => setPullModelName(e.target.value)}
                placeholder="如：qwen2.5:7b"
                className="flex-1 px-4 py-2.5 bg-[#0f1419] border border-[var(--color-border)] rounded-lg text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)] text-sm"
              />
              <button
                onClick={pullModel}
                disabled={pulling || !pullModelName.trim()}
                className="px-4 py-2.5 bg-[var(--color-card-bg)] border border-[var(--color-border)] hover:border-[var(--color-primary)] text-[var(--color-text-primary)] rounded-lg text-sm transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                {pulling ? '下载中...' : '下载'}
              </button>
            </div>
            <p className="text-xs text-[var(--color-text-muted)]">
              从 Ollama 模型库下载，查看：<a href="https://ollama.com/library" target="_blank" rel="noreferrer" className="underline">ollama.com/library</a>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default SettingsPage;
