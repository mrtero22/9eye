// Left sidebar of an order (scheduling-page.md "Order details"): its issue with one action, status,
// dates, template, series options, limits, the item list with its progress, and this week's pattern
// (series) or passes and rotation (promos).

import { useEffect, useMemo, useState } from 'react';
import { formatDate, isRepeat, rotate, uuidv7, weekdayOf } from '@9eye/core';
import type { OrderIssue } from '@/lib/types';
import {
  Button,
  CatalogPicker,
  CommitField,
  IconButton,
  Notice,
  Popover,
  PopoverFooter,
  PopoverTitle,
  ProgressBar,
  RowList,
  Segmented,
  StartEndPicker,
  SwitchRow,
  cx,
  formatDateRange,
  useToast,
  type CatalogPick,
} from '@/ui';
import type { OrderCtx } from './ctx';
import { removeItem } from './edits';
import { daysText, familiesFor, seriesPattern, shortDay } from './model';

export function limitsTextOf(d: { maxAirings: number | null; timeWindows: { allowed: unknown[]; rejected: unknown[] } }): string {
  const n = d.timeWindows.allowed.length + d.timeWindows.rejected.length;
  return `${d.maxAirings ? `At most ${d.maxAirings} airings` : 'No airing limit'} · ${n ? `${n} time window${n === 1 ? '' : 's'}` : 'no time windows'}`;
}

function Divider() {
  return <div className="h-px bg-hairline" />;
}

export function OrderDetails({
  ctx,
  onFix,
  onLimits,
  onAllFields,
  onReport,
  rotationOpen,
  onRotationOpen,
  showItems,
}: {
  ctx: OrderCtx;
  onFix: (f: NonNullable<OrderIssue['fix']>) => void;
  onLimits: () => void;
  onAllFields: () => void;
  onReport: () => void;
  rotationOpen: boolean;
  onRotationOpen: (o: boolean) => void;
  /** Changes when an issue asks to show the whole list. */
  showItems: number;
}) {
  const { draft: d, full, apply, channel, t, items, ws, we } = ctx;
  const toast = useToast();
  const series = d.mode === 'series';
  const programme = series || d.mode === 'programmes';
  const [all, setAll] = useState(false);
  useEffect(() => {
    if (showItems) setAll(true);
  }, [showItems]);
  const issue = full.issue && !(full.issue.fix?.action === 'confirm' && d.status === 'confirmed') ? full.issue : null;

  // ---------------------------------------------------------------- items and their state
  const mine = d.airings.filter((a) => a.channelId === ctx.channelId);
  const firstDates = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const a of mine) if (!isRepeat(a)) for (const x of a.items) m.set(x.itemId, [...(m.get(x.itemId) ?? []), a.date]);
    return m;
  }, [mine]);
  const saved = new Set(full.items.map((i) => i.id));
  const stateOf = (id: string) => {
    if (!saved.has(id)) return 'Added';
    const ds = firstDates.get(id) ?? [];
    if (ds.some((x) => x >= ws && x <= we)) return 'This week';
    if (ds.some((x) => x < ws)) return 'Aired';
    if (ds.some((x) => x > we)) return 'Later';
    return 'Not placed';
  };
  const states = d.items.map((i) => stateOf(i.id));
  const count = (s: string) => states.filter((x) => x === s).length;
  const n = d.items.length;
  const aired = count('Aired');
  const thisWeek = count('This week');
  const firstWeekIndex = states.findIndex((s) => s === 'This week' || s === 'Later' || s === 'Not placed');
  const lo = series ? Math.max(0, (firstWeekIndex < 0 ? n : firstWeekIndex) - 1) : 0;
  const rows = all ? d.items.map((it, i) => ({ it, i })) : d.items.slice(lo, lo + 8).map((it, i) => ({ it, i: lo + i }));
  const addItems = (r: CatalogPick) => {
    const have = new Set(d.items.map((i) => i.productionId));
    const fresh = r.items.filter((x) => !have.has(x.productionId));
    if (!fresh.length) return;
    ctx.addInfo(new Map(fresh.map((x) => [x.productionId, { title: x.title, chapter: x.chapter, code: x.houseId, contentId: x.contentId, contentTitle: x.content, catalogLengthFrames: x.lengthFrames }])));
    apply({ ...d, items: [...d.items, ...fresh.map((x) => ({ id: uuidv7(), productionId: x.productionId, lengthFrames: x.lengthFrames }))] });
    toast(`${fresh.length} ${fresh.length === 1 ? 'item' : 'items'} added to the list`);
  };
  const firstItem = d.items.find((i) => i.id === d.firstItemId) ?? d.items[0];
  const firstNumber = (id: string | undefined) => {
    const x = id ? items.get(id) : undefined;
    return x ? (x.info?.chapter ?? x.position + 1) : 1;
  };
  const lastFirst = [...mine].filter((a) => !isRepeat(a)).sort((a, b) => (a.date < b.date ? 1 : -1))[0];

  // ---------------------------------------------------------------- promos: passes
  const weekRows = mine.filter((a) => !isRepeat(a) && a.date >= ws && a.date <= we);
  const blocksADay = Math.max(0, ...ctx.days.map((x) => x.size));
  const passes = weekRows.map((a) => a.passes);
  const lowP = passes.length ? Math.min(...passes) : 0;
  const highP = passes.length ? Math.max(...passes) : 0;
  const passDays = [...new Set(weekRows.map((a) => a.date))];
  const totalWeek = passes.reduce((s, x) => s + x, 0);

  return (
    <>
      {issue && (
        <Notice tone="amber">
          <span>{issue.text}</span>
          {issue.fix && (
            <Button size="sm" className="self-start" onClick={() => onFix(issue.fix!)}>
              {issue.fix.label}
            </Button>
          )}
        </Notice>
      )}
      <div className="flex flex-col gap-3.5">
        <div className="flex items-center justify-between gap-3 text-small">
          <span className="text-text-2">Status</span>
          <Segmented
            label="Status"
            size="sm"
            value={d.status}
            onChange={(v) => apply({ ...d, status: v })}
            options={[
              { value: 'confirmed', label: 'Confirmed', hint: 'Placed in the playlist' },
              { value: 'draft', label: 'Draft', hint: 'Left out of the playlist' },
            ]}
          />
        </div>
        <StartEndPicker
          label="Dates"
          weekStart={channel.weekStart}
          today={channel.today}
          start={d.startDate}
          end={d.endDate}
          onChange={(v) => apply({ ...d, startDate: v.start, endDate: v.end })}
          help={ctx.template.validFrom <= d.startDate && ctx.template.validTo >= d.endDate ? 'The layout is valid for all of these dates.' : `The layout is valid ${formatDateRange(ctx.template.validFrom, ctx.template.validTo)}.`}
        />
        <div className="flex flex-col gap-0.5 text-small">
          <span className="text-text-2">Template</span>
          <span>{ctx.template.name}</span>
        </div>
        {series && (
          <>
            <label className="flex items-center justify-between gap-3 text-small text-text-2">
              First episode to place
              <CommitField
                ariaLabel="First episode to place"
                width={64}
                value={firstNumber(firstItem?.id)}
                format={(v) => String(v)}
                parse={(s) => (/^\d+$/.test(s.trim()) ? Number(s) : null)}
                onCommit={(v) => {
                  const it = d.items.find((i) => (items.get(i.id)?.info?.chapter ?? -1) === v) ?? d.items[v - 1];
                  if (!it) return `There is no episode ${v} in the list.`;
                  apply({ ...d, firstItemId: it.id === d.items[0]?.id ? null : it.id });
                }}
              />
            </label>
            <SwitchRow title="Start again when episodes run out" description="Episode 1 follows the last one" checked={d.reuseInLoop} onChange={(v) => apply({ ...d, reuseInLoop: v })} />
          </>
        )}
        <div className="flex items-center justify-between gap-3 text-small">
          <span className="flex flex-col">
            <span className="text-text-2">Limits</span>
            <span className="text-meta text-text-3">{limitsTextOf(ctx.draft)}</span>
          </span>
          <Button size="xs" onClick={onLimits}>
            Edit
          </Button>
        </div>
      </div>

      <Divider />
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-medium">
            {series ? 'Episodes' : 'Items'} <span className="mono font-normal text-text-3">{n}</span>
          </span>
          <CatalogPicker
            pick="items"
            families={familiesFor(d.mode)}
            frameRate={channel.frameRate}
            startContent={full.items[0]?.contentId ?? null}
            already={d.items.map((i) => i.productionId)}
            title={series ? 'Add episodes' : 'Add items'}
            context={`To ${d.name} · ${series ? 'new episodes join the end of the list' : 'they join the rotation'}`}
            trigger="Add from Media"
            triggerStyle="small"
            onPick={addItems}
          />
        </div>
        {series && (
          <>
            <ProgressBar width="100%" done={n ? (aired / n) * 100 : 0} now={n ? (thisWeek / n) * 100 : 0} color={d.color} />
            <span className="text-meta text-text-3">
              {[`${aired} aired`, `${thisWeek} this week`, `${count('Later')} later`, count('Not placed') ? `${count('Not placed')} not placed` : '', count('Added') ? `${count('Added')} added` : ''].filter(Boolean).join(' · ')}
            </span>
          </>
        )}
        {n ? (
          <RowList
            footer={
              n > 8 || all ? (
                <button type="button" onClick={() => setAll(!all)} className="hov -mx-2.5 h-[30px] w-[calc(100%+20px)] cursor-pointer border-0 bg-transparent text-meta text-text-2">
                  {all ? 'Show fewer' : `Show all ${n}`}
                </button>
              ) : undefined
            }
          >
            {rows.map(({ it, i }) => {
              const x = items.get(it.id);
              const st = programme ? states[i] : saved.has(it.id) ? '' : 'Added';
              return (
                <div key={it.id} className="flex min-h-[30px] items-center gap-2 px-2.5 text-small">
                  <span className="mono w-[26px] text-tiny text-text-3">{x?.info?.chapter ?? i + 1}</span>
                  <span className={cx('min-w-0 flex-1 truncate', st === 'Aired' ? 'text-text-3' : 'text-text')}>{x?.info?.title ?? 'Unknown item'}</span>
                  <span className={cx('text-[11.5px]', st === 'This week' ? 'text-accent-text' : st === 'Not placed' ? 'text-amber-text' : st === 'Added' ? 'text-green-text' : 'text-text-3')}>{st}</span>
                  {all && !firstDates.has(it.id) && !mine.some((a) => a.items.some((y) => y.itemId === it.id)) && (
                    <IconButton icon="close" size="xs" tone="quiet" label={`Remove ${x?.info?.title ?? 'item'}`} onClick={() => apply(removeItem(d, it.id))} />
                  )}
                </div>
              );
            })}
          </RowList>
        ) : (
          <span className="text-small text-text-3">No items yet. Add them from Media.</span>
        )}
      </div>

      <Divider />
      <div className="relative flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="flex flex-col">
            <span className="font-medium">{programme ? "This week's pattern" : 'Plays'}</span>
            <span className="text-meta text-text-3">{programme ? 'Read from the week; copy the week to repeat it' : 'Placed into the playlist by "Auto-place trailers"'}</span>
          </span>
          {!programme && <RotationPopover ctx={ctx} open={rotationOpen} onOpenChange={onRotationOpen} />}
        </div>
        <RowList>
          {(programme
            ? seriesPattern(mine, ctx.byId, t, ws, ctx.days)
            : passes.length
              ? [
                  { what: 'Each block', text: lowP === highP ? `${lowP} plays${weekRows.length >= blocksADay * passDays.length ? ` in all ${blocksADay} blocks` : ''}` : `${lowP}–${highP} plays` },
                  { what: 'Days', text: `${passDays.length === 7 ? 'Every day' : daysText(passDays, channel.weekStart)}${d.endDate >= ws && d.endDate <= we ? ` until ${shortDay(d.endDate)}` : ''}` },
                  { what: 'This week', text: `${totalWeek} plays${passDays.length < 7 ? ` on ${passDays.length} day${passDays.length === 1 ? '' : 's'}` : ''}` },
                ]
              : [{ what: 'This week', text: 'No plays in this week' }]
          ).map((r, i) => (
            <div key={i} className="flex gap-2.5 px-2.5 py-[7px] text-small">
              <span className="w-[88px] shrink-0 text-text-3">{r.what}</span>
              <span className="min-w-0 flex-1">{r.text}</span>
            </div>
          ))}
        </RowList>
        {series && lastFirst && (
          <span className="text-meta text-text-3">
            Last first airing {shortDay(lastFirst.date)} · the plan ends {formatDate(d.endDate)}.
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={onAllFields}>All fields</Button>
        <Button onClick={onReport}>Report</Button>
      </div>
    </>
  );
}

function RotationPopover({ ctx, open, onOpenChange }: { ctx: OrderCtx; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { draft: d, items } = ctx;
  const toast = useToast();
  const list = d.items.slice(0, 100);
  const equal = () => {
    const base = Math.floor(10000 / Math.max(1, list.length)) / 100;
    const out = list.map(() => base);
    if (out.length) out[0] = Math.round((100 - base * (out.length - 1)) * 100) / 100;
    return out;
  };
  const [perDay, setPerDay] = useState('');
  const [shares, setShares] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const mine = d.airings.filter((a) => a.channelId === ctx.channelId && !isRepeat(a) && a.date >= ctx.ws && a.date <= ctx.we);
    const day = mine[0]?.date;
    setPerDay(String(day ? mine.filter((a) => a.date === day).reduce((s, a) => s + a.passes, 0) : ctx.days[weekdayOf(ctx.ws)].size));
    setShares(equal().map(String));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const nums = shares.map((x) => Number(x.replace(',', '.')) || 0);
  const total = Math.round(nums.reduce((s, x) => s + x, 0) * 100) / 100;
  const pd = Number(perDay) || 0;
  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      label="Rotation"
      width={340}
      align="end"
      trigger={
        <Button size="xs" aria-expanded={open}>
          Rotation…
        </Button>
      }
    >
      <PopoverTitle>Rotation</PopoverTitle>
      <label className="flex items-center justify-between gap-2 text-small text-text-2">
        Plays per day
        <input className="mono h-[30px] w-[72px] rounded-ctl border border-border-strong bg-surface px-2 text-small text-text" value={perDay} onChange={(e) => setPerDay(e.target.value)} />
      </label>
      <div className="flex max-h-[210px] flex-col gap-1 overflow-y-auto">
        {list.map((it, i) => (
          <div key={it.id} className="flex items-center gap-2 text-small">
            <span className="min-w-0 flex-1 truncate">{items.get(it.id)?.info?.title ?? 'Item'}</span>
            <input
              aria-label={`Share of ${items.get(it.id)?.info?.title ?? 'item'}`}
              className="mono h-7 w-16 rounded-ctl border border-border-strong bg-surface px-1.5 text-right text-[12.5px] text-text"
              value={shares[i] ?? ''}
              onChange={(e) => setShares(shares.map((s, j) => (j === i ? e.target.value : s)))}
            />
            <span className="mono w-[50px] text-right text-[11.5px] text-text-3">{Math.round(((pd * (nums[i] ?? 0)) / 100) * 10) / 10}/day</span>
          </div>
        ))}
      </div>
      <span className="flex justify-between text-small">
        <span className="text-text-2">Total</span>
        <span className={cx('mono font-medium', Math.abs(total - 100) > 0.01 && 'text-amber-text')}>{total} %</span>
      </span>
      <span className="text-meta text-text-3">Shares must add up to 100 %. The current placement is replaced on every day of the plan; nothing changes if the plays do not fit.</span>
      {d.items.length > 100 && <span className="text-meta text-text-3">The first 100 items rotate.</span>}
      {error && <Notice tone="amber">{error}</Notice>}
      <div className="flex justify-between gap-2">
        <Button size="sm" onClick={() => setShares(equal().map(String))}>
          Equal shares
        </Button>
        <PopoverFooter>
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              const r = rotate(d, ctx.rules, ctx.channelId, { passesPerDay: Math.trunc(pd), shares: list.map((it, i) => ({ itemId: it.id, percent: nums[i] ?? 0 })) });
              if (!r.ok) return setError(r.reason ?? 'Nothing changed.');
              const zero = list.filter((it) => (r.perItem.get(it.id) ?? 0) === 0 && (nums[list.indexOf(it)] ?? 0) > 0).length;
              ctx.apply({ ...d, airings: r.airings });
              onOpenChange(false);
              toast(`Placed ${Math.trunc(pd)} plays a day on ${r.days} days${zero ? ` · ${zero} items get no play a day` : ''}`);
            }}
          >
            Place
          </Button>
        </PopoverFooter>
      </div>
    </Popover>
  );
}

