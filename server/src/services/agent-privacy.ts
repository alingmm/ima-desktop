// 自主执行隐私设置服务（需求10）
// 控制 goal/ReAct 执行链路的联网、抓取、外部软件与模型偏好，本地 JSON 存储
import {
  insertOne,
  findOne,
  updateById,
  AgentPrivacySettingRecord,
} from '../storage/json-storage';

export const DEFAULT_AGENT_PRIVACY: Omit<
  AgentPrivacySettingRecord,
  'id' | 'user_id' | 'created_at' | 'updated_at'
> = {
  // 默认偏保守：联网与抓取默认允许（这是感知的主要来源），外部软件默认关
  allow_web_search: true,
  allow_web_capture: true,
  allow_external_tools: false,
  model_preference: 'default',
  local_model: '',
};

export function getAgentPrivacy(userId: string): AgentPrivacySettingRecord {
  const existing = findOne('agent_privacy_settings', {
    user_id: userId,
  } as Partial<AgentPrivacySettingRecord>);
  if (existing) return { ...DEFAULT_AGENT_PRIVACY, ...existing };
  // 不落库，仅返回默认值（首次保存时才写）
  return {
    ...DEFAULT_AGENT_PRIVACY,
    id: `agent-privacy-${userId}`,
    user_id: userId,
  } as AgentPrivacySettingRecord;
}

export function saveAgentPrivacy(
  userId: string,
  patch: Partial<Pick<
    AgentPrivacySettingRecord,
    | 'allow_web_search'
    | 'allow_web_capture'
    | 'allow_external_tools'
    | 'model_preference'
    | 'local_model'
  >>,
): AgentPrivacySettingRecord {
  const now = new Date().toISOString();
  const existing = findOne('agent_privacy_settings', {
    user_id: userId,
  } as Partial<AgentPrivacySettingRecord>);

  if (existing) {
    return updateById('agent_privacy_settings', existing.id, {
      ...patch,
      updated_at: now,
    }) as AgentPrivacySettingRecord;
  }

  return insertOne('agent_privacy_settings', {
    id: `agent-privacy-${userId}`,
    user_id: userId,
    ...DEFAULT_AGENT_PRIVACY,
    ...patch,
    created_at: now,
    updated_at: now,
  } as AgentPrivacySettingRecord);
}
