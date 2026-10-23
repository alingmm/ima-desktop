import { useState, useEffect, useRef } from 'react';
import { Send, ChevronDown, Copy, ThumbsUp, ThumbsDown, RefreshCw, Database, Plus, X, Check, Cpu, Globe, Paperclip, Loader2, FileText, Brain } from 'lucide-react';
import { chatApi, knowledgeApi, localModelApi, searchApi, filesApi, memoryApi } from '../api';
import type { Message, Model, KnowledgeBase, OllamaModel, PendingAttachment, ChatContentPart } from '../types';
import ReactMarkdown from 'react-markdown';
import { useLocalSettings } from '../hooks/useLocalSettings';
import { useToast, showApiError } from '../components/Toast';

/** 把可能为多模态分片的消息内容收敛为纯文本（用于保存知识库等场景） */
function contentToPlain(content: string | ChatContentPart[]): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (p.type === 'text' ? p.text : '[图片]'))
      .join('\n');
  }
  return '';
}

function ChatPage() {
  const toast = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [models, setModels] = useState<Model[]>([]);
  const [currentModel, setCurrentModel] = useState<string>('doubao-seed-2-0-pro-260215');
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [showKnowledgeModal, setShowKnowledgeModal] = useState(false);
  const [selectedMessageIdx, setSelectedMessageIdx] = useState<number | null>(null);
  const [newKnowledgeBaseName, setNewKnowledgeBaseName] = useState('');
  const [showNewBaseInput, setShowNewBaseInput] = useState(false);
  const [selectedBaseId, setSelectedBaseId] = useState<string | null>(null);
  const [savingToKnowledge, setSavingToKnowledge] = useState(false);
  const [localModels, setLocalModels] = useState<OllamaModel[]>([]);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const { settings } = useLocalSettings();

  // 对话附件（图片 / 文档）
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [attaching, setAttaching] = useState(false);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const [rememberingIdx, setRememberingIdx] = useState<number | null>(null);

  const readFileAsDataURL = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('图片读取失败'));
      reader.readAsDataURL(file);
    });

  const handlePickAttachments = () => attachInputRef.current?.click();

  const handleAttachFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    setAttaching(true);
    try {
      for (const file of Array.from(fileList)) {
        const lowerName = file.name.toLowerCase();
        const isImage = file.type.startsWith('image/');
        const isDoc = ['.pdf', '.doc', '.docx', '.txt', '.md', '.markdown'].some((ext) =>
          lowerName.endsWith(ext)
        );
        if (!isImage && !isDoc) {
          toast.warning('暂不支持该文件类型，支持图片和 Word/PDF/TXT/Markdown 文档');
          continue;
        }
        if (file.size > 20 * 1024 * 1024) {
          toast.warning(`「${file.name}」超过 20MB，请压缩或拆分后再上传`);
          continue;
        }
        if (isImage) {
          try {
            const dataUrl = await readFileAsDataURL(file);
            setAttachments((prev) => [
              ...prev,
              { id: crypto.randomUUID(), kind: 'image', name: file.name, dataUrl, status: 'ready' },
            ]);
          } catch {
            toast.error(`图片「${file.name}」读取失败`);
          }
        } else {
          const id = crypto.randomUUID();
          setAttachments((prev) => [
            ...prev,
            { id, kind: 'document', name: file.name, status: 'loading' },
          ]);
          try {
            const extracted = await filesApi.extract(file);
            if (!extracted.content || extracted.content.trim().length === 0) {
              setAttachments((prev) => prev.filter((a) => a.id !== id));
              toast.warning(`未能从「${file.name}」中读取到文字内容`);
            } else {
              setAttachments((prev) =>
                prev.map((a) =>
                  a.id === id ? { ...a, status: 'ready', text: extracted.content } : a
                )
              );
            }
          } catch (err: any) {
            setAttachments((prev) => prev.filter((a) => a.id !== id));
            toast.error(`文档「${file.name}」读取失败：${err.message || '请稍后重试'}`);
          }
        }
      }
    } finally {
      setAttaching(false);
      if (attachInputRef.current) attachInputRef.current.value = '';
    }
  };

  const removeAttachment = (id: string) =>
    setAttachments((prev) => prev.filter((a) => a.id !== id));

  // Load models on mount
  useEffect(() => {
    const loadModels = async () => {
      try {
        const res = await chatApi.getModels();
        setModels(res.models);
      } catch (error) {
        console.error('Failed to load cloud models:', error);
      }

      // Load local Ollama models
      try {
        if (settings.ollamaUrl) {
          const health = await localModelApi.checkHealth(settings.ollamaUrl);
          if (health.available) {
            const localRes = await localModelApi.getModels(settings.ollamaUrl);
            setLocalModels(localRes);
            // If default use local model and there are models available
            if (settings.useLocalModel && localRes.length > 0) {
              setCurrentModel(localRes[0].name);
            }
          }
        }
      } catch (error) {
        console.error('Failed to load local models:', error);
      }
    };
    loadModels();
  }, [settings.ollamaUrl, settings.useLocalModel]);

  // Listen for conversation selection from sidebar
  useEffect(() => {
    const handleSelect = async (e: Event) => {
      const customEvent = e as CustomEvent;
      const { id } = customEvent.detail;
      if (!id) return;
      setCurrentConversationId(id);
      setMessages([]);
      try {
        const res = await chatApi.getMessages(id);
        setMessages(res.messages);
      } catch (error) {
        console.error('Failed to load messages:', error);
      }
    };

    const handleNew = (e: Event) => {
      const customEvent = e as CustomEvent;
      setCurrentConversationId(customEvent.detail.id);
      setMessages([]);
    };

    window.addEventListener('selectConversation', handleSelect);
    window.addEventListener('newConversation', handleNew);

    return () => {
      window.removeEventListener('selectConversation', handleSelect);
      window.removeEventListener('newConversation', handleNew);
    };
  }, []);

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  // Load knowledge bases
  const loadKnowledgeBases = async () => {
    try {
      const res = await knowledgeApi.getBases();
      setKnowledgeBases(res.bases);
    } catch (error) {
      console.error('Failed to load knowledge bases:', error);
    }
  };

  const openKnowledgeModal = (msgIdx: number) => {
    setSelectedMessageIdx(msgIdx);
    setSelectedBaseId(null);
    setNewKnowledgeBaseName('');
    setShowNewBaseInput(false);
    setShowKnowledgeModal(true);
    loadKnowledgeBases();
  };

  // 「记住这条」：把当前这一轮问答提炼为个性化记忆
  const handleRememberThis = async (msgIdx: number) => {
    const msg = messages[msgIdx];
    if (!msg || msg.role !== 'assistant') return;
    const prevMsg = msgIdx > 0 ? messages[msgIdx - 1] : null;
    const userText = prevMsg?.role === 'user' ? contentToPlain(prevMsg.content) : '';
    const assistantText = contentToPlain(msg.content);
    if (!userText.trim() || !assistantText.trim()) {
      toast.warning('这一轮对话内容为空，没什么可记住的');
      return;
    }

    try {
      setRememberingIdx(msgIdx);
      const res = await memoryApi.extractFromChat({
        user_text: userText,
        assistant_text: assistantText,
      });
      if (res.saved && res.memory) {
        toast.success(`已记住：${res.memory.content}`);
      } else if (res.reason === 'duplicate') {
        toast.info('这条信息我之前已经记住啦');
      } else if (res.reason === 'none') {
        toast.info('这轮对话里没有值得长期记住的信息');
      } else {
        toast.warning('提炼记忆失败，请稍后再试');
      }
    } catch (err: any) {
      console.error('Remember this failed:', err);
      showApiError(err, toast);
    } finally {
      setRememberingIdx(null);
    }
  };

  const handleSaveToKnowledge = async () => {
    if (selectedMessageIdx === null) return;
    const msg = messages[selectedMessageIdx];
    const prevMsg = selectedMessageIdx > 0 ? messages[selectedMessageIdx - 1] : null;
    const question = prevMsg?.role === 'user' ? contentToPlain(prevMsg.content) : '';
    const answer = msg.role === 'assistant' ? contentToPlain(msg.content) : '';

    if (!selectedBaseId && !newKnowledgeBaseName.trim()) {
      toast.warning('请选择知识库或输入新知识库名称');
      return;
    }

    try {
      setSavingToKnowledge(true);
      const res = await chatApi.saveToKnowledge({
        knowledge_base_id: selectedBaseId || undefined,
        knowledge_base_name: showNewBaseInput ? newKnowledgeBaseName.trim() : undefined,
        question,
        answer,
      });
      setShowKnowledgeModal(false);
      setSavingToKnowledge(false);
      if (res.embedding_ready === false) {
        toast.warning(`已保存到知识库（${res.embed_error_message || '未向量化'}）`);
      } else {
        toast.success('已成功保存到知识库');
      }
    } catch (err: any) {
      console.error('Failed to save to knowledge:', err);
      setSavingToKnowledge(false);
      showApiError(err, toast);
    }
  };

  const isLocalModel = (modelId: string) => {
    return localModels.some((m) => m.name === modelId);
  };

  const handleSend = async () => {
    const readyAttachments = attachments.filter((a) => a.status === 'ready');
    if ((!input.trim() && readyAttachments.length === 0) || isStreaming) return;
    const pendingLoading = attachments.some((a) => a.status === 'loading');
    if (pendingLoading) {
      toast.warning('文档还在读取中，请稍候再发送');
      return;
    }

    const text = input.trim();
    const imageAtts = readyAttachments.filter((a) => a.kind === 'image' && a.dataUrl);
    const docAtts = readyAttachments.filter((a) => a.kind === 'document' && a.text);

    // 展示用文本（不含 base64）
    let displayContent = text;
    if (docAtts.length > 0) {
      displayContent = `${docAtts.map((d) => `【文档：${d.name}】\n${d.text}`).join('\n\n')}\n\n${text}`;
    }
    if (imageAtts.length > 0) {
      displayContent = `[图片：${imageAtts.map((i) => i.name).join('、')}]\n${text}`;
    }

    // 发给大模型的内容：有图片用多模态分片，否则纯字符串
    let llmContent: string | ChatContentPart[];
    if (imageAtts.length > 0) {
      const parts: ChatContentPart[] = [];
      if (docAtts.length > 0) {
        parts.push({
          type: 'text',
          text: docAtts.map((d) => `【文档：${d.name}】\n${d.text}`).join('\n\n'),
        });
      }
      parts.push({ type: 'text', text: text || '请识别并分析以上图片内容。' });
      for (const img of imageAtts) {
        parts.push({ type: 'image_url', image_url: { url: img.dataUrl as string, detail: 'auto' } });
      }
      llmContent = parts;
    } else {
      llmContent = displayContent;
    }

    const userMessage: Message = {
      role: 'user',
      content: llmContent,
      images: imageAtts.map((i) => i.dataUrl as string),
    };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput('');
    setAttachments([]);
    setIsStreaming(true);

    // Add placeholder assistant message
    const assistantMessage: Message = { role: 'assistant', content: '' };
    setMessages([...updatedMessages, assistantMessage]);

    const localMode = isLocalModel(currentModel);

    try {
      // For cloud models, create conversation first (local mode may not use DB)
      let convId = currentConversationId;
      if (!convId && !localMode) {
        const convRes = await chatApi.createConversation(
          (text || (docAtts[0]?.name ?? imageAtts[0]?.name ?? '新对话')).slice(0, 30),
          currentModel
        );
        convId = convRes.conversation.id;
        setCurrentConversationId(convId);
        // Notify sidebar
        const event = new CustomEvent('conversationCreated');
        window.dispatchEvent(event);
      }

      if (localMode) {
        // 本地模型走 Ollama，暂不支持图片识别；图片附件给出明确提示
        if (imageAtts.length > 0) {
          setMessages((prev) => {
            const newMessages = [...prev];
            newMessages[newMessages.length - 1] = {
              role: 'assistant',
              content: '本地模型暂不支持图片识别，请切换到支持视觉的云端模型后再发送图片。',
            };
            return newMessages;
          });
          setIsStreaming(false);
          return;
        }
        // Local model streaming via event source（本地模型仅支持纯文本）
        localModelApi.streamChat({
          model: currentModel,
          messages: updatedMessages.map((m) => ({ role: m.role, content: contentToPlain(m.content) })),
          ollamaUrl: settings.ollamaUrl,
          onMessage: (text: string) => {
            setMessages((prev) => {
              const newMessages = [...prev];
              const lastIdx = newMessages.length - 1;
              newMessages[lastIdx] = {
                role: 'assistant',
                content: (newMessages[lastIdx]?.content || '') + text,
              };
              return newMessages;
            });
          },
          onDone: () => {
            setIsStreaming(false);
          },
          onError: (error: string) => {
            console.error('Local model error:', error);
            setMessages((prev) => {
              const newMessages = [...prev];
              newMessages[newMessages.length - 1] = {
                role: 'assistant',
                content: `本地模型调用失败：${error}`,
              };
              return newMessages;
            });
            setIsStreaming(false);
          },
        });
      } else {
        // Cloud model streaming
        const controller = new AbortController();
        let llmMessages = updatedMessages;
        let sources: { title: string; url: string; snippet?: string }[] = [];

        if (webSearchEnabled) {
          try {
            const searchRes = await searchApi.webSearch(text, { count: 5 });
            sources = (searchRes.results || []).map((r: any) => ({
              title: r.title || '',
              url: r.url || '',
              snippet: r.content || r.snippet || '',
            }));
            if (sources.length > 0) {
              const contextLines = sources
                .map(
                  (s, i) =>
                    `[${i + 1}] ${s.title}\n来源链接：${s.url}\n内容摘要：${s.snippet || '（无摘要）'}`
                )
                .join('\n\n');
              llmMessages = [
                ...updatedMessages,
                {
                  role: 'assistant' as const,
                  content: `[搜索结果（来自联网搜索，供你整合参考）]\n${contextLines}\n\n请基于以上搜索到的信息，结合用户问题给出完整、有条理的回答，并在回答末尾标注信息来源于哪些链接。`,
                },
              ];
            }
          } catch (searchErr: any) {
            // Expected: no key or failure → source list empty; LLM answers normally
            const code = searchErr?.error || searchErr?.code;
            if (code === 'SEARCH_API_NOT_CONFIGURED') {
              showApiError({ error: 'SEARCH_API_NOT_CONFIGURED', message: '请先配置联网搜索 Key' }, toast);
            }
          }
        }

        const response = await fetch('/api/chat/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: llmMessages,
            model: currentModel,
            conversation_id: convId,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error('Stream failed');
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let fullText = '';

        if (reader) {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6));
                  if (data.error) {
                    // 后端流式错误（如模型不支持图片识别 MODEL_NOT_VISION）
                    const friendly =
                      data.error === 'MODEL_NOT_VISION'
                        ? '当前模型不支持图片识别，请在「设置」中切换到支持视觉的多模态模型后重试。'
                        : data.message || '模型返回错误';
                    fullText = `❌ ${friendly}`;
                    setMessages((prev) => {
                      const newMessages = [...prev];
                      newMessages[newMessages.length - 1] = {
                        role: 'assistant',
                        content: fullText,
                      };
                      return newMessages;
                    });
                  } else if (data.done) {
                    // Stream finished
                  } else if (data.content) {
                    fullText += data.content;
                    setMessages((prev) => {
                      const newMessages = [...prev];
                      newMessages[newMessages.length - 1] = {
                        role: 'assistant',
                        content: fullText,
                      };
                      return newMessages;
                    });
                  }
                } catch (e) {
                  // ignore parse errors
                }
              }
            }
          }
        }

        // 若开启了联网搜索且有来源，把来源链接追加到回答末尾
        if (webSearchEnabled && sources.length > 0) {
          const sourcesText =
            '\n\n---\n\n**信息来源：**\n' +
            sources.map((s, i) => `${i + 1}. [${s.title}](${s.url})`).join('\n');
          setMessages((prev) => {
            const newMessages = [...prev];
            const lastIdx = newMessages.length - 1;
            if (newMessages[lastIdx]) {
              newMessages[lastIdx] = {
                role: 'assistant',
                content: (newMessages[lastIdx].content || '') + sourcesText,
              };
            }
            return newMessages;
          });
        }
      }
    } catch (error: any) {
      console.error('Chat error:', error);
      const errMsg = error?.message || '请求失败，请稍后重试';
      showApiError(error, toast);
      setMessages((prev) => {
        const newMessages = [...prev];
        newMessages[newMessages.length - 1] = {
          role: 'assistant',
          content: `❌ ${errMsg}`,
        };
        return newMessages;
      });
    } finally {
      if (!localMode) setIsStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const getModelDisplayName = (modelId: string) => {
    const cloudModel = models.find((m) => m.id === modelId);
    if (cloudModel) return cloudModel.name;
    const localModel = localModels.find((m) => m.name === modelId);
    if (localModel) return localModel.name;
    return modelId;
  };

  const isCurrentModelLocal = isLocalModel(currentModel);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="h-14 border-b border-[var(--color-border)] flex items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-medium text-white">
            {currentConversationId ? '对话中' : '新对话'}
          </h2>
        </div>

        {/* Model selector */}
        <div className="relative">
          <button
            onClick={() => setShowModelDropdown(!showModelDropdown)}
            className="flex items-center gap-2 px-3 py-1.5 bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-lg hover:border-[var(--color-primary)] transition-colors text-sm text-[var(--color-text-primary)]"
          >
            <span className={`w-2 h-2 rounded-full ${isCurrentModelLocal ? 'bg-emerald-500' : 'bg-blue-500'}`}></span>
            {getModelDisplayName(currentModel)}
            <ChevronDown size={16} className="text-[var(--color-text-muted)]" />
          </button>

          {showModelDropdown && (
            <div className="absolute right-0 top-full mt-2 w-56 bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-lg shadow-xl z-50 overflow-hidden animate-fade-in max-h-80 overflow-y-auto">
              <div className="p-2 space-y-1">
                <p className="text-xs text-[var(--color-text-muted)] px-2 py-1 font-medium">云端模型</p>
                {models.map((model) => (
                  <button
                    key={model.id}
                    onClick={() => {
                      setCurrentModel(model.id);
                      setShowModelDropdown(false);
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-left transition-colors ${
                      currentModel === model.id
                        ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                        : 'text-[var(--color-text-primary)] hover:bg-[var(--color-sidebar-hover)]'
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        model.provider === 'doubao'
                          ? 'bg-blue-500'
                          : model.provider === 'minimax'
                          ? 'bg-purple-500'
                          : 'bg-cyan-500'
                      }`}
                    ></span>
                    {model.name}
                  </button>
                ))}
              </div>
              {localModels.length > 0 && (
                <div className="p-2 border-t border-[var(--color-border)] space-y-1">
                  <p className="text-xs text-emerald-400 px-2 py-1 font-medium flex items-center gap-1">
                    <Cpu className="w-3 h-3" /> 本地模型
                  </p>
                  {localModels.map((model) => (
                    <button
                      key={`local-${model.id}`}
                      onClick={() => {
                        setCurrentModel(model.name);
                        setShowModelDropdown(false);
                      }}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-left transition-colors ${
                        currentModel === model.name
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : 'text-[var(--color-text-primary)] hover:bg-[var(--color-sidebar-hover)]'
                      }`}
                    >
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                      <span className="truncate">{model.name}</span>
                      {model.details?.parameter_size && (
                        <span className="text-xs text-[var(--color-text-muted)] ml-auto">
                          {model.details.parameter_size}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center px-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center mb-6">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold text-white mb-2">AI 智能对话</h2>
            <p className="text-[var(--color-text-secondary)] text-center max-w-md mb-8">
              支持多种大模型切换，流式输出，助你高效完成各种任务
            </p>
            <div className="grid grid-cols-2 gap-3 max-w-lg w-full">
              {[
                { title: '写代码', desc: '帮我写一个React组件' },
                { title: '翻译', desc: '将这段话翻译成英文' },
                { title: '写作', desc: '写一篇关于AI的文章' },
                { title: '分析', desc: '分析这段数据的趋势' },
              ].map((item, i) => (
                <button
                  key={i}
                  onClick={() => setInput(item.desc)}
                  className="p-4 bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-xl hover:border-[var(--color-primary)] transition-all text-left"
                >
                  <h3 className="text-sm font-medium text-white mb-1">{item.title}</h3>
                  <p className="text-xs text-[var(--color-text-muted)]">{item.desc}</p>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto py-6 px-4 space-y-6">
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
              >
                <div
                  className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-white text-sm ${
                    msg.role === 'user'
                      ? 'bg-gradient-to-br from-cyan-400 to-blue-500'
                      : 'bg-gradient-to-br from-purple-500 to-pink-500'
                  }`}
                >
                  {msg.role === 'user' ? 'U' : 'AI'}
                </div>
                <div
                  className={`max-w-[80%] px-4 py-3 rounded-2xl ${
                    msg.role === 'user'
                      ? 'bg-[var(--color-primary)] text-white'
                      : 'bg-[var(--color-card-bg)] border border-[var(--color-border)] text-[var(--color-text-primary)]'
                  }`}
                >
                  {msg.role === 'assistant' ? (
                    <div className="markdown-body text-sm">
                      {contentToPlain(msg.content) ? (
                        <ReactMarkdown>{contentToPlain(msg.content)}</ReactMarkdown>
                      ) : (
                        <div className="flex gap-1">
                          <span className="typing-dot w-2 h-2 bg-[var(--color-text-muted)] rounded-full"></span>
                          <span className="typing-dot w-2 h-2 bg-[var(--color-text-muted)] rounded-full"></span>
                          <span className="typing-dot w-2 h-2 bg-[var(--color-text-muted)] rounded-full"></span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {msg.images && msg.images.length > 0 && (
                        <div className="flex flex-wrap gap-2 justify-end">
                          {msg.images.map((src, i) => (
                            <img
                              key={i}
                              src={src}
                              alt="用户发送的图片"
                              className="max-w-48 max-h-48 rounded-lg object-cover border border-white/20"
                            />
                          ))}
                        </div>
                      )}
                      {contentToPlain(msg.content) && (
                        <p className="text-sm whitespace-pre-wrap">{contentToPlain(msg.content)}</p>
                      )}
                    </div>
                  )}

                  {msg.role === 'assistant' && contentToPlain(msg.content) && (
                    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[var(--color-border)]">
                      <button className="p-1 hover:bg-[var(--color-sidebar-hover)] rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors">
                        <Copy size={14} />
                      </button>
                      <button className="p-1 hover:bg-[var(--color-sidebar-hover)] rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors">
                        <ThumbsUp size={14} />
                      </button>
                      <button className="p-1 hover:bg-[var(--color-sidebar-hover)] rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors">
                        <ThumbsDown size={14} />
                      </button>
                      <button className="p-1 hover:bg-[var(--color-sidebar-hover)] rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors">
                        <RefreshCw size={14} />
                      </button>
                      <div className="w-px h-4 bg-[var(--color-border)] mx-1" />
                      <button
                        onClick={() => openKnowledgeModal(idx)}
                        className="p-1 hover:bg-[var(--color-sidebar-hover)] rounded text-[var(--color-text-muted)] hover:text-blue-400 transition-colors group"
                        title="加入知识库"
                      >
                        <Database size={14} />
                        <span className="absolute -top-8 left-1/2 -translate-x-1/2 bg-[var(--color-card-bg)] border border-[var(--color-border)] px-2 py-1 rounded text-xs opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                          加入知识库
                        </span>
                      </button>
                      <button
                        onClick={() => handleRememberThis(idx)}
                        disabled={rememberingIdx === idx}
                        className="p-1 hover:bg-[var(--color-sidebar-hover)] rounded text-[var(--color-text-muted)] hover:text-amber-400 transition-colors group disabled:opacity-50"
                        title="记住这条"
                      >
                        {rememberingIdx === idx ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Brain size={14} />
                        )}
                        <span className="absolute -top-8 left-1/2 -translate-x-1/2 bg-[var(--color-card-bg)] border border-[var(--color-border)] px-2 py-1 rounded text-xs opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                          记住这条
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-[var(--color-border)] p-4">
        <div className="max-w-3xl mx-auto">
          <div className="bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-2xl focus-within:border-[var(--color-primary)] transition-colors">
            {/* 待发送附件预览 */}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 px-3 pt-3">
                {attachments.map((att) => (
                  <div
                    key={att.id}
                    className="group relative flex items-center gap-2 pl-2 pr-2 py-1.5 bg-[var(--color-sidebar-hover)] border border-[var(--color-border)] rounded-lg max-w-[220px]"
                  >
                    {att.kind === 'image' && att.dataUrl ? (
                      <img src={att.dataUrl} alt={att.name} className="w-8 h-8 rounded object-cover flex-shrink-0" />
                    ) : (
                      <FileText size={16} className="text-blue-400 flex-shrink-0" />
                    )}
                    <span className="text-xs text-[var(--color-text-primary)] truncate">{att.name}</span>
                    {att.status === 'loading' ? (
                      <Loader2 size={13} className="text-[var(--color-text-muted)] animate-spin flex-shrink-0" />
                    ) : (
                      <button
                        onClick={() => removeAttachment(att.id)}
                        className="flex-shrink-0 p-0.5 rounded text-[var(--color-text-muted)] hover:text-white transition-colors"
                        title="移除附件"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <input
              ref={attachInputRef}
              type="file"
              multiple
              accept=".png,.jpg,.jpeg,.gif,.webp,.bmp,.pdf,.doc,.docx,.txt,.md,.markdown"
              onChange={handleAttachFiles}
              className="hidden"
            />
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入消息，或上传图片/文档让 AI 分析…（Enter 发送，Shift+Enter 换行）"
              rows={1}
              className="w-full px-4 py-3 bg-transparent text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] resize-none outline-none text-sm"
              style={{ minHeight: '48px', maxHeight: '200px' }}
              disabled={isStreaming}
            />
            <div className="flex items-center justify-between px-4 pb-3">
              <div className="flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
                <button
                  onClick={handlePickAttachments}
                  disabled={attaching || isStreaming}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-primary)]/40 disabled:opacity-50 transition-colors"
                  title="上传图片或 Word/PDF/TXT/Markdown 文档，让 AI 识别分析"
                >
                  {attaching ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />}
                  <span>附件</span>
                </button>
                <button
                  onClick={() => setWebSearchEnabled(!webSearchEnabled)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border transition-colors ${
                    webSearchEnabled
                      ? 'bg-[var(--color-primary)]/10 border-[var(--color-primary)] text-[var(--color-primary)]'
                      : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-primary)]/40'
                  }`}
                  title="开启后，发送时将先联网搜索相关内容，再把搜索结果作为参考交给模型整合，并标注信息来源"
                >
                  <Globe size={14} />
                  <span>联网搜索</span>
                  {webSearchEnabled && <Check size={13} />}
                </button>
                <span className="hidden md:inline">当前模型：{getModelDisplayName(currentModel)}</span>
              </div>
              <button
                onClick={handleSend}
                disabled={(!input.trim() && attachments.every((a) => a.status !== 'ready')) || isStreaming}
                className="flex items-center gap-2 px-4 py-2 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] disabled:bg-[var(--color-text-muted)] disabled:cursor-not-allowed text-white rounded-lg transition-colors text-sm font-medium"
              >
                {isStreaming ? '生成中...' : '发送'}
                <Send size={16} />
              </button>
            </div>
          </div>
          <p className="text-center text-xs text-[var(--color-text-muted)] mt-3">
            AI 生成的内容仅供参考，请核实重要信息
          </p>
        </div>
      </div>

      {/* Save to Knowledge Modal */}
      {showKnowledgeModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowKnowledgeModal(false)}>
          <div
            className="bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-2xl w-full max-w-md mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
              <h3 className="font-medium text-white">加入知识库</h3>
              <button
                onClick={() => setShowKnowledgeModal(false)}
                className="p-1.5 hover:bg-[var(--color-sidebar-hover)] rounded-lg text-[var(--color-text-muted)] transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 max-h-96 overflow-y-auto">
              {/* 新建知识库输入 */}
              <div className="mb-4">
                <button
                  onClick={() => setShowNewBaseInput(!showNewBaseInput)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-500/20 to-purple-500/20 border border-blue-500/30 text-blue-400 rounded-lg hover:from-blue-500/30 hover:to-purple-500/30 transition-all text-sm font-medium"
                >
                  <Plus size={16} />
                  创建新知识库
                </button>
                {showNewBaseInput && (
                  <input
                    type="text"
                    value={newKnowledgeBaseName}
                    onChange={(e) => { setNewKnowledgeBaseName(e.target.value); setSelectedBaseId(null); }}
                    placeholder="输入知识库名称..."
                    className="w-full mt-3 px-4 py-2.5 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg text-white text-sm outline-none focus:border-blue-500"
                    autoFocus
                  />
                )}
              </div>

              <div className="relative">
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex-1 h-px bg-[var(--color-border)]"></div>
                  <span className="text-xs text-[var(--color-text-muted)]">或选择已有知识库</span>
                  <div className="flex-1 h-px bg-[var(--color-border)]"></div>
                </div>
              </div>

              {/* 知识库列表 */}
              <div className="space-y-2">
                {knowledgeBases.length === 0 ? (
                  <p className="text-center text-[var(--color-text-muted)] text-sm py-4">
                    暂无知识库，创建一个新的吧
                  </p>
                ) : (
                  knowledgeBases.map((base) => (
                    <div
                      key={base.id}
                      onClick={() => { setSelectedBaseId(base.id); setShowNewBaseInput(false); setNewKnowledgeBaseName(''); }}
                      className={`flex items-center gap-3 px-4 py-3 rounded-lg cursor-pointer transition-all border ${
                        selectedBaseId === base.id
                          ? 'bg-blue-500/20 border-blue-500/50'
                          : 'bg-[var(--color-bg-secondary)] border-[var(--color-border)] hover:border-blue-500/30'
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        selectedBaseId === base.id ? 'bg-blue-500/30 text-blue-400' : 'bg-[var(--color-card-bg)] text-[var(--color-text-muted)]'
                      }`}>
                        <Database size={16} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{base.name}</p>
                        <p className="text-xs text-[var(--color-text-muted)] truncate">{base.description || '暂无描述'}</p>
                      </div>
                      {selectedBaseId === base.id && (
                        <Check size={18} className="text-blue-400 flex-shrink-0" />
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 px-5 py-4 border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
              <button
                onClick={() => setShowKnowledgeModal(false)}
                className="flex-1 px-4 py-2.5 text-[var(--color-text-muted)] hover:text-white hover:bg-[var(--color-sidebar-hover)] rounded-lg transition-colors text-sm"
              >
                取消
              </button>
              <button
                onClick={handleSaveToKnowledge}
                disabled={savingToKnowledge || (!selectedBaseId && !newKnowledgeBaseName.trim())}
                className="flex-1 px-4 py-2.5 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg hover:opacity-90 transition-opacity text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {savingToKnowledge ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    保存中...
                  </>
                ) : (
                  '保存'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ChatPage;
