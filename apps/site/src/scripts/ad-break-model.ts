// The free ad break calculator (/tools/ad-break-calculator). Pure functions, used twice: at build time
// for the first values on the page, then in the browser, where ad-break-tool.ts runs them as the
// visitor types. Everything is counted in whole seconds. No imports, so Node can run it in checks.

const two = (n: number) => String(n).padStart(2, '0');

/** Seconds as M:SS, or H:MM:SS from one hour up. */
export function dur(total: number): string {
  const s = Math.round(Math.abs(total));
  const h = Math.floor(s / 3600);
  const body = h ? `${h}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}` : `${Math.floor(s / 60)}:${two(s % 60)}`;
  return total < 0 ? `−${body}` : body;
}

/** Seconds as a clock time HH:MM:SS (wraps at midnight). */
export function clock(total: number): string {
  const s = ((Math.round(total) % 86400) + 86400) % 86400;
  return `${two(Math.floor(s / 3600))}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;
}

/** Reads M:SS, H:MM:SS or a plain number of seconds. */
export function readDuration(text: string): { seconds: number } | { error: string } {
  const t = text.trim();
  if (/^\d+(\.\d+)?$/.test(t)) return { seconds: Math.round(Number(t)) };
  const m = t.match(/^(?:(\d+):)?(\d{1,3}):(\d{1,2})$/);
  if (!m || Number(m[3]) > 59 || (m[1] !== undefined && Number(m[2]) > 59)) {
    return { error: 'Type the length as minutes and seconds, for example 3:00 or 2:30.' };
  }
  return { seconds: Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) };
}

/** Reads a clock time HH:MM or HH:MM:SS. */
export function readClock(text: string): number | undefined {
  const m = text.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59 || Number(m[3] ?? 0) > 59) return undefined;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0);
}

const group = (n: number) => Math.round(n).toLocaleString('en-US');

// ---------------------------------------------------------------------------------------------
// 1 · Ad inventory

export interface InventoryIn { minutesPerHour: number; hoursPerDay: number; daysPerWeek: number; spotSeconds: number; sellOut: number; price: number }
export interface InventoryRow { period: string; adTime: string; spots: string; sold: string; revenue: string }

export function inventory(i: InventoryIn): { rows: InventoryRow[] } | { error: string } {
  if (!(i.minutesPerHour > 0 && i.minutesPerHour <= 60)) return { error: 'Ad minutes per hour go from more than 0 to 60.' };
  if (!(i.hoursPerDay > 0 && i.hoursPerDay <= 24)) return { error: 'Hours on air per day go from more than 0 to 24.' };
  if (!(i.daysPerWeek >= 1 && i.daysPerWeek <= 7)) return { error: 'Days per week go from 1 to 7.' };
  if (!(i.spotSeconds > 0)) return { error: 'The spot length must be more than 0 seconds.' };
  if (!(i.sellOut >= 0 && i.sellOut <= 100)) return { error: 'Sell-out goes from 0 to 100 %.' };
  const hour = i.minutesPerHour * 60;
  const periods: [string, number][] = [
    ['Hour', hour],
    ['Day', hour * i.hoursPerDay],
    ['Week', hour * i.hoursPerDay * i.daysPerWeek],
    ['Month (4.35 weeks)', hour * i.hoursPerDay * i.daysPerWeek * (365 / 12 / 7)],
    ['Year (52 weeks)', hour * i.hoursPerDay * i.daysPerWeek * 52],
  ];
  return {
    rows: periods.map(([period, seconds]) => {
      const spots = seconds / i.spotSeconds;
      const sold = spots * (i.sellOut / 100);
      return { period, adTime: dur(seconds), spots: group(Math.floor(spots)), sold: group(Math.floor(sold)), revenue: i.price > 0 ? group(Math.floor(sold) * i.price) : '–' };
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// 2 · One slot: how long the programme can be, and where the breaks go

export interface SlotIn { start: number; slotMinutes: number; adMinutes: number; promoMinutes: number; breaks: number; breakAtEnd: boolean }
export interface Segment { kind: 'part' | 'break'; label: string; start: string; length: string; seconds: number }

/** Splits a whole number of seconds into n parts that differ by at most one second, larger first. */
function split(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => base + (i < total - base * n ? 1 : 0));
}

export function slot(i: SlotIn): { programme: string; breakLength: string; share: string; segments: Segment[] } | { error: string } {
  const length = Math.round(i.slotMinutes * 60);
  const ads = Math.round(i.adMinutes * 60);
  const promos = Math.round(i.promoMinutes * 60);
  if (!(length > 0 && length <= 86400)) return { error: 'The slot length goes from more than 0 to 1,440 minutes.' };
  if (!(ads >= 0 && promos >= 0)) return { error: 'Ad and promo minutes cannot be negative.' };
  if (!(Number.isInteger(i.breaks) && i.breaks >= 1 && i.breaks <= 20)) return { error: 'Breaks go from 1 to 20.' };
  const programme = length - ads - promos;
  if (programme <= 0) return { error: `Ads and promos (${dur(ads + promos)}) fill the whole slot (${dur(length)}): nothing is left for the programme.` };
  const breaks = split(ads + promos, i.breaks);
  const parts = split(programme, i.breakAtEnd ? i.breaks : i.breaks + 1);
  const segments: Segment[] = [];
  let at = i.start;
  parts.forEach((p, k) => {
    segments.push({ kind: 'part', label: `Part ${k + 1}`, start: clock(at), length: dur(p), seconds: p });
    at += p;
    if (k < breaks.length) {
      segments.push({ kind: 'break', label: `Break ${k + 1}`, start: clock(at), length: dur(breaks[k]), seconds: breaks[k] });
      at += breaks[k];
    }
  });
  const same = breaks.every((b) => b === breaks[0]);
  return {
    programme: dur(programme),
    breakLength: same ? dur(breaks[0]) : `${dur(breaks[breaks.length - 1])}–${dur(breaks[0])}`,
    share: `${((ads / length) * 100).toFixed(1)} %`,
    segments,
  };
}

// ---------------------------------------------------------------------------------------------
// 3 · Fill a break with spots

export const SPOT_LENGTHS = [10, 15, 20, 30, 45, 60];

/** The fewest standard-length spots that add up to exactly `seconds`, longest first; undefined if none. */
export function fewestSpots(seconds: number, lengths = SPOT_LENGTHS): number[] | undefined {
  if (seconds <= 0) return [];
  const best: (number[] | undefined)[] = [[]];
  for (let s = 1; s <= seconds; s++) {
    for (const l of lengths) {
      const prev = s - l >= 0 ? best[s - l] : undefined;
      if (prev && (!best[s] || prev.length + 1 < best[s]!.length)) best[s] = [...prev, l];
    }
  }
  return best[seconds]?.sort((a, b) => b - a);
}

const spotList = (spots: number[]) =>
  [...new Set(spots)].map((l) => `${spots.filter((x) => x === l).length} × ${l} s`).join(' + ');

export function fill(breakSeconds: number, counts: Record<number, number>) {
  const spots = SPOT_LENGTHS.flatMap((l) => Array<number>(Math.max(0, Math.floor(counts[l] ?? 0))).fill(l));
  const used = spots.reduce((a, b) => a + b, 0);
  const left = breakSeconds - used;
  const rest = left > 0 && left <= 3600 ? fewestSpots(left) : undefined;
  return {
    used: dur(used),
    count: spots.length,
    status: left === 0 ? 'The break is exactly full.' : left > 0 ? `${dur(left)} left in the break.` : `Over by ${dur(-left)}: take out spots or make the break longer.`,
    over: left < 0,
    full: left === 0,
    suggestion: left > 0 ? (rest ? `To fill it: ${spotList(rest)}.` : `No mix of 10, 15, 20, 30, 45 and 60 s spots makes exactly ${dur(left)}.`) : '',
    capacity: SPOT_LENGTHS.map((l) => `${Math.floor(breakSeconds / l)} × ${l} s`).join(' · '),
  };
}

// ---------------------------------------------------------------------------------------------
// The results as HTML (the same at build time and in the browser)

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const error = (text: string) => `<p class="notice notice--red" role="alert">${esc(text)}</p>`;

export function inventoryHtml(r: ReturnType<typeof inventory>): string {
  if ('error' in r) return error(r.error);
  return `<div class="sheet-box"><div class="scroll-x"><table class="sheet">
    <thead><tr><th scope="col">Period</th><th scope="col">Ad time</th><th scope="col">Spots</th><th scope="col">Sold</th><th scope="col">Revenue</th></tr></thead>
    <tbody>${r.rows.map((x) => `<tr><td>${esc(x.period)}</td><td class="mono">${x.adTime}</td><td class="mono">${x.spots}</td><td class="mono">${x.sold}</td><td class="mono">${x.revenue}</td></tr>`).join('')}</tbody>
  </table></div></div>`;
}

export function slotHtml(r: ReturnType<typeof slot>): string {
  if ('error' in r) return error(r.error);
  return `<div class="sheet-box">
    <dl class="sheet-sum">
      <div><dt>Programme length</dt><dd class="mono">${r.programme}</dd></div>
      <div><dt>Each break</dt><dd class="mono">${r.breakLength}</dd></div>
      <div><dt>Ads in the slot</dt><dd class="mono">${r.share}</dd></div>
    </dl>
    <div style="padding: 16px 20px 4px"><div class="tbar" aria-hidden="true">${r.segments.map((s) => `<span class="is-${s.kind}" style="flex: ${s.seconds} 1 0" title="${esc(s.label)} ${s.length}">${s.kind === 'part' ? esc(s.label) : ''}</span>`).join('')}</div></div>
    <div class="scroll-x"><table class="sheet">
      <thead><tr><th scope="col">Segment</th><th scope="col">Starts</th><th scope="col">Length</th></tr></thead>
      <tbody>${r.segments.map((s) => `<tr${s.kind === 'break' ? ' class="is-break"' : ''}><td>${esc(s.label)}</td><td class="mono">${s.start}</td><td class="mono">${s.length}</td></tr>`).join('')}</tbody>
    </table></div>
  </div>`;
}

export function fillHtml(r: ReturnType<typeof fill> | { error: string }): string {
  if ('error' in r) return error(r.error);
  return `<div class="stack" style="--gap: 8px">
    <span class="meta">Spots in the break</span>
    <output class="mono" style="font-size: 28px; font-weight: 500">${r.count} spot${r.count === 1 ? '' : 's'} · ${r.used}</output>
    <p class="notice ${r.over ? 'notice--red' : r.full ? 'notice--green' : 'notice--amber'}" style="margin: 4px 0 0">${esc(r.status)}${r.suggestion ? ` ${esc(r.suggestion)}` : ''}</p>
    <p class="meta" style="margin: 0">A break this long holds ${esc(r.capacity)}.</p>
  </div>`;
}
