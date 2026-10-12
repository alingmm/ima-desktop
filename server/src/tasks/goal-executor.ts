import { tavilySearch, TavilyResult } from '../routes/search';
import { chatCompletion } from '../services/ai';
import {
  insertOne,
  selectAll,
  MemoryCategory,
} from '../storage/json-storage';
import { TaskExecutor, TaskContext, TaskResult } from './registry';

// 自主执行（目标 Agent）执行器 —— 实现 ReAct 循环
// 权限依赖: SEARCH + LLM + WRITE (+ 内部会用到 remember 写入记忆)

interface ToolResult {
  ok: boolean;
  output: string;
}

// 可用工具实现
async function runTool(
  userId: string,
  action: string,
  args: any,
): Promise<ToolResult> {
  switch (action) {
    case 'search': {
      const query = String(args?.query || args?.keyword || '').trim();
      if (!query) return { ok: false, output: '搜索缺少 query 参数' };
      const res = await tavilySearch(query, { maxResults: 5, searchDepth: 'basic' });
      const results = (res.results || []).slice(0, 5);
      if (results.length === 0) return { ok: true, output: '未找到相关结果' };
      const text = results
        .map(
          (r: TavilyResult, i: number) =>
            `[${i + 1}] ${r.title}\n链接：${r.url}\n摘要：${r.content}`,
        )
        .join('\n\n');
      return { ok: true, output: text };
    }

    case 'write_note': {
      const title = String(args?.title || '自主执行结果').slice(0, 120);
      const content = String(args?.content || '').trim();
      if (!content) return { ok: false, output: '笔记内容为空' };
      const now = new Date().toISOString();
      const note = insertOne('notes', {
        id: crypto.randomUUID(),
        user_id: userId,
        title,
        content,
        tags: ['自主执行', ...((args?.tags as string[]) || [])].slice(0, 5),
        is_pinned: false,
        created_at: now,
        updated_at: now,
      });
      return { ok: true, output: `已将结果保存为笔记「${title}」(id: ${note.id})` };
    }

    case 'remember': {
      const content = String(args?.content || '').trim();
      const categoryRaw = String(args?.category || '事实');
      if (!content) return { ok: false, output: '记忆内容为空' };
      const category: MemoryCategory =
        categoryRaw === '偏好' || categoryRaw === '结论' || categoryRaw === '任务' || categoryRaw === '事实'
          ? categoryRaw
          : '事实';
      const now = new Date().toISOString();
      insertOne('memories', {
        id: crypto.randomUUID(),
        user_id: userId,
        content,
        category,
        tags: [category],
        created_at: now,
        updated_at: now,
      });
      return { ok: true, output: `已记住：「${content}」` };
    }

    default:
      return { ok: false, output: `未知工具: ${action}` };
  }
}

export function createGoalExecutor(): TaskExecutor {
  return {
    requiredPermissions: ['SEARCH', 'LLM', 'WRITE'],

    async execute(ctx: TaskContext): Promise<TaskResult> {
      const { project } = ctx;
      const goal = project.topic; // 目标描述存于 topic 字段

      const steps: string[] = [];
      const runLog: string[] = [];

      try {
        let stepSummary = '';
        let done = false;
        let finalAnswer = '';
        const maxSteps = 5;

        for (let round = 0; round < maxSteps && !done; round++) {
          runLog.push(`第 ${round + 1} 轮：调用大模型进行规划与决策`);

          const prompt = `你是一个能够自主规划并调用工具完成任务的全能助手。你的目标：
${goal}

${stepSummary ? `已执行过的动作与结果（供你参考，避免重复）：\n${stepSummary}` : '你还没有执行任何动作。'}

可用工具：${process.env.__TOOLS__ || 'search（联网搜索，参数 query）、write_note（保存笔记，参数 title/content）、remember（记住一条记忆，参数 content/category）'}

请严格按以下 JSON 格式输出（不要输出 JSON 以外的任何内容）：
{
  "thought": "你对当前情况的简要思考",
  "action": "search | write_note | remember | 以上都不是则为空字符串",
  "args": { "相应参数": "..." },
  "done": false,
  "final_answer": "完成时填写最终答案，未完成则留空"
}

要求：
- 如果任务需要更多信息，使用 search 工具去搜索。
- 如果已经获得足够信息并完成任务，设置 done=true 并用 final_answer 给出完整、用户可读的最终结果。
- 若不需要搜索即可直接回答，直接 done=true。
- final_answer 使用中文，结构清晰。`;

          // 让工具清单真实注入
          const realPrompt = prompt.replace(
            '__TOOLS__',
            'search（参数 query）、write_note（参数 title/content）、remember（参数 content/category）',
          );

          const llmResult = await chatCompletion(
            [
              { role: 'system', content: '你是一个强推理、善规划的自主 Agent，只输出合法 JSON。' },
              { role: 'user', content: realPrompt },
            ],
            { temperature: 0.5 },
          );

          const raw = (llmResult.content || '').trim();
          let decision: any = null;
          try {
            const cleaned = raw.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
            decision = JSON.parse(cleaned);
          } catch {
            const m = raw.match(/\{[\s\S]*\}/);
            if (m) {
              try {
                decision = JSON.parse(m[0]);
              } catch {
                decision = null;
              }
            }
          }

          if (!decision) {
            runLog.push(`第 ${round + 1} 轮：无法解析模型输出，尝试直接作为结果`);
            finalAnswer = raw;
            done = true;
            break;
          }

          const thought = String(decision.thought || '').trim();
          if (thought) runLog.push(`思考：${thought}`);

          const action = String(decision.action || '').trim();
          const args = decision.args || {};

          if (action && ['search', 'write_note', 'remember'].includes(action)) {
            runLog.push(`执行工具：${action}`);
            const toolResult = await runTool(ctx.userId, action, args);
            runLog.push(
              toolResult.ok
                ? `工具 ${action} 成功：${toolResult.output.slice(0, 200)}`
                : `工具 ${action} 失败：${toolResult.output}`,
            );
            stepSummary += `\n[动作 ${action}] ${JSON.stringify(args)}\n结果：${toolResult.output}\n`;
          } else if (action) {
            runLog.push(`未知动作「${action}」，忽略`);
          }

          if (decision.done || action === '') {
            done = true;
            finalAnswer = String(decision.final_answer || '').trim() || raw;
          }
        }

        if (!done && finalAnswer === '') {
          finalAnswer = '已达到最大执行轮数，仍需人工确认';
        }

        const noteTitle = `【自主执行】${project.name}`;
        const content = `# 自主执行结果：${project.name}\n\n## 目标\n${goal}\n\n## 执行过程\n${runLog.join('\n')}\n\n## 最终结果\n${finalAnswer}`;

        // 写入笔记（WRITE 权限已校验）
        const now = new Date().toISOString();
        const note = insertOne('notes', {
          id: crypto.randomUUID(),
          user_id: ctx.userId,
          title: noteTitle,
          content,
          tags: ['自主执行', project.name],
          is_pinned: false,
          created_at: now,
          updated_at: now,
        });

        const brief = finalAnswer.replace(/\n/g, ' ').slice(0, 200);

        return {
          success: true,
          summary: brief,
          briefing_note_id: note.id,
          items_found: runLog.length,
          process_log: runLog,
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