// OpenStreetMap opening_hours, the common forms only:
//   "Mo-Fr 11:00-22:00; Sa,Su 10:00-23:00", "24/7", "Mo off", "Fr-Sa 16:00-02:00" (past midnight),
//   "Mo-Fr 08:00-12:00,13:00-17:00", "PH off" (holiday rules are ignored).
// Anything fancier (months, sunrise, week numbers, comments) returns null so the
// app shows the raw text instead of guessing. Pure and unit-tested (tests/hours.test.ts).

/** Minutes from midnight; an end past 1440 runs into the next day. */
type Interval = [number, number];

/** Index 0 = Monday … 6 = Sunday. */
export type WeekSchedule = Interval[][];

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_RE = '(?:Mo|Tu|We|Th|Fr|Sa|Su)';
const SELECTOR_RE = new RegExp(`^(${DAY_RE}(?:-${DAY_RE})?(?:,${DAY_RE}(?:-${DAY_RE})?)*)(?:\\s+|$)`);
const TIME_RE = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/;

function normalize(raw: string): string {
  return raw
    .trim()
    .replace(/[–—]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s*,\s*/g, ',')
    .replace(/\b(mo|tu|we|th|fr|sa|su)\b/gi, (d) => d[0].toUpperCase() + d[1].toLowerCase())
    // "Mo-Fr 10:00-18:00, Sa 10:00-14:00": a comma after a time that starts a new day selector is a new rule.
    .replace(/(\d),((?:Mo|Tu|We|Th|Fr|Sa|Su|PH)\b)/g, '$1;$2');
}

function expandDays(selector: string): number[] | null {
  const out = new Set<number>();
  for (const part of selector.split(',')) {
    const [a, b] = part.split('-');
    const from = DAYS.indexOf(a);
    const to = b ? DAYS.indexOf(b) : from;
    if (from < 0 || to < 0) return null;
    // Wraps past Sunday, e.g. "Fr-Mo".
    for (let i = from; ; i = (i + 1) % 7) {
      out.add(i);
      if (i === to) break;
    }
  }
  return [...out];
}

function parseTimes(text: string): Interval[] | null {
  const out: Interval[] = [];
  for (const span of text.split(',')) {
    const m = TIME_RE.exec(span);
    if (!m) return null;
    const start = Number(m[1]) * 60 + Number(m[2]);
    let end = Number(m[3]) * 60 + Number(m[4]);
    if (start > 1440 || end > 1440 + 12 * 60 || Number(m[2]) > 59 || Number(m[4]) > 59) return null;
    if (end <= start) end += 1440; // runs past midnight
    out.push([start, end]);
  }
  return out;
}

/** Parse a common opening_hours string into a weekly schedule, or null if it's too fancy. */
export function parseOpeningHours(raw: string | null | undefined): WeekSchedule | null {
  if (!raw || !raw.trim()) return null;
  const week: WeekSchedule = [[], [], [], [], [], [], []];
  let understood = false;
  for (const piece of normalize(raw).split(';')) {
    const rule = piece.trim();
    if (!rule) continue;
    if (/^(PH|SH)\b/.test(rule)) continue; // public/school holidays: not modelled
    if (rule === '24/7') {
      for (let d = 0; d < 7; d++) week[d] = [[0, 1440]];
      understood = true;
      continue;
    }
    let days = [0, 1, 2, 3, 4, 5, 6];
    let rest = rule;
    const sel = SELECTOR_RE.exec(rule);
    if (sel) {
      const expanded = expandDays(sel[1]);
      if (!expanded) return null;
      days = expanded;
      rest = rule.slice(sel[0].length).trim();
    }
    let intervals: Interval[];
    if (rest === 'off' || rest === 'closed') intervals = [];
    else if (rest === '24/7' || rest === '00:00-24:00') intervals = [[0, 1440]];
    else {
      const t = parseTimes(rest);
      if (!t) return null;
      intervals = t;
    }
    // A later rule replaces earlier ones for the same days (OSM semantics).
    for (const d of days) week[d] = intervals.map((i) => [i[0], i[1]] as Interval);
    understood = true;
  }
  return understood ? week : null;
}

/** "11 am", "10:30 pm", "noon", "midnight". */
export function formatClock(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  if (m === 0) return 'midnight';
  if (m === 720) return 'noon';
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${h24 < 12 ? 'am' : 'pm'}`;
}

export interface OpenStatus {
  open: boolean;
  /** "Open now · closes 10 pm", "Closed · opens 11 am", "Open 24 hours", "Closed today". */
  text: string;
}

/** Whether a place is open at `now` (phone's local time), in plain words. Null when the hours can't be read. */
export function openStatus(raw: string | null | undefined, now: Date = new Date()): OpenStatus | null {
  const week = parseOpeningHours(raw);
  if (!week) return null;
  const allDay = week.every((d) => d.some(([s, e]) => s === 0 && e >= 1440));
  if (allDay) return { open: true, text: 'Open 24 hours' };

  const today = (now.getDay() + 6) % 7;
  const t = now.getHours() * 60 + now.getMinutes();
  // Absolute minutes from the start of today; yesterday's late hours are negative offsets.
  const spans: Interval[] = [];
  for (let k = -1; k <= 7; k++) {
    const d = (((today + k) % 7) + 7) % 7;
    for (const [s, e] of week[d]) spans.push([s + k * 1440, e + k * 1440]);
  }
  spans.sort((a, b) => a[0] - b[0]);

  const current = spans.find(([s, e]) => s <= t && t < e);
  if (current) {
    // Follow back-to-back spans (e.g. "Fr 18:00-24:00; Sa 00:00-02:00").
    let close = current[1];
    for (const [s, e] of spans) if (s <= close && e > close) close = e;
    return { open: true, text: `Open now · closes ${formatClock(close)}` };
  }
  const next = spans.find(([s]) => s > t);
  if (!next) return { open: false, text: 'Closed' };
  const dayOffset = Math.floor(next[0] / 1440);
  const when =
    dayOffset === 0 ? '' : dayOffset === 1 ? 'tomorrow ' : `${DAY_NAMES[(today + dayOffset) % 7]} `;
  return { open: false, text: `Closed · opens ${when}${formatClock(next[0])}` };
}
