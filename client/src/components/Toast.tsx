'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckCircle, AlertCircle, AlertTriangle, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  action?: { label: string; onClick: () => void };
  duration?: number;
}

interface ToastContextValue {
  toasts: Toast[];
  showToast: (toast: Omit<Toast, 'id'>) => string;
  success: (message: string, duration?: number) => string;
  error: (message: string, action?: Toast['action']) => string;
  warning: (message: string) => string;
  info: (message: string) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

const ERROR_CODE_MESSAGES: Record<string, { message: string; action?: Toast['action'] }> = {
  API_KEY_NOT_CONFIGURED: {
    message: '请先在设置页配置 API Key',
    action: { label: '去设置', onClick: () => window.dispatchEvent(new CustomEvent('navigate', { detail: 'settings' })) },
  },
  SEARCH_API_NOT_CONFIGURED: {
    message: '请在设置页配置联网搜索 API Key (Tavily)',
    action: { label: '去设置', onClick: () => window.dispatchEvent(new CustomEvent('navigate', { detail: 'settings' })) },
  },
  VIDEO_NOT_CONFIGURED: {
    message: '视频服务未配置，请在设置中开启',
    action: { label: '去设置', onClick: () => window.dispatchEvent(new CustomEvent('navigate', { detail: 'settings' })) },
  },
};

export function showApiError(error: any, toast: ToastContextValue): string | null {
  const errCode = error?.error || error?.code || (error instanceof Error ? error.message : '');
  const errMessage = error?.message || (error instanceof Error ? error.message : '请求失败');

  const matched = ERROR_CODE_MESSAGES[errCode];
  if (matched) {
    return toast.error(matched.message, matched.action);
  }

  // 通用错误
  toast.error(errMessage);
  return null;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const duration = toast.duration ?? (toast.type === 'error' ? 5000 : 3000);
    setToasts((prev) => [...prev, { ...toast, id }]);
    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }
    return id;
  }, []);

  const success = useCallback(
    (message: string, duration?: number) => showToast({ type: 'success', message, duration }),
    [showToast]
  );

  const error = useCallback(
    (message: string, action?: Toast['action']) => showToast({ type: 'error', message, action, duration: 6000 }),
    [showToast]
  );

  const warning = useCallback(
    (message: string) => showToast({ type: 'warning', message }),
    [showToast]
  );

  const info = useCallback(
    (message: string) => showToast({ type: 'info', message }),
    [showToast]
  );

  const iconMap: Record<ToastType, typeof CheckCircle> = {
    success: CheckCircle,
    error: AlertCircle,
    warning: AlertTriangle,
    info: AlertCircle,
  };

  const colorMap: Record<ToastType, string> = {
    success: 'border-green-500/40 bg-green-900/20 text-green-200',
    error: 'border-red-500/40 bg-red-900/20 text-red-200',
    warning: 'border-yellow-500/40 bg-yellow-900/20 text-yellow-200',
    info: 'border-blue-500/40 bg-blue-900/20 text-blue-200',
  };

  const iconColorMap: Record<ToastType, string> = {
    success: 'text-green-400',
    error: 'text-red-400',
    warning: 'text-yellow-400',
    info: 'text-blue-400',
  };

  return (
    <ToastContext.Provider value={{ toasts, showToast, success, error, warning, info, dismiss }}>
      {children}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map((toast) => {
          const Icon = iconMap[toast.type];
          return (
            <div
              key={toast.id}
              className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl border backdrop-blur-md shadow-lg animate-slide-in ${colorMap[toast.type]}`}
              style={{ animation: 'slideIn 0.25s ease-out' }}
            >
              <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${iconColorMap[toast.type]}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm leading-relaxed">{toast.message}</p>
                {toast.action && (
                  <button
                    onClick={() => {
                      toast.action?.onClick();
                      dismiss(toast.id);
                    }}
                    className="mt-2 text-xs font-medium underline underline-offset-2 hover:no-underline"
                  >
                    {toast.action.label}
                  </button>
                )}
              </div>
              <button
                onClick={() => dismiss(toast.id)}
                className="flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </ToastContext.Provider>
  );
}
