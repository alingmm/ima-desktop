// 标准 5 段 cron 解析、下次执行时间计算、中文翻译（与后端 utils/cron.ts 逻辑一致）
// 段顺序：分钟(0-59) 小时(0-23) 日(1-31) 月(1-12) 周(0-6,0=周日;7视作周日)

interface CronSpec {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  domAny: boolean;
  dowAny: boolean;
}

function parseField(field: string, min: number, max: number): Set<number> | null {
  const result = new Set<number>();
  for (const part of field.split(',')) {
    const p = part.trim();
    if (!p) return null;

    if (p === '*') {
      for (let i = min; i <= max; i++) result.add(i);
      continue;
    }

    const stepAll = p.match(/^\*\/(\d+)$/);
    if (stepAll) {
      const step = parseInt(stepAll[1], 10);
      if (step <= 0) return null;
      for (let i = min; i <= max; i += step) result.add(i);
      continue;
    }

    const range = p.match(/^(\d+)-(\d+)(?:\/(\d+))?$/);
    if (range) {
      const lo = parseInt(range[1], 10);
      const hi = parseInt(range[2], 10);
      const step = range[3] ? parseInt(range[3], 10) : 1;
      if (lo < min || hi > max || lo > hi || step <= 0) return null;
      for (let i = lo; i <= hi; i += step) result.add(i);
      continue;
    }

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

export function parseCron(expr: string): CronSpec | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const minute = parseField(parts[0], 0, 59);
  const hour = parseField(parts[1], 0, 23);
  const dom = parseField(parts[2], 1, 31);
  const month = parseField(parts[3], 1, 12);
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
  if (!spec.domAny && !spec.dowAny) return domMatch || dowMatch;
  if (spec.domAny && !spec.dowAny) return dowMatch;
  if (!spec.domAny && spec.dowAny) return domMatch;
  return true;
}

export function getNextRunFromCron(expr: string, from: Date = new Date()): Date | null {
  const spec = parseCron(expr);
  if (!spec) return null;

  const cursor = new Date(from);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  for (let dayOffset = 0; dayOffset < 1464; dayOffset++) {
    const day = new Date(cursor);
    day.setDate(cursor.getDate() + dayOffset);
    day.setHours(0, 0, 0, 0);

    if (!matchesDate(spec, day)) continue;

    for (let h = 0; h < 24; h++) {
      if (!spec.hour.has(h)) continue;
      for (let m = 0; m < 60; m++) {
        if (!spec.minute.has(m)) continue;
        const candidate = new Date(day);
        candidate.setHours(h, m, 0, 0);
        if (candidate > from) return candidate;
      }
    }
  }
  return null;
}

const WEEK_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// 把 cron 翻译成中文说明；识别不了返回 null
export function describeCronZh(expr: string): string | null {
  const spec = parseCron(expr);
  if (!spec) return null;

  const parts = expr.trim().split(/\s+/);

  const singleTime =
    spec.hour.size === 1 && spec.minute.size === 1
      ? `${pad2([...spec.hour][0])}:${pad2([...spec.minute][0])}`
      : null;

  // 每天 / 每隔几小时 / 每小时：日和周都是 *
  if (parts[2] === '*' && spec.dowAny && parts[3] === '*') {
    const hourStep = parts[1].match(/^\*\/(\d+)$/);
    if (hourStep && parts[0] === '0') {
      return `每隔 ${hourStep[1]} 小时（整点）`;
    }
    if (parts[0] === '0' && parts[1] === '*') return '每小时（整点）';
    if (singleTime) return `每天 ${singleTime}`;
    return null;
  }

  // 每隔几天：m H */N * *
  const domStep = parts[2].match(/^\*\/(\d+)$/);
  if (domStep && parts[3] === '*' && spec.dowAny && singleTime) {
    return `每隔 ${domStep[1]} 天 ${singleTime}`;
  }

  // 每月某天：m H D * *
  if (!spec.domAny && spec.dowAny && parts[3] === '*' && spec.dom.size === 1 && singleTime) {
    return `每月 ${[...spec.dom][0]} 号 ${singleTime}`;
  }

  // 每周某天：m H * * D
  if (spec.domAny && !spec.dowAny && spec.dow.size === 1 && singleTime) {
    return `每${WEEK_NAMES[[...spec.dow][0]]} ${singleTime}`;
  }

  // 每周多天：m H * * 1,3,5
  if (spec.domAny && !spec.dowAny && spec.dow.size > 1 && singleTime) {
    const days = [...spec.dow].sort().map((d) => WEEK_NAMES[d]).join('、');
    return `每周 ${days} ${singleTime}`;
  }

  return null;
}

// ========== 表单模式识别（编辑回显用） ==========

export type ScheduleKind =
  | 'hourly' // 每小时（整点）
  | 'daily' // 每天指定时间
  | 'weekly' // 每周某天
  | 'monthly' // 每月某天
  | 'interval_hours' // 每隔 N 小时
  | 'interval_days' // 每隔 N 天
  | 'custom'; // 高级自定义 cron

export interface ScheduleFormValue {
  kind: ScheduleKind;
  time: string; // HH:mm，每天/每周/每月/每隔几天用
  weekday: number; // 0-6，每周用（0=周日）
  monthday: number; // 1-31，每月用
  interval: number; // N，每隔几小时/几天用
  customCron: string; // 自定义模式的手填表达式
}

export const DEFAULT_SCHEDULE_FORM: ScheduleFormValue = {
  kind: 'daily',
  time: '09:00',
  weekday: 1,
  monthday: 1,
  interval: 2,
  customCron: '0 9 * * *',
};

// 把表单值转成存储用的 { frequency, cronExpression }
export function formToSchedule(
  v: ScheduleFormValue,
): { frequency: 'hourly' | 'custom'; cronExpression?: string } {
  const [h, m] = (v.time || '09:00').split(':').map((s) => parseInt(s, 10));
  const mm = isNaN(m) ? 0 : m;
  const hh = isNaN(h) ? 9 : h;

  switch (v.kind) {
    case 'hourly':
      return { frequency: 'hourly' };
    case 'daily':
      return { frequency: 'custom', cronExpression: `${mm} ${hh} * * *` };
    case 'weekly':
      return { frequency: 'custom', cronExpression: `${mm} ${hh} * * ${v.weekday}` };
    case 'monthly':
      return { frequency: 'custom', cronExpression: `${mm} ${hh} ${v.monthday} * *` };
    case 'interval_hours': {
      const n = Math.min(Math.max(v.interval || 1, 1), 23);
      return n === 1
        ? { frequency: 'hourly' }
        : { frequency: 'custom', cronExpression: `0 */${n} * * *` };
    }
    case 'interval_days': {
      const n = Math.min(Math.max(v.interval || 1, 1), 30);
      return n === 1
        ? { frequency: 'custom', cronExpression: `${mm} ${hh} * * *` }
        : { frequency: 'custom', cronExpression: `${mm} ${hh} */${n} * *` };
    }
    case 'custom':
      return { frequency: 'custom', cronExpression: v.customCron.trim() };
  }
}

// 把已存储的 frequency + cron 还原成表单值（编辑回显）
export function scheduleToForm(frequency: string, cron?: string): ScheduleFormValue {
  const base = { ...DEFAULT_SCHEDULE_FORM };

  // 老数据：无 cron 的内建频率
  if (frequency === 'hourly' && !cron) return { ...base, kind: 'hourly' };
  if (frequency === 'daily' && !cron) return { ...base, kind: 'daily', time: '09:00' };
  if (frequency === 'weekly' && !cron) return { ...base, kind: 'weekly', weekday: 1, time: '09:00' };

  if (!cron) return base;

  const spec = parseCron(cron);
  if (!spec) return { ...base, kind: 'custom', customCron: cron };

  const parts = cron.trim().split(/\s+/);
  const singleHour = spec.hour.size === 1 ? [...spec.hour][0] : null;
  const singleMinute = spec.minute.size === 1 ? [...spec.minute][0] : null;
  const time =
    singleHour !== null && singleMinute !== null
      ? `${pad2(singleHour)}:${pad2(singleMinute)}`
      : '09:00';

  // 每隔几小时：0 */N * * *
  const hourStep = parts[1].match(/^\*\/(\d+)$/);
  if (parts[2] === '*' && spec.dowAny && parts[3] === '*') {
    if (hourStep && parts[0] === '0') {
      return { ...base, kind: 'interval_hours', interval: parseInt(hourStep[1], 10) };
    }
    if (parts[0] === '0' && parts[1] === '*') return { ...base, kind: 'hourly' };
    if (time) return { ...base, kind: 'daily', time };
    return { ...base, kind: 'custom', customCron: cron };
  }

  // 每隔几天：m H */N * *
  const domStep = parts[2].match(/^\*\/(\d+)$/);
  if (domStep && parts[3] === '*' && spec.dowAny) {
    return { ...base, kind: 'interval_days', interval: parseInt(domStep[1], 10), time };
  }

  // 每月某天：m H D * *
  if (!spec.domAny && spec.dowAny && parts[3] === '*' && spec.dom.size === 1) {
    return { ...base, kind: 'monthly', monthday: [...spec.dom][0], time };
  }

  // 每周某天：m H * * D（单个）
  if (spec.domAny && !spec.dowAny && spec.dow.size === 1) {
    return { ...base, kind: 'weekly', weekday: [...spec.dow][0], time };
  }

  // 识别不了：回退到自定义模式展示原始 cron
  return { ...base, kind: 'custom', customCron: cron };
}

// 人类可读的频率描述（列表/详情展示用），兼容老数据
export function describeScheduleZh(frequency: string, cron?: string): string {
  if (cron) {
    const desc = describeCronZh(cron);
    if (desc) return desc;
    return `自定义：${cron}`;
  }
  switch (frequency) {
    case 'hourly':
      return '每小时（整点）';
    case 'daily':
      return '每天 09:00';
    case 'weekly':
      return '每周一 09:00';
    default:
      return '自定义';
  }
}

// 计算下次执行预览（表单实时用）
export function previewNextRun(v: ScheduleFormValue): Date | null {
  if (v.kind === 'custom' && !isValidCron(v.customCron)) return null;
  const { frequency, cronExpression } = formToSchedule(v);
  if (frequency === 'hourly') {
    const next = new Date();
    next.setHours(next.getHours() + 1);
    next.setMinutes(0, 0, 0);
    return next;
  }
  return cronExpression ? getNextRunFromCron(cronExpression) : null;
}
