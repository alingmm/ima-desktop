import os from 'os';
import path from 'path';
import fs from 'fs';

// 用户数据目录优先级：环境变量 IMA_USER_DATA_DIR > 家目录 .ima-workstation
export function getUserDataDir(): string {
  const envDir = process.env.IMA_USER_DATA_DIR;
  if (envDir) {
    return envDir;
  }
  return path.join(os.homedir(), '.ima-workstation');
}

// 确保目录存在
export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// 配置文件路径
export function getConfigPath(): string {
  return path.join(getUserDataDir(), 'config.json');
}

// 数据文件目录
export function getDataDir(): string {
  return path.join(getUserDataDir(), 'data');
}

// 上传文件目录
export function getUploadsDir(): string {
  return path.join(getUserDataDir(), 'uploads');
}

// 初始化所有数据目录（启动时调用一次）
export function initDataDirs(): void {
  ensureDir(getUserDataDir());
  ensureDir(getDataDir());
  ensureDir(getUploadsDir());
}

// ========== 配置类型 ==========
export interface AppConfig {
  openaiBaseUrl: string;
  openaiApiKey: string;
  chatModel: string;
  embeddingModel: string;
  searchApiKey: string;
  searchProvider: string;
}

const DEFAULT_CONFIG: AppConfig = {
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiApiKey: '',
  chatModel: 'gpt-4o-mini',
  embeddingModel: 'text-embedding-3-small',
  searchApiKey: '',
  searchProvider: 'tavily',
};

let cachedConfig: AppConfig | null = null;

// 加载配置
export function loadConfig(): AppConfig {
  if (cachedConfig) {
    return { ...cachedConfig };
  }

  const configPath = getConfigPath();
  ensureDir(getUserDataDir());

  if (!fs.existsSync(configPath)) {
    cachedConfig = { ...DEFAULT_CONFIG };
    saveConfig(cachedConfig);
    return { ...cachedConfig };
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    cachedConfig = { ...DEFAULT_CONFIG, ...parsed } as AppConfig;
    return { ...cachedConfig };
  } catch {
    cachedConfig = { ...DEFAULT_CONFIG };
    return { ...cachedConfig };
  }
}

// 保存配置
export function saveConfig(config: Partial<AppConfig>): AppConfig {
  const current = cachedConfig || loadConfig();
  const updated: AppConfig = { ...current, ...config } as AppConfig;

  const configPath = getConfigPath();
  ensureDir(getUserDataDir());
  fs.writeFileSync(configPath, JSON.stringify(updated, null, 2), 'utf-8');

  cachedConfig = updated;
  return { ...updated };
}

// 脱敏后的配置（用于返回前端）
export function sanitizeConfig(config: AppConfig): Omit<AppConfig, 'openaiApiKey' | 'searchApiKey'> & {
  openaiApiKeyConfigured: boolean;
  openaiApiKeyTail?: string;
  searchApiKeyConfigured: boolean;
  searchApiKeyTail?: string;
} {
  return {
    openaiBaseUrl: config.openaiBaseUrl,
    chatModel: config.chatModel,
    embeddingModel: config.embeddingModel,
    searchProvider: config.searchProvider,
    openaiApiKeyConfigured: config.openaiApiKey.length > 0,
    openaiApiKeyTail: config.openaiApiKey.length >= 4 ? config.openaiApiKey.slice(-4) : undefined,
    searchApiKeyConfigured: config.searchApiKey.length > 0,
    searchApiKeyTail: config.searchApiKey.length >= 4 ? config.searchApiKey.slice(-4) : undefined,
  };
}

// 兼容旧名
export const getSafeConfig = () => sanitizeConfig(loadConfig());
