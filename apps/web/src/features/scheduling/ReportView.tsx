// The order's report: totals per item and per week — airings,
// repeats or passes, lengths. It replaces the placement area; Back returns to the calendar.

import { addDays, formatLength, isRepeat, orderWeeks } from '@9eye/core';
import { Button, DataTable, SectionHead, spanText } from '@/ui';
import type { OrderCtx } from './ctx';
import { isProgrammeMode } from './model';

export function ReportView({ ctx, onBack }: { ctx: OrderCtx; onBack: () => void }) {
  const { draft: d, items, t } = ctx;
  const programme = isProgrammeMode(d.mode);
  const mine = d.airings;
  const firsts = mine.filter((a) => !isRepeat(a));
  const byFirst = new Map<string, number>();
  for (const a of mine) if (a.repeatOfId) byFirst.set(a.repeatOfId, (byFirst.get(a.repeatOfId) ?? 0) + 1);
  const len = (frames: number | null) => (frames ? formatLength(frames, t.rate) : '—');
  const perItem = d.items.map((it) => {
    const its = firsts.filter((a) => a.items.some((x) => x.itemId === it.id));
    const reps = its.reduce((s, a) => s + (byFirst.get(a.id) ?? 0), 0);
    const passes = its.reduce((s, a) => s + (programme ? 1 : a.passes), 0);
    const total = it.lengthFrames ? it.lengthFrames * (programme ? its.length + reps : passes) : null;
    return { it, n: its.length, reps, passes, total };
  });
  const weeks = orderWeeks(d.startDate, d.endDate, ctx.channel.weekStart).map((w) => {
    const we = addDays(w, 6);
    const inWeek = mine.filter((a) => a.date >= w && a.date <= we);
    return { w, we, firsts: inWeek.filter((a) => !isRepeat(a)).length, repeats: inWeek.filter(isRepeat).length, passes: inWeek.reduce((s, a) => s + (isRepeat(a) ? 0 : a.passes), 0) };
  });
  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  const knownTotal = sum(perItem.map((r) => r.total ?? 0));
  const unknown = perItem.filter((r) => !r.it.lengthFrames && (r.n || r.passes)).length;
  return (
    <div className="flex flex-col gap-4">
      <SectionHead title="Report" description={`${d.name} · ${programme ? `${sum(perItem.map((r) => r.n))} first airings and ${sum(perItem.map((r) => r.reps))} repeats` : `${sum(perItem.map((r) => r.passes))} plays`} · ${len(knownTotal)} known${unknown ? ` · ${unknown} items without a length` : ''}`}>
        <Button size="sm" onClick={() => window.print()}>
          Print
        </Button>
        <Button size="sm" icon="chevronLeft" onClick={onBack}>
          Back to the week
        </Button>
      </SectionHead>
      <DataTable
        label="Per item"
        minWidth={640}
        rowHeight="min-h-[var(--row)]"
        columns={[
          { label: programme ? 'Episode / item' : 'Item', width: 'minmax(220px, 2fr)' },
          { label: programme ? 'First airings' : 'Blocks', width: '110px' },
          { label: programme ? 'Repeats' : 'Plays', width: '90px' },
          { label: 'Length', width: '110px' },
          { label: 'Total', width: '120px' },
        ]}
        groups={[
          {
            key: 'items',
            label: 'Per item',
            count: d.items.length,
            rows: perItem.map((r) => ({
              key: r.it.id,
              cells: [
                <span key="a" className="block truncate">{items.get(r.it.id)?.info?.title ?? 'Item'}</span>,
                <span key="b" className="mono">{r.n}</span>,
                <span key="c" className="mono">{programme ? r.reps : r.passes}</span>,
                <span key="d" className="mono text-text-2">{len(r.it.lengthFrames)}</span>,
                <span key="e" className="mono">{len(r.total)}</span>,
              ],
            })),
          },
        ]}
      />
      <DataTable
        label="Per week"
        minWidth={640}
        rowHeight="min-h-[var(--row)]"
        columns={[
          { label: 'Week', width: 'minmax(220px, 2fr)' },
          { label: programme ? 'First airings' : 'Blocks', width: '110px' },
          { label: programme ? 'Repeats' : 'Plays', width: '90px' },
          { label: '', width: '230px' },
        ]}
        groups={[
          {
            key: 'weeks',
            label: 'Per week',
            count: weeks.length,
            rows: weeks.map((w) => ({
              key: w.w,
              cells: [
                <span key="a">{spanText(w.w, w.we)}</span>,
                <span key="b" className="mono">{w.firsts}</span>,
                <span key="c" className="mono">{programme ? w.repeats : w.passes}</span>,
                <span key="d" />,
              ],
            })),
          },
        ]}
      />
    </div>
  );
}
