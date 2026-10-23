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
      const modelUsed = project.model || '默认模型';
      const maxRounds = project.max_rounds && project.max_rounds > 0 ? project.max_rounds : 10;

      // 断点续跑：从上次暂停的快照恢复中间状态；无快照则全新开始
      const resume = ctx.resumeState;
      const runLog: string[] = resume ? [...resume.run_log] : [];
      let stepSummary = resume?.step_summary || '';
      let finalAnswer = resume?.final_answer || '';
      const startRound = resume?.round || 0;

      // 用户补充/纠偏指令注入，作为后续轮次的新约束
      if (ctx.userGuidance && ctx.userGuidance.trim()) {
        const g = ctx.userGuidance.trim();
        runLog.push(`[${new Date().toLocaleTimeString()}] 你补充/纠正了方向：${g}`);
        stepSummary += `\n[用户补充要求，需遵循] ${g}\n`;
      }

      const log = (text: string) => runLog.push(`[${new Date().toLocaleTimeString()}] ${text}`);

      try {
        let done = false;
        let paused = false;
        let confirmPrompt = '';
        let executedRounds = 0;
        let noProgressCount = 0;

        for (let i = 0; i < maxRounds && !done && !paused; i++) {
          const round = startRound + i;
          executedRounds = i + 1;
          log(`第 ${round + 1} 轮：调用大模型「${modelUsed}」规划下一步动作`);

          const prompt = `你是一个能够自主规划并调用工具完成任务的全能助手。你的目标：
${goal}

${stepSummary ? `已执行过的动作与结果（供你参考，避免重复）：\n${stepSummary}` : '你还没有执行任何动作。'}

可用工具：search（联网搜索，参数 query）、write_note（保存笔记，参数 title/content）、remember（记住一条记忆，参数 content/category）

请严格按以下 JSON 格式输出（不要输出 JSON 以外的任何内容）：
{
  "thought": "你对当前情况的简要思考",
  "action": "search | write_note | remember | 以上都不是则为空字符串",
  "args": { "相应参数": "..." },
  "done": false,
  "final_answer": "完成时填写最终答案，未完成则留空",
  "need_user_input": false,
  "user_question": ""
}

要求：
- 如果任务需要更多信息，使用 search 工具去搜索。
- 如果已经获得足够信息并完成任务，设置 done=true 并用 final_answer 给出完整、用户可读的最终结果。
- 若不需要搜索即可直接回答，直接 done=true。
- 如果你在关键阶段拿不准方向、或需要用户补充信息/确认方向再继续，设置 need_user_input=true，并在 user_question 里用中文大白话写清楚你想问用户什么（此时 done=false、action 留空）。
- final_answer 使用中文，结构清晰。`;

          const llmResult = await chatCompletion(
            [
              { role: 'system', content: '你是一个强推理、善规划的自主 Agent，只输出合法 JSON。' },
              { role: 'user', content: prompt },
            ],
            { temperature: 0.5, ...(project.model ? { model: project.model } : {}) },
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
            log(`第 ${round + 1} 轮：模型输出无法解析，直接把当前内容作为结果`);
            finalAnswer = raw;
            done = true;
            break;
          }

          const thought = String(decision.thought || '').trim();
          if (thought) log(`思考：${thought}`);

          // 互动纠偏：模型主动要求用户确认方向/补充信息
          if (decision.need_user_input) {
            const question = String(decision.user_question || '').trim();
            confirmPrompt =
              question || '执行到关键阶段，模型需要你确认方向或补充信息后才能继续';
            paused = true;
            log(`第 ${round + 1} 轮：模型暂停，想先和你确认一下`);
            break;
          }

          const action = String(decision.action || '').trim();
          const args = decision.args || {};
          let madeProgress = false;

          if (action && ['search', 'write_note', 'remember'].includes(action)) {
            log(`执行工具：${action}`);
            const toolResult = await runTool(ctx.userId, action, args);
            log(
              toolResult.ok
                ? `工具 ${action} 成功：${toolResult.output.slice(0, 200)}`
                : `工具 ${action} 失败：${toolResult.output}`,
            );
            if (toolResult.ok) madeProgress = true;
            stepSummary += `\n[动作 ${action}] ${JSON.stringify(args)}\n结果：${toolResult.output}\n`;
          } else if (action) {
            log(`未知动作「${action}」，忽略`);
          }

          if (madeProgress) noProgressCount = 0;
          else noProgressCount++;

          if (decision.done || action === '') {
            done = true;
            finalAnswer = String(decision.final_answer || '').trim() || raw;
            log('任务完成，已生成最终结果');
            break;
          }

          // 无进展检测：连续 2 轮既没调工具也没完成，判定可能跑偏，主动暂停让用户纠偏
          if (noProgressCount >= 2) {
            confirmPrompt =
              '模型连续几轮没有实质进展，可能方向偏了。你可以补充说明或纠正方向后继续，也可以终止任务。';
            paused = true;
            log('连续多轮没有实质进展，暂停等待你确认方向');
            break;
          }
        }

        // 撞上限（本轮分段跑完仍未收敛、未被暂停）→ 暂停待确认，可断点续跑
        if (!done && !paused) {
          confirmPrompt = `已连续推进 ${startRound + executedRounds} 轮，仍在进行中但暂未收敛。你可以补充方向后继续，或终止任务。`;
          paused = true;
          log(`达到本次执行轮数上限（${maxRounds} 轮），暂停等待你确认`);
        }

        // 完成：写入笔记
        if (done) {
          const noteTitle = `【自主执行】${project.name}`;
          const content = `# 自主执行结果：${project.name}\n\n## 目标\n${goal}\n\n## 执行过程\n${runLog.join('\n')}\n\n## 最终结果\n${finalAnswer}`;
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
            model_used: modelUsed,
            paused: false,
          };
        }

        // 暂停：不落最终笔记，只存断点快照供续跑
        const totalRound = startRound + executedRounds;
        return {
          success: true,
          summary: (confirmPrompt || finalAnswer || '任务已暂停').replace(/\n/g, ' ').slice(0, 200),
          items_found: runLog.length,
          process_log: runLog,
          model_used: modelUsed,
          paused: true,
          confirm_prompt: confirmPrompt,
          goal_state: {
            round: totalRound,
            step_summary: stepSummary,
            run_log: runLog,
            final_answer: finalAnswer,
            model_used: modelUsed,
          },
        };
      } catch (err: any) {
        return {
          success: false,
          error_code: err.error_code || 'TASK_FAILED',
          error_message: err.message || String(err),
          process_log: runLog,
          model_used: modelUsed,
        };
      }
    },
  };
}