import { useState, useEffect } from 'react';
import { Settings, User, Palette, Bell, Shield, HelpCircle, ChevronRight, Save, Cpu, RefreshCw, Download, CheckCircle, AlertCircle, Loader2, Key, Globe, Eye, EyeOff } from 'lucide-react';
import { localModelApi, settingsApi } from '../api';
import type { OllamaModel } from '../types';
import { useLocalSettings } from '../hooks/useLocalSettings';
import { useToast } from '../components/Toast';

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
  const { success: toastSuccess, error: toastError } = useToast();
  const [ollamaUrlInput, setOllamaUrlInput] = useState(settings.ollamaUrl);
  const [localModels, setLocalModels] = useState<OllamaModel[]>([]);
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [checkError, setCheckError] = useState('');
  const [pulling, setPulling] = useState(false);
  const [pullModelName, setPullModelName] = useState('');
  const [streamOutput, setStreamOutput] = useState(true);

  // Cloud API settings state
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudSaving, setCloudSaving] = useState(false);
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState('');
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [apiKeyTail, setApiKeyTail] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [chatModel, setChatModel] = useState('');
  const [embeddingModel, setEmbeddingModel] = useState('');
  const [searchApiKey, setSearchApiKey] = useState('');
  const [searchKeyConfigured, setSearchKeyConfigured] = useState(false);
  const [searchKeyTail, setSearchKeyTail] = useState('');
  const [showSearchKey, setShowSearchKey] = useState(false);

  useEffect(() => {
    loadCloudSettings();
  }, []);

  const loadCloudSettings = async () => {
    setCloudLoading(true);
    try {
      const res = await settingsApi.getSettings();
      const s = res.settings;
      setOpenaiBaseUrl(s.openaiBaseUrl || '');
      setApiKeyConfigured(!!s.openaiApiKeyConfigured);
      setApiKeyTail(s.openaiApiKeyTail || '');
      setChatModel(s.chatModel || '');
      setEmbeddingModel(s.embeddingModel || '');
      setSearchKeyConfigured(!!s.searchApiKeyConfigured);
      setSearchKeyTail(s.searchApiKeyTail || '');
    } catch (e: any) {
      console.warn('加载云端设置失败:', e);
    } finally {
      setCloudLoading(false);
    }
  };

  const saveCloudSettings = async () => {
    setCloudSaving(true);
    try {
      const payload: Record<string, any> = {
        openaiBaseUrl,
        chatModel,
        embeddingModel,
      };
      // 只有用户填了新值才提交 key，空串不发送
      if (openaiApiKey.trim()) payload.openaiApiKey = openaiApiKey.trim();
      if (searchApiKey.trim()) payload.searchApiKey = searchApiKey.trim();

      const res = await settingsApi.updateSettings(payload);
      const s = res.settings;
      setApiKeyConfigured(!!s.openaiApiKeyConfigured);
      setApiKeyTail(s.openaiApiKeyTail || '');
      setSearchKeyConfigured(!!s.searchApiKeyConfigured);
      setSearchKeyTail(s.searchApiKeyTail || '');
      // 清空 key 输入框
      setOpenaiApiKey('');
      setSearchApiKey('');
      toastSuccess('设置已保存');
    } catch (e: any) {
      toastError(e.message || '保存失败');
    } finally {
      setCloudSaving(false);
    }
  };

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
      {/* Cloud API */}
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white flex items-center gap-2">
              <Globe className="w-5 h-5 text-blue-400" />
              云端模型 API
            </h2>
            <p className="text-[var(--color-text-secondary)] text-sm mt-1">
              配置 OpenAI 兼容接口与 Tavily 搜索，支持所有云端模型服务
            </p>
          </div>
        </div>

        {cloudLoading ? (
          <div className="p-8 flex justify-center text-[var(--color-text-muted)]">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : (
          <div className="p-5 bg-[var(--color-card-bg)] rounded-xl border border-[var(--color-border)] space-y-5">
            {/* Base URL */}
            <div>
              <label className="block text-sm text-[var(--color-text-secondary)] mb-2">
                API 接口地址 (Base URL)
              </label>
              <input
                type="text"
                value={openaiBaseUrl}
                onChange={(e) => setOpenaiBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1"
                className="w-full px-4 py-2.5 bg-[#0f1419] border border-[var(--color-border)] rounded-lg text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)] text-sm font-mono"
              />
              <p className="text-xs text-[var(--color-text-muted)] mt-2">
                支持任何 OpenAI 兼容的服务，如 OpenAI 官方、DeepSeek、通义千问、Moonshot 等
              </p>
            </div>

            {/* API Key */}
            <div>
              <label className="block text-sm text-[var(--color-text-secondary)] mb-2">
                <Key className="w-4 h-4 inline mr-1.5 -mt-0.5" />
                API Key
              </label>
              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={openaiApiKey}
                  onChange={(e) => setOpenaiApiKey(e.target.value)}
                  placeholder={
                    apiKeyConfigured
                      ? `已配置 (尾号 ${apiKeyTail}${apiKeyTail.length < 4 ? '' : ''})，留空则不修改`
                      : 'sk-...'
                  }
                  className="w-full px-4 py-2.5 pr-12 bg-[#0f1419] border border-[var(--color-border)] rounded-lg text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)] text-sm font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
                >
                  {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {apiKeyConfigured && (
                <div className="flex items-center gap-1.5 mt-2 text-xs text-emerald-400">
                  <CheckCircle className="w-3.5 h-3.5" />
                  API Key 已配置
                </div>
              )}
            </div>

            {/* Chat model + Embedding model */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-[var(--color-text-secondary)] mb-2">
                  对话模型
                </label>
                <input
                  type="text"
                  value={chatModel}
                  onChange={(e) => setChatModel(e.target.value)}
                  placeholder="gpt-4o-mini"
                  className="w-full px-4 py-2.5 bg-[#0f1419] border border-[var(--color-border)] rounded-lg text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)] text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-sm text-[var(--color-text-secondary)] mb-2">
                  向量模型 (Embedding)
                </label>
                <input
                  type="text"
                  value={embeddingModel}
                  onChange={(e) => setEmbeddingModel(e.target.value)}
                  placeholder="text-embedding-3-small"
                  className="w-full px-4 py-2.5 bg-[#0f1419] border border-[var(--color-border)] rounded-lg text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)] text-sm font-mono"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-[var(--color-border)]" />

            {/* Search API Key */}
            <div>
              <label className="block text-sm text-[var(--color-text-secondary)] mb-2">
                联网搜索 API Key (Tavily)
              </label>
              <div className="relative">
                <input
                  type={showSearchKey ? 'text' : 'password'}
                  value={searchApiKey}
                  onChange={(e) => setSearchApiKey(e.target.value)}
                  placeholder={
                    searchKeyConfigured
                      ? `已配置 (尾号 ${searchKeyTail})，留空则不修改`
                      : 'tvly-...'
                  }
                  className="w-full px-4 py-2.5 pr-12 bg-[#0f1419] border border-[var(--color-border)] rounded-lg text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)] text-sm font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowSearchKey(!showSearchKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
                >
                  {showSearchKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {searchKeyConfigured && (
                <div className="flex items-center gap-1.5 mt-2 text-xs text-emerald-400">
                  <CheckCircle className="w-3.5 h-3.5" />
                  搜索 API Key 已配置
                </div>
              )}
              <p className="text-xs text-[var(--color-text-muted)] mt-2">
                前往：<a href="https://tavily.com" target="_blank" rel="noreferrer" className="underline">tavily.com</a> 获取免费 Key
              </p>
            </div>

            {/* Save button */}
            <div className="pt-2 flex justify-end">
              <button
                onClick={saveCloudSettings}
                disabled={cloudSaving}
                className="px-5 py-2.5 bg-[var(--color-primary)] hover:opacity-90 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-opacity flex items-center gap-2"
              >
                {cloudSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                {cloudSaving ? '保存中...' : '保存设置'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-[var(--color-border)]" />

      {/* Stream output toggle */}
      <div className="flex items-center justify-between max-w-md pt-2">
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
