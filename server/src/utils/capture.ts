// 网页 / 视频链接抓取工具
// - 服务端发起 HTTP 请求（带浏览器 UA，尊重站点限制，不做反爬绕过）
// - cheerio 轻量解析，清洗 script/style/nav/footer/广告等噪声
// - 视频平台优先用公开 oEmbed / 页面内嵌 JSON 提取元信息，绝不伪造字幕或正文

import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';

const FETCH_TIMEOUT_MS = 15000;
const MAX_BYTES = 8 * 1024 * 1024; // 最多读取 8MB，防止超大页面拖垮服务

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export class CaptureError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'CaptureError';
    this.code = code;
    this.status = status;
  }
}

export interface WebCaptureResult {
  title: string;
  content: string;
  url: string;
  final_url: string;
  description?: string;
  site_name?: string;
  char_count: number;
  truncated: boolean;
}

export interface VideoCaptureResult {
  platform: string;
  title: string;
  author?: string;
  description?: string;
  thumbnail?: string;
  duration_seconds?: number;
  url: string;
  final_url: string;
  has_transcript: boolean; // 是否拿到了字幕/正文（本工具不伪造，通常为 false）
  note?: string;
}

// 校验 URL 合法性，只允许 http/https
export function normalizeUrl(input: string): URL {
  const raw = (input || '').trim();
  if (!raw) throw new CaptureError('EMPTY_URL', '请先粘贴要抓取的链接');
  let u: URL;
  try {
    // 允许用户只输入 xxx.com，自动补 https://
    u = /^https?:\/\//i.test(raw) ? new URL(raw) : new URL(`https://${raw}`);
  } catch {
    throw new CaptureError('INVALID_URL', '链接格式不对，请粘贴以 http(s):// 开头的完整网址');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new CaptureError('INVALID_URL', '只支持 http 或 https 开头的网页链接');
  }
  // 域名至少要包含一个点，排除 not-a-valid-url 这类被误补成域名的情况
  if (!u.hostname.includes('.') || /[^a-z0-9.\-:]/i.test(u.hostname)) {
    throw new CaptureError('INVALID_URL', '链接格式不对，请粘贴完整的网址（如 https://example.com/...）');
  }
  return u;
}

// 从响应头 + meta 探测编码
function detectCharset(contentType: string | null, htmlHead: string): string {
  const fromHeader = /charset=([\w-]+)/i.exec(contentType || '');
  if (fromHeader) return fromHeader[1].toLowerCase();
  const fromMeta = /<meta[^>]+charset=["']?\s*([\w-]+)/i.exec(htmlHead);
  if (fromMeta) return fromMeta[1].toLowerCase();
  return 'utf-8';
}

function decodeBuffer(buf: Buffer, charset: string): string {
  const c = charset.toLowerCase().replace(/_/g, '-');
  // 常见别名归一
  if (['utf8', 'utf-8'].includes(c)) return buf.toString('utf-8');
  if (['gb2312', 'gbk', 'gb18030', 'x-gbk'].includes(c)) {
    return iconv.decode(buf, c === 'gb2312' ? 'gb18030' : c);
  }
  if (iconv.encodingExists(c)) {
    try {
      return iconv.decode(buf, c);
    } catch {
      return buf.toString('utf-8');
    }
  }
  return buf.toString('utf-8');
}

// 发起请求并读取为 Buffer（跟随重定向、限制大小、超时）
async function fetchBytes(
  target: string,
  accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
): Promise<{ buf: Buffer; finalUrl: string; contentType: string | null; status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(target, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: accept,
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    });
  } catch (e: any) {
    clearTimeout(timer);
    if (e?.name === 'AbortError') {
      throw new CaptureError('TIMEOUT', '抓取超时了，可能是网站响应太慢或网络不通，请稍后重试');
    }
    throw new CaptureError(
      'NETWORK_ERROR',
      '打不开这个链接（网络不通或站点无法访问），请确认链接正确后重试',
    );
  }
  clearTimeout(timer);

  if (res.status === 401 || res.status === 403) {
    throw new CaptureError(
      'FORBIDDEN',
      '该网站拒绝了抓取请求（需要登录或有反爬限制），请换一个公开可访问的链接',
      res.status,
    );
  }
  if (res.status === 404) {
    throw new CaptureError('NOT_FOUND', '页面不存在（404），请确认链接是否有效', 404);
  }
  if (res.status >= 400) {
    throw new CaptureError('HTTP_ERROR', `网站返回了错误（${res.status}），暂时无法抓取`, res.status);
  }

  const contentType = res.headers.get('content-type');
  // 限制读取大小
  const reader = res.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.length;
        chunks.push(value);
        if (total > MAX_BYTES) break;
      }
    }
  }
  return {
    buf: Buffer.concat(chunks.map((c) => Buffer.from(c))),
    finalUrl: res.url || target,
    contentType,
    status: res.status,
  };
}

function fetchHtml(target: string): Promise<{ html: string; finalUrl: string; contentType: string | null }> {
  return fetchBytes(target).then(({ buf, finalUrl, contentType }) => {
    const head = buf.subarray(0, 4096).toString('latin1');
    const charset = detectCharset(contentType, head);
    return { html: decodeBuffer(buf, charset), finalUrl, contentType };
  });
}

const NOISE_SELECTORS = [
  'script',
  'style',
  'noscript',
  'iframe',
  'svg',
  'nav',
  'footer',
  'header',
  'form',
  'button',
  'aside',
  '[role="navigation"]',
  '.advertisement',
  '.advert',
  '.ads',
  '.ad',
  '.banner',
  '.sidebar',
  '.comment',
  '.comments',
  '.related',
  '.recommend',
  '.share',
  '.breadcrumb',
  '.cookie',
  '#comments',
  '#sidebar',
  '#footer',
  '#header',
];

// 从候选容器中选文本密度最高的作为正文
function extractMainText($: cheerio.CheerioAPI): string {
  // 先全局移除噪声标签（含内联 style/script），避免正文候选里混入样式代码
  for (const noise of NOISE_SELECTORS) $(noise).remove();
  const candidates = ['article', 'main', '[role="main"]', '.article', '.content', '.post', '#content', '#main'];
  let best = '';
  let bestScore = -1;
  for (const sel of candidates) {
    const node = $(sel).first();
    if (node.length === 0) continue;
    const text = cleanText(node.text());
    const score = text.length;
    if (score > bestScore) {
      bestScore = score;
      best = text;
    }
  }
  if (best.length >= 200) return best;

  // 兜底：清洗整个 body
  const body = $('body').clone();
  for (const noise of NOISE_SELECTORS) body.find(noise).remove();
  return cleanText(body.text());
}

function cleanText(raw: string): string {
  // 部分站点把 <style>/<script> 以转义文本内嵌，cheerio 不当标签处理，这里兜底剥掉
  const stripped = raw
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '');
  return stripped
    .replace(/ /g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      if (line.length === 0) return false;
      // 过滤漏网的纯 CSS 行（形如 selector{prop:value;...}，同行含 { } 和属性声明）
      if (line.includes('{') && line.includes('}') && /[a-z-]\s*:\s*\S/.test(line)) return false;
      return true;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function truncate(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  return { text: text.slice(0, max).trimEnd() + '\n……（内容较长，已截断，可用「大模型整理」查看完整要点）', truncated: true };
}

// 抓取普通网页
export async function captureWeb(inputUrl: string, maxChars = 20000): Promise<WebCaptureResult> {
  const u = normalizeUrl(inputUrl);
  const { html, finalUrl } = await fetchHtml(u.toString());
  const $ = cheerio.load(html);

  const ogTitle = $('meta[property="og:title"]').attr('content')?.trim();
  const docTitle = $('title').text().trim();
  const h1 = $('h1').first().text().trim();
  const title = ogTitle || h1 || docTitle || finalUrl;

  const description =
    $('meta[name="description"]').attr('content')?.trim() ||
    $('meta[property="og:description"]').attr('content')?.trim() ||
    undefined;
  const siteName = $('meta[property="og:site_name"]').attr('content')?.trim() || undefined;

  const mainText = extractMainText($);
  if (!mainText || mainText.length < 40) {
    throw new CaptureError(
      'NO_CONTENT',
      '页面抓到了，但没有提取到有效正文（可能需要登录、是纯图片/视频页，或站点限制抓取）',
    );
  }

  const { text, truncated } = truncate(mainText, maxChars);
  return {
    title,
    content: text,
    url: u.toString(),
    final_url: finalUrl,
    description,
    site_name: siteName,
    char_count: text.length,
    truncated,
  };
}

// ========== 视频平台识别与元信息 ==========

interface PlatformRule {
  id: string;
  name: string;
  test: (host: string, pathname: string) => boolean;
}

const PLATFORMS: PlatformRule[] = [
  { id: 'bilibili', name: '哔哩哔哩', test: (h) => h.endsWith('bilibili.com') || h === 'b23.tv' },
  { id: 'youtube', name: 'YouTube', test: (h) => h.endsWith('youtube.com') || h === 'youtu.be' },
  { id: 'douyin', name: '抖音', test: (h) => h.endsWith('douyin.com'), },
  { id: 'kuaishou', name: '快手', test: (h) => h.endsWith('kuaishou.com') || h.endsWith('gifshow.com') },
  { id: 'weibo', name: '微博视频', test: (h) => h.endsWith('weibo.com') || h.endsWith('weibo.cn') },
  { id: 'xigua', name: '西瓜视频', test: (h) => h.endsWith('ixigua.com') || h.endsWith('xigua.com') },
];

export function detectPlatform(urlStr: string): { id: string; name: string } {
  const u = new URL(urlStr);
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  for (const p of PLATFORMS) {
    if (p.test(host, u.pathname)) return { id: p.id, name: p.name };
  }
  return { id: 'unknown', name: '视频网站' };
}

function parseDurationToSeconds(text: string): number | undefined {
  if (!text) return undefined;
  // 支持 PT1H2M30S（ISO8601）和 1:02:30 / 02:30
  const iso = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i.exec(text);
  if (iso) {
    const h = parseInt(iso[1] || '0', 10);
    const m = parseInt(iso[2] || '0', 10);
    const s = parseInt(iso[3] || '0', 10);
    return h * 3600 + m * 60 + s;
  }
  const parts = text.trim().split(':').map((x) => parseInt(x, 10));
  if (parts.length >= 2 && parts.every((x) => !isNaN(x))) {
    return parts.reduce((acc, cur) => acc * 60 + cur, 0);
  }
  return undefined;
}

function getMeta($: cheerio.CheerioAPI, selectors: string[]): string | undefined {
  for (const s of selectors) {
    const v = $(s).attr('content')?.trim();
    if (v) return v;
  }
  return undefined;
}

async function fetchJson<T = any>(target: string): Promise<T | null> {
  try {
    const { buf } = await fetchBytes(target, 'application/json');
    return JSON.parse(buf.toString('utf-8')) as T;
  } catch {
    return null;
  }
}

// 抓取视频链接元信息（不伪造字幕/正文）
export async function captureVideo(inputUrl: string): Promise<VideoCaptureResult> {
  const u = normalizeUrl(inputUrl);
  const { html, finalUrl } = await fetchHtml(u.toString());
  const platform = detectPlatform(finalUrl);
  const $ = cheerio.load(html);

  // 优先尝试公开 oEmbed（YouTube / Bilibili 等提供）
  let oembed: any = null;
  const oembedLink = $('link[type="application/json+oembed"]').attr('href');
  if (oembedLink) {
    oembed = await fetchJson(oembedLink);
  }
  if (!oembed && platform.id === 'youtube') {
    const youId = extractYouTubeId(finalUrl);
    if (youId) {
      oembed = await fetchJson(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${youId}&format=json`);
    }
  }
  if (!oembed && platform.id === 'bilibili') {
    const bv = /(BV[\w]+)/.exec(finalUrl)?.[1];
    if (bv) {
      oembed = await fetchJson(`https://api.bilibili.com/x/web-interface/view?bvid=${bv}`);
    }
  }

  const metaTitle =
    oembed?.title ||
    oembed?.data?.title ||
    getMeta($, ['meta[property="og:title"]', 'meta[name="title"]', 'meta[name="twitter:title"]']) ||
    $('title').text().trim();

  const author =
    oembed?.author_name ||
    oembed?.data?.owner?.name ||
    getMeta($, ['meta[name="author"]', '[itemprop="author"]']) ||
    undefined;

  const description =
    oembed?.data?.desc ||
    getMeta($, [
      'meta[property="og:description"]',
      'meta[name="description"]',
      'meta[name="twitter:description"]',
    ]) ||
    undefined;

  const thumbnail =
    oembed?.thumbnail_url ||
    oembed?.data?.pic ||
    (() => {
      const pic = getMeta($, ['meta[property="og:image"]', 'meta[name="twitter:image"]']);
      return pic ? new URL(pic, finalUrl).toString() : undefined;
    })();

  // 时长：B站接口 duration（秒）/ YouTube itemprop duration / 页面 meta
  let durationSeconds: number | undefined;
  if (typeof oembed?.data?.duration === 'number') {
    durationSeconds = oembed.data.duration;
  } else {
    const isoDuration = $('[itemprop="duration"]').attr('content') || $('meta[itemprop="duration"]').attr('content');
    if (isoDuration) durationSeconds = parseDurationToSeconds(isoDuration);
    if (!durationSeconds) {
      const ogVideo = $('meta[property="og:video:duration"]').attr('content');
      if (ogVideo) {
        const n = parseInt(ogVideo, 10);
        if (!isNaN(n)) durationSeconds = n;
      }
    }
  }

  if (!metaTitle) {
    throw new CaptureError(
      'NO_METADATA',
      '没有抓到这个视频的有效信息（可能需要登录、在 App 内打开，或站点限制了访问）',
    );
  }

  return {
    platform: platform.name,
    title: metaTitle,
    author,
    description: description || undefined,
    thumbnail,
    duration_seconds: durationSeconds,
    url: u.toString(),
    final_url: finalUrl,
    has_transcript: false,
    note: '已获取视频标题、作者、简介、封面等公开信息；字幕/逐字稿无法通过公开方式获取，未生成视频正文。',
  };
}

function extractYouTubeId(urlStr: string): string | null {
  try {
    const u = new URL(urlStr);
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).split('/')[0] || null;
    if (u.hostname.includes('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v) return v;
      const shorts = /\/shorts\/([\w-]+)/.exec(u.pathname);
      if (shorts) return shorts[1];
    }
    return null;
  } catch {
    return null;
  }
}
