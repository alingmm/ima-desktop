import { useState, useEffect } from 'react';
import { Settings, User, Palette, Bell, Shield, HelpCircle, ChevronRight, Save, Cpu, RefreshCw, Download, CheckCircle, AlertCircle, Loader2, Key, Globe, Eye, EyeOff, Terminal, AppWindow, ScrollText, Play } from 'lucide-react';
import { localModelApi, settingsApi, toolsApi } from '../api';
import type { OllamaModel } from '../types';
import type { ToolActionType, ToolPolicyLevel, ToolExecutionLogItem } from '../api';
import { useLocalSettings } from '../hooks/useLocalSettings';
import { useToast } from '../components/Toast';

type SettingsSection = 'profile' | 'appearance' | 'models' | 'notifications' | 'tools' | 'security' | 'about';

// OpenAI 兼容服务预设
interface ServicePreset {
  name: string;
  baseUrl: string;
  chatModel: string;
  embeddingModel: string;
}
const SERVICE_PRESETS: ServicePreset[] = [
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', chatModel: 'deepseek-chat', embeddingModel: 'text-embedding-ada-002' },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', chatModel: 'gpt-4o-mini', embeddingModel: 'text-embedding-3-small' },
  { name: '硅基流动 (SiliconFlow)', baseUrl: 'https://api.siliconflow.cn/v1', chatModel: 'deepseek-ai/DeepSeek-V3', embeddingModel: 'BAAI/bge-m3' },
  { name: '智谱 (GLM)', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', chatModel: 'glm-4-flash', embeddingModel: 'embedding-2' },
  { name: '通义千问 (阿里百炼)', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', chatModel: 'qwen-plus', embeddingModel: 'text-embedding-v3' },
];
const CUSTOM_PRESET = 'custom';

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
    { id: 'tools' as SettingsSection, label: '外部调用', icon: Terminal },
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

      case 'tools':
        return <ExternalToolsSettings />;

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
  const [selectedPreset, setSelectedPreset] = useState('');
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

  // 应用某个服务预设后回填 baseUrl/chatModel/embeddingModel，用户仍可微调
  const handlePresetChange = (presetId: string) => {
    setSelectedPreset(presetId);
    if (presetId === CUSTOM_PRESET) return;
    const preset = SERVICE_PRESETS.find((p) => p.name === presetId);
    if (preset) {
      setOpenaiBaseUrl(preset.baseUrl);
      setChatModel(preset.chatModel);
      setEmbeddingModel(preset.embeddingModel);
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
            {/* 预设服务 */}
            <div>
              <label className="block text-sm text-[var(--color-text-secondary)] mb-2">
                选择服务商（可再微调下方字段）
              </label>
              <select
                value={selectedPreset || 'custom'}
                onChange={(e) => handlePresetChange(e.target.value)}
                className="w-full px-4 py-2.5 bg-[#0f1419] border border-[var(--color-border)] rounded-lg text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)] text-sm"
              >
                <option value={CUSTOM_PRESET}>自定义 / 手动填写</option>
                {SERVICE_PRESETS.map((p) => (
                  <option key={p.name} value={p.name}>{p.name}</option>
                ))}
              </select>
              <p className="text-xs text-[var(--color-text-muted)] mt-2">
                选择预设会自动填入正确的接口地址与默认模型，避免填写错误
              </p>
            </div>

            {/* Base URL */}
            <div>
              <label className="block text-sm text-[var(--color-text-secondary)] mb-2">
                API 接口地址 (Base URL)
              </label>
              <input
                type="text"
                value={openaiBaseUrl}
                onChange={(e) => { setOpenaiBaseUrl(e.target.value); setSelectedPreset(CUSTOM_PRESET); }}
                placeholder="https://api.openai.com/v1"
                className="w-full px-4 py-2.5 bg-[#0f1419] border border-[var(--color-border)] rounded-lg text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)] text-sm font-mono"
              />
              <p className="text-xs text-[var(--color-text-muted)] mt-2">
                只需填到版本号(/v1)即可，请勿粘贴完整的 /chat/completions 端点；系统会自动处理
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

// ========== 外部调用设置（权限分级 + 手动测试 + 执行日志） ==========
const POLICY_LEVEL_LABELS: Record<ToolPolicyLevel, string> = {
  auto: '自动执行',
  confirm: '每次确认',
  deny: '禁用',
};

const ACTION_TYPE_META: { type: ToolActionType; label: string; desc: string; icon: typeof Terminal }[] = [
  {
    type: 'open_app',
    label: '打开应用 / 链接',
    desc: 'AI 执行任务时可以打开电脑上的应用、文件或网址',
    icon: AppWindow,
  },
  {
    type: 'run_command',
    label: '执行系统命令',
    desc: 'AI 执行任务时可以在电脑上运行命令（如查看目录、读取系统信息）',
    icon: Terminal,
  },
];

function ExternalToolsSettings() {
  const { success: toastSuccess, error: toastError } = useToast();
  const [policies, setPolicies] = useState<Record<ToolActionType, ToolPolicyLevel>>({
    open_app: 'auto',
    run_command: 'confirm',
  });
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<ToolExecutionLogItem[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [testType, setTestType] = useState<ToolActionType>('run_command');
  const [testTarget, setTestTarget] = useState('');
  const [testRunning, setTestRunning] = useState(false);
  const [testOutput, setTestOutput] = useState('');

  const loadLogs = async () => {
    setLogsLoading(true);
    try {
      const res = await toolsApi.getLogs(50);
      setLogs(res.logs || []);
    } catch {
      // 静默
    } finally {
      setLogsLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await toolsApi.getPolicy();
        setPolicies(res);
      } catch (e: any) {
        toastError(e?.message || '加载权限设置失败');
      } finally {
        setLoading(false);
      }
      loadLogs();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChangeLevel = async (type: ToolActionType, level: ToolPolicyLevel) => {
    const prev = policies[type];
    setPolicies((p) => ({ ...p, [type]: level }));
    try {
      await toolsApi.savePolicy({ [type]: level });
      toastSuccess('权限设置已保存');
    } catch (e: any) {
      setPolicies((p) => ({ ...p, [type]: prev }));
      toastError(e?.message || '保存失败，请重试');
    }
  };

  const handleTest = async () => {
    const target = testTarget.trim();
    if (!target || testRunning) return;
    setTestRunning(true);
    setTestOutput('');
    try {
      const res = await toolsApi.run(testType, target);
      if (res.status === 'pending') {
        toastSuccess('该操作需要确认，请在弹出的确认窗口中处理');
        setTestOutput('（已提交，等待你在确认弹窗中批准/拒绝）');
      } else {
        setTestOutput(res.output || (res.ok ? '（执行完成，无输出）' : '（执行失败）'));
      }
      loadLogs();
    } catch (e: any) {
      toastError(e?.message || '执行失败');
      setTestOutput(`执行失败：${e?.message || '未知错误'}`);
    } finally {
      setTestRunning(false);
    }
  };

  const formatTime = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white">外部调用</h2>
        <p className="text-[var(--color-text-secondary)] text-sm mt-1">
          管理 AI 在自主执行任务时调用电脑能力的权限。高风险操作（删除、改系统设置等）无论如何设置都会先经你确认。
        </p>
      </div>

      {/* 权限分级 */}
      <div className="space-y-3">
        {ACTION_TYPE_META.map(({ type, label, desc, icon: Icon }) => (
          <div
            key={type}
            className="flex items-center gap-4 p-4 bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-xl"
          >
            <div className="w-10 h-10 rounded-lg bg-[var(--color-hover-bg)] flex items-center justify-center flex-shrink-0">
              <Icon size={18} className="text-[var(--color-text-secondary)]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white">{label}</p>
              <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">{desc}</p>
            </div>
            <select
              value={policies[type]}
              disabled={loading}
              onChange={(e) => handleChangeLevel(type, e.target.value as ToolPolicyLevel)}
              className="px-3 py-2 bg-[var(--color-main-bg)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)] disabled:opacity-50"
            >
              {(Object.keys(POLICY_LEVEL_LABELS) as ToolPolicyLevel[]).map((lv) => (
                <option key={lv} value={lv}>
                  {POLICY_LEVEL_LABELS[lv]}
                </option>
              ))}
            </select>
          </div>
        ))}
        <div className="flex items-start gap-2 px-1">
          <Shield size={14} className="text-[var(--color-text-secondary)] flex-shrink-0 mt-0.5" />
          <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
            说明：打开网址链接默认安全；涉及删除文件、修改系统、结束进程等高风险命令，系统会强制弹出确认窗口并给出红色风险提示，无法被设置为自动执行。
          </p>
        </div>
      </div>

      {/* 手动测试 */}
      <div className="p-4 bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-xl space-y-3">
        <h3 className="text-sm font-medium text-white flex items-center gap-2">
          <Play size={15} className="text-[var(--color-text-secondary)]" />
          试一下
        </h3>
        <div className="flex gap-2">
          <select
            value={testType}
            onChange={(e) => setTestType(e.target.value as ToolActionType)}
            className="px-3 py-2 bg-[var(--color-main-bg)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)]"
          >
            <option value="run_command">执行命令</option>
            <option value="open_app">打开应用/链接</option>
          </select>
          <input
            type="text"
            value={testTarget}
            onChange={(e) => setTestTarget(e.target.value)}
            placeholder={testType === 'run_command' ? '例如：echo hello 或 ls' : '例如：https://www.example.com 或文件路径'}
            className="flex-1 px-3 py-2 bg-[var(--color-main-bg)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)] placeholder:text-[var(--color-text-tertiary)]"
            onKeyDown={(e) => e.key === 'Enter' && handleTest()}
          />
          <button
            onClick={handleTest}
            disabled={testRunning || !testTarget.trim()}
            className="px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white text-sm rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-1.5"
          >
            {testRunning && <Loader2 size={14} className="animate-spin" />}
            执行
          </button>
        </div>
        {testOutput && (
          <pre className="text-xs text-[var(--color-text-secondary)] bg-[var(--color-main-bg)] border border-[var(--color-border)] rounded-lg p-3 max-h-40 overflow-y-auto whitespace-pre-wrap break-all font-mono">
            {testOutput}
          </pre>
        )}
      </div>

      {/* 执行日志 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-white flex items-center gap-2">
            <ScrollText size={15} className="text-[var(--color-text-secondary)]" />
            最近调用记录
          </h3>
          <button
            onClick={loadLogs}
            disabled={logsLoading}
            className="text-xs text-[var(--color-text-secondary)] hover:text-white flex items-center gap-1 transition-colors"
          >
            <RefreshCw size={12} className={logsLoading ? 'animate-spin' : ''} />
            刷新
          </button>
        </div>
        {logs.length === 0 ? (
          <p className="text-xs text-[var(--color-text-tertiary)] px-1">暂无调用记录</p>
        ) : (
          <div className="border border-[var(--color-border)] rounded-xl overflow-hidden divide-y divide-[var(--color-border)]">
            {logs.map((log) => (
              <div key={log.id} className="px-4 py-3 bg-[var(--color-card-bg)] flex items-start gap-3">
                <span
                  className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${log.ok ? 'bg-[var(--color-success,#3fb950)]' : 'bg-[var(--color-danger,#f85149)]'}`}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium text-white">
                      {log.action_type === 'run_command' ? '执行命令' : '打开应用/链接'}
                    </span>
                    {log.risk_level === 'high' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/30">
                        高风险
                      </span>
                    )}
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-hover-bg)] text-[var(--color-text-secondary)]">
                      {log.source === 'agent' ? '自主任务' : '手动'}
                    </span>
                    <span className="text-[10px] text-[var(--color-text-tertiary)] ml-auto">
                      {formatTime(log.created_at)}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--color-text-secondary)] mt-1 break-all font-mono">
                    {log.action_detail}
                  </p>
                  <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5 line-clamp-2">
                    {log.result_summary}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
