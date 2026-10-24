import { tavilySearch, TavilyResult } from '../routes/search';
import { chatCompletion } from '../services/ai';
import { localChatCompletion, resolveLocalModel, LocalModelError } from '../services/local-llm';
import { getAgentPrivacy } from '../services/agent-privacy';
import {
  insertOne,
  selectAll,
  selectWhere,
  findOne,
  MemoryCategory,
  AgentPrivacySettingRecord,
  AgentTraceStats,
  KnowledgeBaseRecord,
} from '../storage/json-storage';
import { requestToolExecution } from '../services/tools';
import { captureWeb } from '../utils/capture';
import { splitTextIntoChunks } from '../utils/text';
import { createEmbedding } from '../services/ai';
import { TaskExecutor, TaskContext, TaskResult } from './registry';
import { friendlyTaskError } from '../utils/errors';

// 自主执行（目标 Agent）执行器 —— 实现 ReAct 循环
// 权限依赖: SEARCH + LLM + WRITE (+ 内部会用到 remember 写入记忆)

interface ToolResult {
  ok: boolean;
  output: string;
  // 需要用户确认（权限分级为 confirm）：执行器应暂停并把提示展示给用户
  needConfirm?: boolean;
  confirmPrompt?: string;
}

interface ToolRunOptions {
  runId?: string;
  projectId?: string;
  approvedSignatures?: string[];
  privacy?: AgentPrivacySettingRecord;
}

// 可用工具实现
async function runTool(
  userId: string,
  action: string,
  args: any,
  opts: ToolRunOptions = {},
): Promise<ToolResult> {
  const privacy = opts.privacy;
  switch (action) {
    case 'search': {
      if (privacy && !privacy.allow_web_search) {
        return { ok: false, output: '你已在设置中关闭「联网搜索」，本次任务不能上网搜索。可改用知识库检索，或到「设置-自主执行与隐私」打开联网开关。' };
      }
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

    case 'capture_web': {
      if (privacy && !privacy.allow_web_capture) {
        return { ok: false, output: '你已在设置中关闭「抓取网页」，本次任务不能打开网页取正文。可到「设置-自主执行与隐私」打开该开关。' };
      }
      const url = String(args?.url || '').trim();
      if (!url) return { ok: false, output: '抓取网页缺少 url 参数' };
      try {
        const cap = await captureWeb(url, 12000);
        if (!cap.content || cap.content.trim().length < 20) {
          return { ok: true, output: `已打开「${cap.title || url}」，但没能提取到有效正文（可能需要登录或页面以图片为主）。` };
        }
        return {
          ok: true,
          output: `标题：${cap.title}\n链接：${cap.url}\n正文（已截取前 12000 字）：\n${cap.content}`,
        };
      } catch (e: any) {
        return { ok: false, output: `抓取网页失败：${e?.message || '无法打开该链接'}` };
      }
    }

    case 'search_knowledge': {
      // 本地知识库检索：优先向量语义检索；未配置 embedding 时降级为关键词匹配（本地优先、不阻断）
      const query = String(args?.query || args?.keyword || '').trim();
      if (!query) return { ok: false, output: '知识库检索缺少 query 参数' };
      const chunks = selectAll('document_chunks');
      const mine = chunks.filter((c) => c.user_id === userId && Array.isArray(c.embedding) && c.embedding!.length > 0);
      if (mine.length > 0) {
        try {
          const { cosineSimilarity } = await import('../services/ai');
          const qEmb = await createEmbedding(query);
          const ranked = mine
            .map((c) => ({ c, s: cosineSimilarity(qEmb, c.embedding!) }))
            .filter((x) => x.s >= 0.4)
            .sort((a, b) => b.s - a.s)
            .slice(0, 5);
          if (ranked.length === 0) return { ok: true, output: '知识库里没有和这个问题相关的内容。' };
          return {
            ok: true,
            output: ranked.map((x, i) => `[${i + 1}]（相关度 ${(x.s * 100).toFixed(0)}%）${x.c.content}`).join('\n\n'),
          };
        } catch {
          // embedding 失败则落到关键词匹配
        }
      }
      // 关键词兜底：不依赖任何云端能力，纯本地
      const allMine = chunks.filter((c) => c.user_id === userId);
      if (allMine.length === 0) {
        return { ok: true, output: '知识库里还没有文档。你可以先上传文档，或让任务把结果直接存成笔记。' };
      }
      // 中文整句按标点分词后常常是一整个长词，很难命中，故对含中文的词再做 2-gram 切分
      const rawTerms = query.toLowerCase().split(/[\s,，。、？?！!：:；;（）()【】"']+/).filter(Boolean);
      const terms: string[] = [];
      for (const t of rawTerms) {
        if (t.length >= 2) terms.push(t);
        if (/[一-龥]/.test(t) && t.length >= 3) {
          for (let i = 0; i + 2 <= t.length; i++) terms.push(t.slice(i, i + 2));
        }
      }
      const uniqueTerms = Array.from(new Set(terms));
      const scored = allMine
        .map((c) => {
          const text = (c.content || '').toLowerCase();
          const hits = uniqueTerms.reduce((n, t) => n + (text.includes(t) ? 1 : 0), 0);
          return { c, hits };
        })
        .filter((x) => x.hits > 0)
        .sort((a, b) => b.hits - a.hits)
        .slice(0, 5);
      if (scored.length === 0) return { ok: true, output: '知识库里没有和这个问题相关的内容。' };
      return {
        ok: true,
        output: scored.map((x, i) => `[${i + 1}] ${x.c.content}`).join('\n\n'),
      };
    }

    case 'write_knowledge': {
      // 把成果沉淀到本地知识库：自动获取/创建「自主执行成果」库，存为一篇文档（尽力向量化）
      const title = String(args?.title || '自主执行成果').slice(0, 120);
      const content = String(args?.content || '').trim();
      if (!content) return { ok: false, output: '知识库文档内容为空' };
      let kb = findOne('knowledge_bases', { user_id: userId, name: '自主执行成果' } as Partial<KnowledgeBaseRecord>);
      const now = new Date().toISOString();
      if (!kb) {
        kb = insertOne('knowledge_bases', {
          id: crypto.randomUUID(),
          user_id: userId,
          name: '自主执行成果',
          description: '由自主执行任务自动整理沉淀的资料',
          created_at: now,
          updated_at: now,
        });
      }
      const docId = crypto.randomUUID();
      const pieces = splitTextIntoChunks(content, 800, 100);
      let embeddings: (number[] | null)[] = pieces.map(() => null);
      try {
        const { createEmbeddingsBatch } = await import('../services/ai');
        embeddings = (await createEmbeddingsBatch(pieces, 2, 30_000)).embeddings;
      } catch {
        // 未配置云端 embedding：文档仍以纯文本存入，关键词检索可用，不阻断本地流程
      }
      insertOne('documents', {
        id: docId,
        knowledge_base_id: kb.id,
        user_id: userId,
        filename: `${title}.md`,
        file_path: '',
        file_size: Buffer.byteLength(content, 'utf8'),
        content_preview: content.slice(0, 500),
        chunk_count: pieces.length,
        status: 'processed',
        source: 'note',
        file_type: '.md',
        created_at: now,
        updated_at: now,
      });
      pieces.forEach((text, index) => {
        insertOne('document_chunks', {
          id: crypto.randomUUID(),
          document_id: docId,
          knowledge_base_id: kb.id,
          user_id: userId,
          chunk_index: index,
          content: text,
          embedding: embeddings[index] || null,
          created_at: now,
        });
      });
      return { ok: true, output: `已存入本地知识库「自主执行成果」，标题「${title}」，共 ${pieces.length} 个片段。` };
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

    case 'open_app':
    case 'run_command': {
      const isOpen = action === 'open_app';
      if (privacy && !privacy.allow_external_tools) {
        return {
          ok: false,
          output: isOpen
            ? '你已在设置中关闭「调用外部软件」，本次任务不能打开本机应用。可到「设置-自主执行与隐私」打开该开关。'
            : '你已在设置中关闭「调用外部软件」，本次任务不能执行本机命令。可到「设置-自主执行与隐私」打开该开关。',
        };
      }
      const target = String(args?.target || args?.command || args?.path || '').trim();
      if (!target) {
        return { ok: false, output: isOpen ? '缺少 target 参数（要打开的应用/文件/链接）' : '缺少 command 参数（要执行的命令）' };
      }
      const outcome = await requestToolExecution(userId, action, target, {
        source: 'agent',
        runId: opts.runId,
        projectId: opts.projectId,
        approvedSignatures: opts.approvedSignatures,
      });
      if (outcome.outcome === 'executed') {
        return { ok: outcome.ok, output: outcome.output };
      }
      if (outcome.outcome === 'pending') {
        const a = outcome.approval;
        const actionLabel = isOpen ? `打开「${a.action_detail}」` : `执行命令「${a.action_detail}」`;
        const riskText =
          a.risk_level === 'high'
            ? `⚠️ 高风险操作（${a.risk_reason || '可能修改/删除系统内容'}），`
            : '';
        return {
          ok: false,
          output: '',
          needConfirm: true,
          confirmPrompt: `模型想要${actionLabel}。${riskText}该操作需要你确认后才能继续：屏幕上会弹出确认窗口，点「允许」后任务将自动接着执行；点「拒绝」则任务保持暂停。`,
        };
      }
      return { ok: false, output: `该操作已被你的权限设置禁用（${outcome.message}）。如需使用，请到「设置-外部调用」调整权限。` };
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
      const maxRounds = project.max_rounds && project.max_rounds > 0 ? project.max_rounds : 10;

      // 隐私与模型偏好（本地优先、隐私可控）
      const privacy = getAgentPrivacy(ctx.userId);
      // 模型选择优先级：项目指定的云端模型 > 用户的"强制本地"偏好 > 设置页默认云端模型
      const forceLocal = privacy.model_preference === 'local';
      let modelUsed = project.model || '默认模型';
      let modelSource: 'cloud' | 'local' = 'cloud';
      let localModelName = '';
      if (forceLocal && !project.model) {
        try {
          localModelName = await resolveLocalModel(privacy.local_model || undefined);
          modelUsed = `本地模型 ${localModelName}`;
          modelSource = 'local';
        } catch (e: any) {
          // 本地不可用：中文降级提示，不阻断，回落到云端默认模型
          const reason = e instanceof LocalModelError ? e.message : '本地模型不可用';
          return {
            success: false,
            error_code: 'LOCAL_MODEL_UNAVAILABLE',
            error_message: `${reason}。你可以先启动 Ollama 并下载模型，或到「设置-自主执行与隐私」把执行模型改回默认。`,
            model_used: '本地模型（不可用）',
            process_log: [],
          };
        }
      }

      // 断点续跑：从上次暂停的快照恢复中间状态；无快照则全新开始
      const resume = ctx.resumeState;
      const runLog: string[] = resume ? [...resume.run_log] : [];
      let stepSummary = resume?.step_summary || '';
      let finalAnswer = resume?.final_answer || '';
      const startRound = resume?.round || 0;
      // 本次执行中用户已批准的工具调用签名（续跑时放行同签名调用）
      const approvedSignatures = [...(resume?.approved_actions || [])];
      // 轨迹统计（续跑时沿用之前的计数）
      const trace: AgentTraceStats = {
        search_count: resume?.trace?.search_count || 0,
        capture_count: resume?.trace?.capture_count || 0,
        knowledge_search_count: resume?.trace?.knowledge_search_count || 0,
        note_count: resume?.trace?.note_count || 0,
        knowledge_write_count: resume?.trace?.knowledge_write_count || 0,
        memory_count: resume?.trace?.memory_count || 0,
        open_app_count: resume?.trace?.open_app_count || 0,
        command_count: resume?.trace?.command_count || 0,
        model_source: modelSource,
        local_model: localModelName || undefined,
      };

      // 依据隐私开关构建本次允许的工具清单（关掉联网时模型不得调用搜索/抓取）
      const toolCatalog: Array<{ name: string; desc: string; enabled: boolean }> = [
        { name: 'search', desc: '联网搜索（需要联网），参数 query', enabled: privacy.allow_web_search },
        { name: 'capture_web', desc: '抓取某个网页链接的正文（需要联网），参数 url', enabled: privacy.allow_web_capture },
        { name: 'search_knowledge', desc: '检索你本地知识库里已有的资料，参数 query', enabled: true },
        { name: 'write_note', desc: '把整理好的结果保存为一篇本地笔记，参数 title/content', enabled: true },
        { name: 'write_knowledge', desc: '把成果沉淀到本地知识库「自主执行成果」，参数 title/content', enabled: true },
        { name: 'remember', desc: '记住一条关于用户的偏好或事实，参数 content/category', enabled: true },
        { name: 'open_app', desc: '打开本机应用/文件/网址，参数 target', enabled: privacy.allow_external_tools },
        { name: 'run_command', desc: '在本机执行一条只读命令获取信息，参数 command', enabled: privacy.allow_external_tools },
      ];
      const enabledTools = toolCatalog.filter((t) => t.enabled).map((t) => t.name);
      const toolListText = toolCatalog
        .map((t) => `- ${t.name}（${t.enabled ? '可用' : '已被你关闭'}）：${t.desc}`)
        .join('\n');

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

可用工具（标注"已被你关闭"的一律不要调用）：
${toolListText}

感知建议：需要最新的外部信息时先用 search；search 给出链接、想看某链接全文时用 capture_web；用户本地资料相关问题先用 search_knowledge。
完成后请用 write_note（保存为笔记）或 write_knowledge（存入知识库）把成果沉淀下来，再设置 done=true。

请严格按以下 JSON 格式输出（不要输出 JSON 以外的任何内容）：
{
  "thought": "你对当前情况的简要思考",
  "action": "${enabledTools.join(' | ')} | 不需要工具则为空字符串",
  "args": { "相应参数": "..." },
  "done": false,
  "final_answer": "完成时填写最终答案，未完成则留空",
  "need_user_input": false,
  "user_question": ""
}

要求：
- 只允许调用上面标注"可用"的工具，被关闭的工具调用会直接失败。
- 需要外部最新信息时用 search 联网搜索；想读取某个具体网页的全文时用 capture_web；涉及用户已有资料时用 search_knowledge。
- 拿到足够信息后，用 write_note 或 write_knowledge 把结果整理沉淀，然后设置 done=true，并用 final_answer 给出完整、用户可读的中文结论（说明你做了什么、结果存到了哪里）。
- 若仅凭已有信息就能完成，可直接 write_note/write_knowledge 后 done=true，无需强行联网。
- 如果你在关键阶段拿不准方向、或需要用户补充信息/确认方向再继续，设置 need_user_input=true，并在 user_question 里用中文大白话写清楚你想问用户什么（此时 done=false、action 留空）。
- 使用 open_app / run_command 前先想清楚必要性；可能需要用户确认，若工具返回"需要确认"，任务会暂停等待用户批准，你无需重复请求同一操作。
- final_answer 使用中文，结构清晰。`;

          let raw = '';
          if (modelSource === 'local') {
            const local = await localChatCompletion(
              [
                { role: 'system', content: '你是一个强推理、善规划的自主 Agent，只输出合法 JSON。' },
                { role: 'user', content: prompt },
              ],
              { model: localModelName, temperature: 0.5 },
            );
            raw = (local.content || '').trim();
          } else {
            const llmResult = await chatCompletion(
              [
                { role: 'system', content: '你是一个强推理、善规划的自主 Agent，只输出合法 JSON。' },
                { role: 'user', content: prompt },
              ],
              { temperature: 0.5, ...(project.model ? { model: project.model } : {}) },
            );
            raw = (llmResult.content || '').trim();
          }
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

          const allTools = [
            'search', 'capture_web', 'search_knowledge',
            'write_note', 'write_knowledge', 'remember',
            'open_app', 'run_command',
          ];
          if (action && allTools.includes(action)) {
            if (!enabledTools.includes(action)) {
              log(`工具 ${action} 已被你的隐私设置关闭，无法执行`);
              stepSummary += `\n[动作 ${action}] 结果：该能力已被用户在隐私设置中关闭，不能使用，请改用其它可用工具或直接基于已有信息作答。\n`;
            } else {
              const actionLabelMap: Record<string, string> = {
                search: '联网搜索', capture_web: '抓取网页', search_knowledge: '知识库检索',
                write_note: '写入笔记', write_knowledge: '写入知识库', remember: '记住信息',
                open_app: '打开应用', run_command: '执行命令',
              };
              log(`执行工具：${actionLabelMap[action] || action}`);
              const toolResult = await runTool(ctx.userId, action, args, {
                runId: ctx.runId,
                projectId: project.id,
                approvedSignatures,
                privacy,
              });
              // 需要用户确认的工具调用：暂停任务，等待用户在确认弹窗中批准/拒绝
              if (toolResult.needConfirm) {
                confirmPrompt = toolResult.confirmPrompt || '该操作需要你确认后才能继续';
                paused = true;
                log(`工具 ${action} 需要你确认，任务已暂停等待审批`);
                break;
              }
              log(
                toolResult.ok
                  ? `工具 ${actionLabelMap[action] || action} 成功：${toolResult.output.slice(0, 200)}`
                  : `工具 ${actionLabelMap[action] || action} 失败：${toolResult.output}`,
              );
              if (toolResult.ok) {
                madeProgress = true;
                // 轨迹计数（只统计真正成功的动作）
                if (action === 'search') trace.search_count = (trace.search_count || 0) + 1;
                else if (action === 'capture_web') trace.capture_count = (trace.capture_count || 0) + 1;
                else if (action === 'search_knowledge') trace.knowledge_search_count = (trace.knowledge_search_count || 0) + 1;
                else if (action === 'write_note') trace.note_count = (trace.note_count || 0) + 1;
                else if (action === 'write_knowledge') trace.knowledge_write_count = (trace.knowledge_write_count || 0) + 1;
                else if (action === 'remember') trace.memory_count = (trace.memory_count || 0) + 1;
                else if (action === 'open_app') trace.open_app_count = (trace.open_app_count || 0) + 1;
                else if (action === 'run_command') trace.command_count = (trace.command_count || 0) + 1;
              }
              stepSummary += `\n[动作 ${action}] ${JSON.stringify(args)}\n结果：${toolResult.output}\n`;
            }
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
          // 系统汇总笔记也算一次笔记沉淀（+1），模型过程中主动写的另计
          trace.note_count = (trace.note_count || 0) + 1;
          return {
            success: true,
            summary: brief,
            briefing_note_id: note.id,
            items_found: runLog.length,
            process_log: runLog,
            model_used: modelUsed,
            paused: false,
            trace,
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
          trace,
          goal_state: {
            round: totalRound,
            step_summary: stepSummary,
            run_log: runLog,
            final_answer: finalAnswer,
            model_used: modelUsed,
            approved_actions: approvedSignatures,
            trace,
          },
        };
      } catch (err: any) {
        return {
          success: false,
          error_code: err.error_code || 'TASK_FAILED',
          error_message: friendlyTaskError(err),
          process_log: runLog,
          model_used: modelUsed,
          trace,
        };
      }
    },
  };
}