export function splitTextIntoChunks(text: string, maxLength: number = 500, overlap: number = 50): string[] {
  if (!text || text.length <= maxLength) {
    return [text || ''];
  }

  const chunks: string[] = [];
  let start = 0;
  // 防御：分块数量硬上限，任何异常路径都不可能死循环撑爆内存
  const HARD_LIMIT = Math.max(100, Math.ceil(text.length / Math.max(1, maxLength - overlap)) * 2 + 10);

  while (start < text.length && chunks.length < HARD_LIMIT) {
    let end = Math.min(start + maxLength, text.length);

    // 尝试在句子末尾分割
    if (end < text.length) {
      // 向前找最近的句号、换行符
      const punctuations = ['\n\n', '\n', '。', '！', '？', '.', '!', '?'];
      let splitPoint = -1;

      for (const punct of punctuations) {
        const idx = text.lastIndexOf(punct, end - 1);
        if (idx > start + maxLength / 2) {
          splitPoint = idx + punct.length;
          break;
        }
      }

      if (splitPoint > start) {
        end = splitPoint;
      }
    }

    const chunk = text.slice(start, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }

    // 已到达文末，必须退出（否则 start = end - overlap 会原地踏步造成死循环 → OOM）
    if (end >= text.length) break;

    const nextStart = end - overlap;
    // 确保 start 一定前进；异常时直接跳到 end
    start = nextStart > start ? nextStart : end;
  }

  return chunks;
}

export function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
