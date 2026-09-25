import { tavilySearch, TavilyResult } from '../routes/search';
import { chatCompletion } from '../services/ai';
import {
  insertOne,
} from '../storage/json-storage';
import { TaskExecutor, TaskContext, TaskResult } from './registry';

// 追踪简报执行器
// 权限依赖: SEARCH + LLM + WRITE (+ NOTIFY 可选，由调度层处理)
export function createTrackingExecutor(): TaskExecutor {
  return {
    requiredPermissions: ['SEARCH', 'LLM', 'WRITE'],

    async execute(ctx: TaskContext): Promise<TaskResult> {
      const { project } = ctx;
      const startTime = Date.now();

      try {
        // 1. 联网搜索（SEARCH 权限已在调度层校验）
        const searchResult = await tavilySearch(project.topic, {
          maxResults: 5,
          searchDepth: 'basic',
        });

        const results = searchResult.results || [];
        if (results.length === 0) {
          return {
            success: true,
            summary: `未找到与「${project.topic}」相关的新信息`,
            items_found: 0,
          };
        }

        // 2. 调用 LLM 生成简报（LLM 权限已校验）
        const sourcesText = (results as TavilyResult[])
          .map(
            (r: TavilyResult, i: number) =>
              `[${i + 1}] ${r.title}\n   来源: ${r.url}\n   摘要: ${r.content}`,
          )
          .join('\n\n');

        const prompt = `你是一个专业的信息整理助手。请根据以下搜索结果，为主题「${project.topic}」生成一份结构化的追踪简报。

要求：
1. 使用 Markdown 格式
2. 结构：
   ## 主题概况
   （一句话概括当前这个领域/话题的整体态势）

   ## 核心要点
   （3-5 条最重要的信息，每条简练明确）

   ## 详细动态
   （按重要性排序的具体动态，每条包含时间/来源/要点）

   ## 信息来源
   （列出所有引用的来源链接，标注序号对应正文）

3. 只基于搜索结果内容，不要编造信息
4. 语言简洁专业，适合快速阅读
5. 总字数控制在 800-1200 字

搜索结果：
${sourcesText}`;

        const llmResult = await chatCompletion([
          { role: 'system', content: '你是一个严谨的信息整理专家，擅长从海量信息中提炼核心要点。' },
          { role: 'user', content: prompt },
        ]);

        const content = llmResult.content || '';
        const brief = content.slice(0, 200).replace(/\n/g, ' ');

        // 3. 保存为笔记（WRITE 权限已校验）
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10);
        const noteTitle = `【追踪简报】${project.name} - ${dateStr}`;

        const note = insertOne('notes', {
          id: crypto.randomUUID(),
          user_id: ctx.userId,
          title: noteTitle,
          content,
          tags: ['追踪简报', project.name],
          is_pinned: false,
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
        });

        return {
          success: true,
          summary:
            brief.length < content.length ? brief + '...' : brief,
          briefing_note_id: note.id,
          items_found: results.length,
        };
      } catch (err: any) {
        return {
          success: false,
          error_code: err.error_code || 'TASK_FAILED',
          error_message: err.message || String(err),
        };
      }
    },
  };
}
