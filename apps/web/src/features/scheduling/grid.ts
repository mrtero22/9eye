// What each cell of the week grid shows (scheduling-page.md "Week grid cells").

import { WEEKDAYS, isRepeat, weekdayOf, type AiringDraft, type OrderDraft } from '@9eye/core';
import type { CompactTemplate, WeekAiring } from '@/lib/types';
import type { ScheduleCell, ScheduleColumn } from '@/ui';
import { airingTitle, cellOf, dayBlocks, isProgrammeMode, programmeOf, shortDay, weekDates, type ItemsById, type TimeCtx } from './model';

export interface ShowInWeek {
  others: boolean;
  breaks: boolean;
  names: boolean;
}

export type GridMode = 'order' | 'all' | 'empty' | 'confirmed';

export interface GridInput {
  mode: GridMode;
  ws: string;
  template: CompactTemplate | null;
  t: TimeCtx;
  channelId: string;
  /** The open order (Screen 2). */
  orderId: string | null;
  draft: OrderDraft | null;
  items: ItemsById | null;
  /** Other orders' airings of the week. */
  others: WeekAiring[];
  show: ShowInWeek;
  sel: { date: string; blockTypeId: string } | null;
  /** Quick placement is on: this order's first airings get a button to add their repeats. */
  quick?: { repeatOf: string | null } | null;
}

export const cellId = (date: string, blockTypeId: string) => `${date}|${blockTypeId}`;
export const parseCellId = (id: string) => {
  const [date, blockTypeId] = id.split('|');
  return { date, blockTypeId };
};

const titleOf = (w: WeekAiring) => (w.titles.length ? `${w.titles[0]}${w.titles.length > 1 && w.kind === 'first' ? ` + ${w.titles.length - 1} more` : ''}` : `${w.passes} plays`);

export function buildColumns(g: GridInput): ScheduleColumn[] {
  if (!g.template) return [];
  const d = g.draft;
  const byId = new Map((d?.airings ?? []).map((a) => [a.id, a]));
  const mine = (date: string, bt: string) => (d ? cellOf(d, g.channelId, date, bt) : undefined);
  const inside = (date: string) => !d || (date >= d.startDate && date <= d.endDate);
  const programme = d ? isProgrammeMode(d.mode) : true;
  const repeatAction = (a: AiringDraft) =>
    g.quick && g.items && !isRepeat(a) ? { icon: 'copy' as const, label: `Add repeats of ${airingTitle(a, byId, g.items)}`, pressed: g.quick.repeatOf === a.id } : undefined;
  return weekDates(g.ws).map((date) => {
    const blocks = dayBlocks(g.template!, date);
    let firsts = 0;
    let repeats = 0;
    let free = 0;
    let passes = 0;
    const cells: ScheduleCell[] = blocks.map((b) => {
      const here = g.others.filter((w) => w.date === date && w.blockTypeId === b.blockTypeId);
      const other = programmeOf(here);
      const my = mine(date, b.blockTypeId);
      const name = b.name;
      const sub = g.show.names ? name : undefined;
      const range = `${g.t.clock(b.startFrames)}`;
      const selected = !!g.sel && g.sel.date === date && g.sel.blockTypeId === b.blockTypeId;
      const base = { id: cellId(date, b.blockTypeId), start: b.startFrames, length: b.lengthFrames, breaks: g.show.breaks ? b.breakCount : undefined, selected };
      const aria = (who: string) => `${shortDay(date)} ${range} · ${name} · ${who}`;
      if (g.mode === 'empty') {
        return { ...base, look: 'template', title: name, ariaLabel: aria('layout block') };
      }
      if (g.mode === 'all' || g.mode === 'confirmed') {
        // every programme order's airing, this order's from the open draft
        const own = g.mode === 'all' && my && programme ? my : undefined;
        const prog = own ? null : g.mode === 'confirmed' ? here.find((w) => isProgrammeMode(w.mode) && w.status === 'confirmed') : other;
        if (own && d && g.items) {
          const rep = isRepeat(own);
          return {
            ...base, look: rep ? 'repeatAll' : 'firstAll', color: own.blockColor ?? d.color, title: airingTitle(own, byId, g.items),
            sub: sub ?? (rep ? 'Repeat' : 'First airing'), ariaLabel: aria(`${d.name}, ${rep ? 'repeat' : 'first airing'}`), action: repeatAction(own),
          };
        }
        if (prog) {
          return {
            ...base, look: prog.kind === 'repeat' ? 'repeatAll' : 'firstAll', color: prog.blockColor ?? prog.orderColor, title: titleOf(prog),
            sub: sub ?? (prog.kind === 'repeat' ? 'Repeat' : 'First airing'), ariaLabel: aria(`${prog.orderName}, ${titleOf(prog)}, ${prog.kind === 'repeat' ? 'repeat' : 'first airing'}`),
          };
        }
        free++;
        return { ...base, look: 'missing', title: g.mode === 'confirmed' ? 'Free' : 'No programme', sub, ariaLabel: aria('no programme') };
      }
      // this order
      if (!d || !g.items) return { ...base, look: 'template', title: name, ariaLabel: aria('layout block') };
      if (!inside(date)) {
        return { ...base, look: 'outside', title: g.show.others && other ? titleOf(other) : '', titleTone: 'muted', sub, ariaLabel: aria('outside the plan') };
      }
      if (programme) {
        if (my) {
          const rep = isRepeat(my);
          if (rep) repeats++;
          else firsts++;
          return {
            ...base, look: rep ? 'repeat' : 'first', color: my.blockColor ?? d.color, title: airingTitle(my, byId, g.items),
            sub: sub ?? (rep ? 'Repeat' : 'First airing'), ariaLabel: aria(`${d.name}, ${airingTitle(my, byId, g.items)}, ${rep ? 'repeat' : 'first airing'}`), action: repeatAction(my),
          };
        }
        if (other) return { ...base, look: 'other', title: g.show.others ? titleOf(other) : '', sub, ariaLabel: aria(`${other.orderName}, ${titleOf(other)}`) };
        return { ...base, look: 'missing', title: 'No programme', sub, ariaLabel: aria('no programme') };
      }
      const n = my?.passes ?? 0;
      passes += n;
      return {
        ...base, look: 'passes', color: my?.blockColor ?? d.color, chip: n ? `${n}×` : undefined,
        title: g.show.others && other ? titleOf(other) : other ? '' : 'No programme', titleTone: other ? 'muted' : 'amber', sub,
        ariaLabel: aria(`${n} plays${other ? `, ${other.orderName} ${titleOf(other)}` : ', no programme'}`),
      };
    });
    let note = '';
    let noteTone: 'muted' | 'amber' = 'muted';
    if (g.mode === 'empty') note = `${blocks.length} blocks`;
    else if (g.mode === 'all' || g.mode === 'confirmed') {
      note = free ? `${free} without a programme` : 'All blocks filled';
      noteTone = free ? 'amber' : 'muted';
    } else if (!inside(date)) note = 'Outside the plan';
    else if (programme) note = firsts || repeats ? [firsts ? `${firsts} first` : '', repeats ? `${repeats} repeat${repeats > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ') : 'Nothing';
    else note = passes ? 'Placed' : 'Nothing';
    const [, m, day] = date.split('-').map(Number);
    return { key: date, day: WEEKDAYS[weekdayOf(date)].short, date: `${day} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}`, note, noteTone, cells };
  });
}

/** Airings of this order in the shown week (table view). */
export function weekAirings(d: OrderDraft, channelId: string, ws: string, we: string): AiringDraft[] {
  return d.airings.filter((a) => a.channelId === channelId && a.date >= ws && a.date <= we);
}
