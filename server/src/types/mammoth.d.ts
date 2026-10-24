declare module 'mammoth' {
  interface ExtractResult {
    value: string;
    messages: Array<{ type: string; message: string }>;
  }
  export function extractRawText(input: { buffer: Buffer } | { path: string }): Promise<ExtractResult>;
  export function convertToHtml(input: { buffer: Buffer } | { path: string }): Promise<ExtractResult>;
  const _default: {
    extractRawText: typeof extractRawText;
    convertToHtml: typeof convertToHtml;
  };
  export default _default;
}
