import { chatCompletion } from './ai';
import {
  selectAll,
  insertOne,
  MemoryCategory,
} from '../storage/json-storage';

// ========== 记忆召回（关键词/子串匹配，不强依赖向量模型） ==========
export function recallMemories(
  userId: string,
  query: string,
  limit = 5,
): { id: string; content: string; category: MemoryCategory; created_at: string }[] {
  if (!query || !query.trim()) return [];

  const q = query.trim().toLowerCase();
  const all = selectAll('memories').filter((m) => m.user_id === userId);
  const keywords = q
    .split(/[\s\p{P}]+/u)
    .filter((w) => w.length > 1);

  const scored = all
    .map((mem) => {
      const text = (mem.content || '').toLowerCase();
      let score = 0;
      // 子串匹配
      if (q.length > 1 && text.includes(q)) score += 3;
      // 关键词命中
      if (keywords.length > 0) {
        for (const kw of keywords) {
          if (text.includes(kw)) score += 1;
        }
      }
      // 标签命中
      for (const tag of mem.tags || []) {
        if (q.includes(tag.toLowerCase()) || tag.toLowerCase().includes(q)) score += 2;
      }
      return { mem, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map((x) => ({
    id: x.mem.id,
    content: x.mem.content,
    category: x.mem.category,
    created_at: x.mem.created_at,
  }));
}

// ========== 自动记忆：对话结束后提炼值得长期记住的信息 ==========
export async function extractMemoryFromConversation(
  userId: string,
  userText: string,
  assistantText: string,
): Promise<boolean> {
  try {
    if (!userText.trim() || !assistantText.trim()) return false;

    const prompt = `请判断以下这段用户与 AI 的对话中，是否存在值得长期记住的信息（如用户偏好、个人事实、结论、重要决定等）。仅当信息对未来的对话有长期价值时才输出，可忽略日常寒暄、临时问题、一次性请求。

对话内容：
用户：${userText.slice(0, 1000)}
AI：${assistantText.slice(0, 1500)}

请按以下 JSON 格式输出（不要输出其他内容）：
- 若有值得记住的信息：{"has_memory": true, "category": "偏好|事实|结论|任务", "content": "提炼成一句简洁、具体、可长期使用的记忆，不超过60字"}
- 若没有：{"has_memory": false}`;

    const result = await chatCompletion([
      { role: 'system', content: '你是一个善于从对话中提炼长期记忆的助手，只输出 JSON。' },
      { role: 'user', content: prompt },
    ], { temperature: 0.3 });

    const content = (result.content || '').trim().replace(/^```json\s*|\s*```$/g, '');
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      // 尝试从花括号中提取
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) return false;
      parsed = JSON.parse(m[0]);
    }

    if (!parsed || parsed.has_memory !== true || !parsed.content) return false;

    const content2 = String(parsed.content).trim();
    if (!content2) return false;

    const category: MemoryCategory =
      parsed.category === '偏好' || parsed.category === '事实' ||
      parsed.category === '结论' || parsed.category === '任务'
        ? parsed.category
        : '事实';

    // 去重：若已有高度相似的记忆则跳过
    if (isDuplicate(userId, content2)) {
      return false;
    }

    const now = new Date().toISOString();
    insertOne('memories', {
      id: crypto.randomUUID(),
      user_id: userId,
      content: content2,
      category,
      tags: [category],
      created_at: now,
      updated_at: now,
    });
    return true;
  } catch (err) {
    // 记忆提炼失败不影响主流程
    console.error('Memory extraction error:', err);
    return false;
  }
}

// 去重：用简单文本相似度判断
function isDuplicate(userId: string, content: string): boolean {
  const all = selectAll('memories').filter((m) => m.user_id === userId);
  const c = content.toLowerCase();
  for (const mem of all) {
    const existing = (mem.content || '').toLowerCase();
    // 完全包含 或 简短文本高度相似
    if (existing.includes(c) || c.includes(existing)) return true;
    if (existing.length > 5 && similarity(existing, c) > 0.8) return true;
  }
  return false;
}

// 简单的字符级相似度（bigram Jaccard）
function similarity(a: string, b: string): number {
  const bigrams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const setA = bigrams(a);
  const setB = bigrams(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let inter = 0;
  for (const x of setA) if (setB.has(x)) inter++;
  return inter / setA.size;
}