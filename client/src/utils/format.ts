// 全站统一的中文格式化工具（日期、相对时间、时长、文件大小）

const WEEK_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 完整日期时间：2026年10月23日 14:30 */
export function formatDateTime(iso?: string | number | Date | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 短日期时间：10月23日 14:30（今年内省略年份） */
export function formatShortDateTime(iso?: string | number | Date | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const head = sameYear ? `${d.getMonth() + 1}月${d.getDate()}日` : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  return `${head} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 仅日期：2026年10月23日 */
export function formatDate(iso?: string | number | Date | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 带周几的时间：10月23日 14:30 周一（执行时间预览用） */
export function formatDateTimeWithWeek(iso?: string | number | Date | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())} ${WEEK_NAMES[d.getDay()]}`;
}

/** 相对时间：刚刚 / 5分钟前 / 3小时前 / 2天前，超过 7 天回落到短日期 */
export function formatRelative(iso?: string | number | Date | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;
  return formatShortDateTime(d);
}

/** 执行耗时（中文单位）：0.4秒 / 12秒 / 1分05秒；不足 0.1 秒显示“不足0.1秒” */
export function formatDurationZh(ms?: number | null): string {
  if (ms === undefined || ms === null || ms < 0) return '';
  if (ms < 100) return '不足0.1秒';
  if (ms < 60000) {
    const sec = ms / 1000;
    return `${sec >= 10 ? Math.round(sec) : sec.toFixed(1)}秒`;
  }
  const min = Math.floor(ms / 60000);
  const sec = Math.round((ms % 60000) / 1000);
  return sec === 0 ? `${min}分钟` : `${min}分${pad(sec)}秒`;
}

/** 文件大小（中文习惯，保留一位小数）：1.2 KB / 3.4 MB / 2.0 GB */
export function formatFileSize(bytes?: number | null): string {
  if (bytes === undefined || bytes === null || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** 中文数字千分位（大陆习惯用逗号分隔） */
export function formatNumber(n?: number | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '';
  return n.toLocaleString('zh-CN');
}
