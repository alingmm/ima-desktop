export function splitTextIntoChunks(text: string, maxLength: number = 500, overlap: number = 50): string[] {
  if (!text || text.length <= maxLength) {
    return [text || ''];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
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

      if (splitPoint > 0) {
        end = splitPoint;
      }
    }

    chunks.push(text.slice(start, end).trim());
    start = end - overlap;

    // 确保 start 不断前进
    if (start <= 0 || start >= text.length) break;
  }

  return chunks.filter(c => c.length > 0);
}

export function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
