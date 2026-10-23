// 把执行期抛出的异常翻译为面向小白的中文提示（保留已是中文的后端文案）
export function friendlyTaskError(err: any): string {
  const msg: string = err?.message || String(err || '');
  // 后端自己抛出的中文错误直接使用
  if (/[\u4e00-\u9fa5]/.test(msg)) return msg;
  const lower = msg.toLowerCase();
  if (err?.error_code === 'MISSING_API_KEY' || /api key|unauthorized|401/.test(lower)) {
    return '还没设置大模型或密钥无效，请去「设置」检查 API Key 和模型';
  }
  if (/timeout|timed out|econnaborted|aborted/.test(lower)) {
    return '调用大模型超时了，请稍后重试';
  }
  if (/network|econnrefused|enotfound|fetch failed|getaddrinfo|socket hang up/.test(lower)) {
    return '网络连不上，请检查网络后重试';
  }
  if (/rate limit|429|too many requests/.test(lower)) {
    return '当前模型调用太频繁，请稍等一会儿再试';
  }
  if (/json|parse|syntax|unexpected token/.test(lower)) {
    return '模型这次返回的内容没能解析成功，可以再试一次';
  }
  return '执行出错了，请稍后重试';
}
