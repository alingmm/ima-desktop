// 标准 5 段 cron 解析与「下次执行时间」计算
// 支持语法：*、*/n、单个数字、逗号列表(1,2,3)、范围(1-5)、范围步进(1-10/2)
// 段顺序：分钟(0-59) 小时(0-23) 日(1-31) 月(1-12) 周(0-6,0=周日;7也视作周日)
// 标准 cron 语义：当「日」和「周」都指定（非*）时，满足任一即执行（OR），否则需同时满足

interface CronSpec {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>; // day of month
  month: Set<number>;
  dow: Set<number>; // day of week, 0=周日
  domAny: boolean;
  dowAny: boolean;
}

// 解析单个字段，失败返回 null
function parseField(field: string, min: number, max: number): Set<number> | null {
  const result = new Set<number>();
  for (const part of field.split(',')) {
    const p = part.trim();
    if (!p) return null;

    if (p === '*') {
      for (let i = min; i <= max; i++) result.add(i);
      continue;
    }

    // */n
    const stepAll = p.match(/^\*\/(\d+)$/);
    if (stepAll) {
      const step = parseInt(stepAll[1], 10);
      if (step <= 0) return null;
      for (let i = min; i <= max; i += step) result.add(i);
      continue;
    }

    // a-b 或 a-b/n
    const range = p.match(/^(\d+)-(\d+)(?:\/(\d+))?$/);
    if (range) {
      const lo = parseInt(range[1], 10);
      const hi = parseInt(range[2], 10);
      const step = range[3] ? parseInt(range[3], 10) : 1;
      if (lo < min || hi > max || lo > hi || step <= 0) return null;
      for (let i = lo; i <= hi; i += step) result.add(i);
      continue;
    }

    // 单个数字
    if (/^\d+$/.test(p)) {
      const v = parseInt(p, 10);
      if (v < min || v > max) return null;
      result.add(v);
      continue;
    }

    return null;
  }
  return result.size > 0 ? result : null;
}

// 解析完整 cron 表达式，非法返回 null
export function parseCron(expr: string): CronSpec | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const minute = parseField(parts[0], 0, 59);
  const hour = parseField(parts[1], 0, 23);
  const dom = parseField(parts[2], 1, 31);
  const month = parseField(parts[3], 1, 12);
  // 周字段允许 0-7，7 归一为 0（周日）
  const dowRaw = parseField(parts[4], 0, 7);

  if (!minute || !hour || !dom || !month || !dowRaw) return null;

  const dow = new Set<number>();
  for (const d of dowRaw) dow.add(d === 7 ? 0 : d);

  return {
    minute,
    hour,
    dom,
    month,
    dow,
    domAny: parts[2] === '*',
    dowAny: parts[4] === '*',
  };
}

export function isValidCron(expr: string): boolean {
  return parseCron(expr) !== null;
}

function matchesDate(spec: CronSpec, d: Date): boolean {
  if (!spec.month.has(d.getMonth() + 1)) return false;
  const domMatch = spec.dom.has(d.getDate());
  const dowMatch = spec.dow.has(d.getDay());
  // 日与周：都指定时 OR；任一 * 时按另一个匹配
  if (!spec.domAny && !spec.dowAny) return domMatch || dowMatch;
  if (spec.domAny && !spec.dowAny) return dowMatch;
  if (!spec.domAny && spec.dowAny) return domMatch;
  return true;
}

// 计算下次执行时间；表达式非法或 4 年内无匹配（如 2月31日）返回 null
export function getNextRunFromCron(expr: string, from: Date = new Date()): Date | null {
  const spec = parseCron(expr);
  if (!spec) return null;

  // 从下一分钟开始找
  const cursor = new Date(from);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  // 先按天推进找匹配的日期（最多 4*366 天），再在当天内找最早匹配时分
  for (let dayOffset = 0; dayOffset < 1464; dayOffset++) {
    const day = new Date(cursor);
    day.setDate(cursor.getDate() + dayOffset);
    day.setHours(0, 0, 0, 0);

    if (!matchesDate(spec, day)) continue;

    // 当天内按小时+分钟找最早匹配
    for (let h = 0; h < 24; h++) {
      if (!spec.hour.has(h)) continue;
      for (let m = 0; m < 60; m++) {
        if (!spec.minute.has(m)) continue;
        const candidate = new Date(day);
        candidate.setHours(h, m, 0, 0);
        if (candidate > from) return candidate;
      }
    }
    // 当天没有晚于 from 的时分，继续下一天
  }
  return null;
}

const WEEK_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// 把 cron 翻译成中文说明（面向小白）；识别不了返回 null
export function describeCronZh(expr: string): string | null {
  const spec = parseCron(expr);
  if (!spec) return null;

  const parts = expr.trim().split(/\s+/);

  // 时间部分：单个 时+分 才算得出具体时间
  const singleTime =
    spec.hour.size === 1 && spec.minute.size === 1
      ? `${pad2([...spec.hour][0])}:${pad2([...spec.minute][0])}`
      : null;

  // 每天 / 每隔几小时 / 每小时：日和周都是 *
  if (parts[2] === '*' && spec.dowAny && parts[3] === '*') {
    // 每隔几小时：0 */N * * *
    const hourStep = parts[1].match(/^\*\/(\d+)$/);
    if (hourStep && parts[0] === '0') {
      return `每隔 ${hourStep[1]} 小时（整点）`;
    }
    if (parts[0] === '0' && parts[1] === '*') return '每小时（整点）';
    if (singleTime) return `每天 ${singleTime}`;
    return null;
  }

  // 每隔几天（dom 是 */N，月*、周*）
  const domStep = parts[2].match(/^\*\/(\d+)$/);
  if (domStep && parts[3] === '*' && spec.dowAny && singleTime) {
    return `每隔 ${domStep[1]} 天 ${singleTime}`;
  }

  // 每月某天 m H D * *
  if (!spec.domAny && spec.dowAny && parts[3] === '*' && spec.dom.size === 1 && singleTime) {
    return `每月 ${[...spec.dom][0]} 号 ${singleTime}`;
  }

  // 每周某天 m H * * D（单个周几）
  if (spec.domAny && !spec.dowAny && spec.dow.size === 1 && singleTime) {
    return `每${WEEK_NAMES[[...spec.dow][0]]} ${singleTime}`;
  }

  // 每周多天 m H * * 1,3,5
  if (spec.domAny && !spec.dowAny && spec.dow.size > 1 && singleTime) {
    const days = [...spec.dow].sort().map((d) => WEEK_NAMES[d]).join('、');
    return `每周 ${days} ${singleTime}`;
  }

  return null;
}
