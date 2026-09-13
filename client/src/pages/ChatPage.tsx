import { useState, useEffect, useRef } from 'react';
import { Send, ChevronDown, Copy, ThumbsUp, ThumbsDown, RefreshCw } from 'lucide-react';
import { chatApi } from '../api';
import type { Message, Model } from '../types';
import ReactMarkdown from 'react-markdown';

function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [models, setModels] = useState<Model[]>([]);
  const [currentModel, setCurrentModel] = useState<string>('doubao-seed-2-0-pro-260215');
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load models on mount
  useEffect(() => {
    const loadModels = async () => {
      try {
        const res = await chatApi.getModels();
        setModels(res.models);
      } catch (error) {
        console.error('Failed to load models:', error);
        // Fallback models
        setModels([
          { id: 'doubao-seed-2-0-pro-260215', name: '豆包 Pro', provider: 'doubao' },
          { id: 'doubao-seed-2-0-lite-260215', name: '豆包 Lite', provider: 'doubao' },
          { id: 'minimax-m2-7-260318', name: 'MiniMax', provider: 'minimax' },
        ]);
      }
    };
    loadModels();
  }, []);

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

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;

    const userMessage: Message = { role: 'user', content: input.trim() };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput('');
    setIsStreaming(true);

    // Add placeholder assistant message
    const assistantMessage: Message = { role: 'assistant', content: '' };
    setMessages([...updatedMessages, assistantMessage]);

    try {
      // If no conversation exists, create one first
      let convId = currentConversationId;
      if (!convId) {
        const convRes = await chatApi.createConversation(input.trim().slice(0, 30), currentModel);
        convId = convRes.conversation.id;
        setCurrentConversationId(convId);
        // Notify sidebar
        const event = new CustomEvent('conversationCreated');
        window.dispatchEvent(event);
      }

      // Use streaming
      const controller = new AbortController();
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: updatedMessages,
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
                if (data.done) {
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
    } catch (error) {
      console.error('Chat error:', error);
      setMessages((prev) => {
        const newMessages = [...prev];
        newMessages[newMessages.length - 1] = {
          role: 'assistant',
          content: '抱歉，出现了错误，请稍后重试。',
        };
        return newMessages;
      });
    } finally {
      setIsStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const getModelDisplayName = (modelId: string) => {
    const model = models.find((m) => m.id === modelId);
    return model?.name || modelId;
  };

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
            <span className="w-2 h-2 rounded-full bg-green-500"></span>
            {getModelDisplayName(currentModel)}
            <ChevronDown size={16} className="text-[var(--color-text-muted)]" />
          </button>

          {showModelDropdown && (
            <div className="absolute right-0 top-full mt-2 w-56 bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-lg shadow-xl z-50 overflow-hidden animate-fade-in">
              <div className="p-2">
                <p className="text-xs text-[var(--color-text-muted)] px-2 py-1">选择模型</p>
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
                      {msg.content ? (
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      ) : (
                        <div className="flex gap-1">
                          <span className="typing-dot w-2 h-2 bg-[var(--color-text-muted)] rounded-full"></span>
                          <span className="typing-dot w-2 h-2 bg-[var(--color-text-muted)] rounded-full"></span>
                          <span className="typing-dot w-2 h-2 bg-[var(--color-text-muted)] rounded-full"></span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  )}

                  {msg.role === 'assistant' && msg.content && (
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
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入消息，按 Enter 发送，Shift+Enter 换行..."
              rows={1}
              className="w-full px-4 py-3 bg-transparent text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] resize-none outline-none text-sm"
              style={{ minHeight: '48px', maxHeight: '200px' }}
              disabled={isStreaming}
            />
            <div className="flex items-center justify-between px-4 pb-3">
              <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                <span>当前模型：{getModelDisplayName(currentModel)}</span>
              </div>
              <button
                onClick={handleSend}
                disabled={!input.trim() || isStreaming}
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
    </div>
  );
}

export default ChatPage;
