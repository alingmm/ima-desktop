import fs from 'fs';
import path from 'path';

// 支持上传/识别的文件类型
export const TEXT_EXTENSIONS = ['.txt', '.md', '.markdown', '.csv', '.json', '.log'];
export const DOC_EXTENSIONS = ['.docx'];
export const PDF_EXTENSIONS = ['.pdf'];
// 旧版 .doc / .ppt / .xls 等二进制格式无法可靠纯文本抽取，明确告知用户
export const UNSUPPORTED_EXTENSIONS = ['.doc', '.ppt', '.pptx', '.xls', '.xlsx'];
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'];

export interface ExtractResult {
  content: string;
  /** 实际用于抽取的归一化扩展名，如 .pdf / .docx */
  ext: string;
  /** 是否为可直接抽取文本的文档 */
  supported: boolean;
  /** 不支持时给用户看的大白话原因 */
  unsupportedReason?: string;
  /** 抽取是否部分失败（仍返回了兜底文本） */
  truncated?: boolean;
}

/**
 * 从上传的文件中抽取纯文本。
 * 支持：txt/md/markdown/csv/json/log、docx（Word 新版）、pdf。
 * 任何抽取异常都向上抛出，由调用方决定降级策略（不允许静默返回占位文本）。
 */
export async function extractTextFromFile(filePath: string, originalName: string): Promise<ExtractResult> {
  const ext = path.extname(originalName).toLowerCase();

  // 纯文本类
  if (TEXT_EXTENSIONS.includes(ext)) {
    const content = fs.readFileSync(filePath, 'utf-8');
    return { content, ext, supported: true };
  }

  // Word 新版 .docx（mammoth，解压 OOXML 抽文本）
  if (DOC_EXTENSIONS.includes(ext)) {
    const mammoth = await import('mammoth');
    const dataBuffer = fs.readFileSync(filePath);
    const result = await mammoth.extractRawText({ buffer: dataBuffer });
    const content = (result.value || '').trim();
    if (!content) {
      return {
        content: '',
        ext,
        supported: true,
        truncated: true,
        unsupportedReason: '这个 Word 文档里没有可读取的文字（可能是扫描图片或空文档）',
      };
    }
    return { content, ext, supported: true };
  }

  // PDF
  if (PDF_EXTENSIONS.includes(ext)) {
    const { default: pdfParse } = await import('pdf-parse');
    const dataBuffer = fs.readFileSync(filePath);
    const pdfData = await pdfParse(dataBuffer);
    const content = (pdfData.text || '').trim();
    if (!content) {
      return {
        content: '',
        ext,
        supported: true,
        truncated: true,
        unsupportedReason: '这个 PDF 里没有可读取的文字（可能是扫描件/图片版 PDF）',
      };
    }
    return { content, ext, supported: true };
  }

  // 明确不支持的旧版二进制格式
  if (UNSUPPORTED_EXTENSIONS.includes(ext)) {
    return {
      content: '',
      ext,
      supported: false,
      unsupportedReason:
        ext === '.doc'
          ? '暂不支持旧版 .doc 格式，请用 Word「另存为」转换成 .docx 后再上传'
          : '暂不支持该 Office 格式，请先另存为 PDF 或复制文字内容后再试',
    };
  }

  // 图片走多模态，不应在这里抽文本
  if (IMAGE_EXTENSIONS.includes(ext)) {
    return { content: '', ext, supported: false, unsupportedReason: '图片请直接在对话中发送以进行识别' };
  }

  return {
    content: '',
    ext,
    supported: false,
    unsupportedReason: '暂不支持这种文件格式，请上传 PDF、Word(.docx)、TXT 或 Markdown 文件',
  };
}

/** 限制抽取文本长度，避免超大文档一次性灌入上下文 */
export function clampText(text: string, maxChars = 30000): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}
