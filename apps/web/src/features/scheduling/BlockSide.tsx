// Left sidebar when a block is clicked (scheduling-page.md "Block"): what this order has there — a
// first airing with its repeats, a repeat, nothing, or promo passes — other orders in the block, the
// template's linked breaks, the block colour in this order and delete.

import { useEffect, useState, type ReactNode } from 'react';
import { addDays, daysBetween, distanceText, isRepeat, weekStartOn, weekdayOf, type AiringDraft } from '@9eye/core';
import { Button, EmptyState, Notice, Popover, PopoverFooter, PopoverTitle, RowList, Segmented, SelectField, Swatch, SwatchPicker, cx, dataTint, safeColor } from '@/ui';
import type { OrderCtx } from './ctx';
import { addFirst, addRepeat, changeItem, makeRepeatOf, removeAiring, setBlockColor, setPasses } from './edits';
import { SWATCHES, airingTitle, cellOf, chapterLabel, dayBlocks, isProgrammeMode, itemTitle, othersIn, programmeOf, shortDay, timeWithDay } from './model';

export function BlockSide({ ctx, date, blockTypeId, onBack, onChangeEnd }: { ctx: OrderCtx; date: string; blockTypeId: string; onBack: () => void; onChangeEnd: () => void }) {
  const { draft: d, t, items, byId, template } = ctx;
  const block = dayBlocks(template, date).find((b) => b.blockTypeId === blockTypeId);
  const mine = cellOf(d, ctx.channelId, date, blockTypeId);
  const others = othersIn(ctx.others, ctx.full.order.id, date, blockTypeId);
  const other = programmeOf(others);
  const programme = isProgrammeMode(d.mode);
  const inside = date >= d.startDate && date <= d.endDate;
  const color = mine?.blockColor ?? d.color;
  if (!block) {
    return (
      <>
        <BackButton onClick={onBack} />
        <EmptyState>The layout has no such block on {shortDay(date)}.</EmptyState>
      </>
    );
  }
  const end = block.startFrames + block.lengthFrames;
  const open = (a: AiringDraft) => {
    if (a.date < ctx.ws || a.date > ctx.we) ctx.openWeek(a.date);
    setTimeout(() => ctx.selectBlock(a.date, a.blockTypeId), 0);
  };
  const first = mine && isRepeat(mine) ? byId.get(mine.repeatOfId!) : undefined;
  const repeats = mine && !isRepeat(mine) ? d.airings.filter((a) => a.repeatOfId === mine.id).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : startOf(ctx, a) - startOf(ctx, b))) : [];
  const card = (title: string, sub: string, actions: ReactNode) => (
    <div className="flex flex-col gap-2 rounded-item border border-border p-3" style={{ borderLeft: `3px solid ${safeColor(color)}`, background: dataTint(color, 6) }}>
      <span className="flex flex-col gap-0.5">
        <span className="font-semibold">{title}</span>
        <span className="text-small text-text-2">{sub}</span>
      </span>
      <div className="flex flex-wrap gap-1.5">{actions}</div>
    </div>
  );

  return (
    <>
      <BackButton onClick={onBack} />
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-section font-semibold tracking-[-0.01em]">{block.name}</h2>
        <div className="text-small text-text-2">
          {shortDay(date)} · <span className="mono">{t.clock(block.startFrames)} – {t.clock(end)}</span>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-small text-text-3">In this plan</span>
        {!inside ? (
          <EmptyState action={<Button size="sm" onClick={onChangeEnd}>Change end date…</Button>}>
            Outside this plan's dates (it runs {shortDay(d.startDate)} → {shortDay(d.endDate)}).
          </EmptyState>
        ) : !programme ? null : mine && !isRepeat(mine) ? (
          card(
            airingTitle(mine, byId, items),
            `First airing · ${chapterLabel(items, mine.items[0]?.itemId, d.items.length)}`,
            <>
              <ChangePopover ctx={ctx} date={date} blockTypeId={blockTypeId} kind="episode" current={mine} label="Change episode…" />
              <Button size="xs" variant="danger" onClick={() => ctx.apply(removeAiring(d, mine.id))}>
                Remove{repeats.length ? ` with ${repeats.length} repeat${repeats.length === 1 ? '' : 's'}` : ''}
              </Button>
            </>,
          )
        ) : mine ? (
          card(
            `Repeat of ${airingTitle(mine, byId, items)}`,
            first ? `First aired ${first.date < weekStartOn(date, ctx.channel.weekStart) ? `last ${shortDay(first.date)}` : shortDay(first.date)} · ${distanceText(daysBetween(first.date, date))}` : 'Its first airing is missing',
            <>
              <ChangePopover ctx={ctx} date={date} blockTypeId={blockTypeId} kind="repeat" current={mine} label="Change what it repeats…" />
              {first && (
                <Button size="xs" onClick={() => open(first)}>
                  Open first airing
                </Button>
              )}
              <Button size="xs" variant="danger" onClick={() => ctx.apply(removeAiring(d, mine.id))}>
                Remove
              </Button>
            </>,
          )
        ) : (
          <>
            {other && (
              <Notice tone="amber">
                This block already has a programme from another plan: {other.orderName} ({other.titles[0] ?? 'a programme'}, {other.kind === 'first' ? 'first airing' : 'repeat'}). Adding one here places two programmes in one block.
              </Notice>
            )}
            <div className="flex flex-col gap-2 rounded-item border border-dashed border-border-strong p-3">
              <span className="text-small text-text-2">{other ? 'Nothing from this plan in this block.' : 'No programme in this block from any plan.'}</span>
              <div className="flex flex-wrap gap-1.5">
                <Button size="xs" variant="primary" onClick={() => ctx.apply(addFirst(d, ctx.rules, ctx.channelId, date, blockTypeId))}>
                  Add first airing
                </Button>
                <ChangePopover ctx={ctx} date={date} blockTypeId={blockTypeId} kind="repeat" label="Repeat an earlier airing…" />
              </div>
            </div>
          </>
        )}
        {inside && !programme && <PromoPasses ctx={ctx} date={date} blockTypeId={blockTypeId} airing={mine} />}
      </div>

      {programme && mine && !isRepeat(mine) && (
        <div className="relative flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-medium">
              Repeats <span className="mono font-normal text-text-3">{repeats.length}</span>
            </span>
            <AddRepeatPopover ctx={ctx} first={mine} />
          </div>
          {repeats.length > 0 && (
            <RowList>
              {repeats.map((r) => (
                <button key={r.id} type="button" onClick={() => open(r)} className="hov flex min-h-[34px] w-full cursor-pointer items-center gap-2.5 border-0 bg-transparent px-2.5 text-left text-small">
                  <span className="w-[84px] shrink-0">{shortDay(r.date)}</span>
                  <span className="mono flex-1 whitespace-nowrap">{timeWithDay(t, r.date, startOf(ctx, r))}</span>
                  <span className="text-meta text-text-3">{distanceText(daysBetween(mine.date, r.date))}</span>
                </button>
              ))}
            </RowList>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <span className="flex flex-col">
          <span className="font-medium">Other plans in this block</span>
          <span className="text-meta text-text-3">Drafts are left out of the playlist</span>
        </span>
        {others.length ? (
          <RowList>
            {others.map((o) => (
              <button key={o.id} type="button" onClick={() => ctx.openOrder(o.orderId, { date, blockTypeId })} className="hov flex min-h-10 w-full cursor-pointer items-center gap-2.5 border-0 bg-transparent px-2.5 py-1 text-left">
                <Swatch color={o.orderColor} />
                <span className="flex min-w-0 flex-1 flex-col leading-[1.3]">
                  <span className="truncate text-small font-medium">{o.orderName}</span>
                  <span className="text-[11.5px] text-text-3">
                    {isProgrammeMode(o.mode) ? `${o.titles[0] ?? ''} · ${o.kind === 'first' ? 'first airing' : 'repeat'}` : `${o.passes} plays`}
                    {o.status === 'draft' ? ' · draft' : ''}
                  </span>
                </span>
              </button>
            ))}
          </RowList>
        ) : (
          <span className="text-small text-text-3">None.</span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <span className="font-medium">From the layout</span>
        <span className="text-small text-text-2">{block.breakCount ? `${block.breakCount} linked break${block.breakCount === 1 ? '' : 's'}, filled in the ads layout.` : 'No linked breaks.'}</span>
      </div>
      <div className="flex flex-col gap-2">
        <span className="flex flex-col">
          <span className="font-medium">Block colour in this plan</span>
          <span className="text-meta text-text-3">Grey is kept for blocks without airings</span>
        </span>
        <SwatchPicker
          label="Block colour"
          colors={SWATCHES}
          value={mine ? (mine.blockColor ?? d.color) : null}
          disabled={!mine}
          offLast={{ reason: 'Grey, kept for blocks without airings' }}
          onChange={(c) => mine && ctx.apply(setBlockColor(d, mine.id, c.toLowerCase() === d.color.toLowerCase() ? null : c))}
        />
      </div>
      <Button variant="danger" className="-ml-3 self-start" disabled={!mine} onClick={() => mine && ctx.apply(removeAiring(d, mine.id))}>
        Delete this plan's airings here
      </Button>
    </>
  );
}

const startOf = (ctx: OrderCtx, a: AiringDraft) => ctx.rules.templates.get(a.channelId)?.[weekdayOf(a.date)]?.get(a.blockTypeId)?.startFrames ?? 0;

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" icon="chevronLeft" className="-ml-2 self-start" onClick={onClick}>
      Plan details
    </Button>
  );
}

function PromoPasses({ ctx, date, blockTypeId, airing }: { ctx: OrderCtx; date: string; blockTypeId: string; airing: AiringDraft | undefined }) {
  const n = airing?.passes ?? 0;
  const list: string[] = [];
  const its = airing?.items ?? [];
  for (let i = 0; i < n && its.length; i++) list.push(itemTitle(ctx.items, its[i % its.length].itemId));
  const set = (v: number) => ctx.apply(setPasses(ctx.draft, ctx.channelId, date, blockTypeId, v));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">Plays in this block</span>
        <span className="inline-flex items-center overflow-hidden rounded-ctl border border-border-strong bg-surface">
          <button type="button" aria-label="Fewer plays" disabled={!n} onClick={() => set(n - 1)} className="hov size-7 cursor-pointer border-0 bg-surface">
            −
          </button>
          <span className="mono w-[34px] text-center text-small">{n}</span>
          <button type="button" aria-label="More plays" onClick={() => set(n + 1)} className="hov size-7 cursor-pointer border-0 bg-surface">
            +
          </button>
        </span>
      </div>
      {list.length > 0 && (
        <RowList>
          {list.map((l, i) => (
            <div key={i} className="flex min-h-[30px] items-center gap-2 px-2.5 text-small">
              <span className="mono w-4 text-tiny text-text-3">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate">{l}</span>
            </div>
          ))}
        </RowList>
      )}
      <span className="text-meta text-text-3">
        {ctx.draft.status === 'draft' ? 'Draft: these plays are left out of the playlist.' : its.length > n ? `The ${its.length} items rotate block by block.` : 'Placed into the main playlist by "Auto-place trailers" on the day.'}
      </span>
    </div>
  );
}

/** Pick an episode (first airing) or which first airing a block repeats (previous days / episodes). */
function ChangePopover({ ctx, date, blockTypeId, kind, current, label }: { ctx: OrderCtx; date: string; blockTypeId: string; kind: 'episode' | 'repeat'; current?: AiringDraft; label: string }) {
  const { draft: d, items, t } = ctx;
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'days' | 'items'>(kind === 'episode' ? 'items' : 'days');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setTab(kind === 'episode' ? 'items' : 'days');
      setError(null);
    }
  }, [open, kind]);
  const here = startOf(ctx, { channelId: ctx.channelId, date, blockTypeId } as AiringDraft);
  const before = d.airings
    .filter((a) => a.channelId === ctx.channelId && !isRepeat(a) && a.id !== current?.id && (a.date < date || (a.date === date && startOf(ctx, a) < here)) && daysBetween(a.date, date) <= 6)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : startOf(ctx, b) - startOf(ctx, a)));
  const currentItem = current && !isRepeat(current) ? current.items[0]?.itemId : current ? ctx.byId.get(current.repeatOfId!)?.items[0]?.itemId : undefined;
  const pos = currentItem ? d.items.findIndex((i) => i.id === currentItem) : -1;
  const from = Math.max(0, pos - 2);
  const itemRows = d.items.slice(from, from + 12);
  const pickItem = (itemId: string) => {
    if (kind === 'episode' && current) {
      ctx.apply(changeItem(d, current.id, itemId));
      return setOpen(false);
    }
    const f = before.find((a) => a.items.some((x) => x.itemId === itemId)) ?? d.airings.find((a) => !isRepeat(a) && a.channelId === ctx.channelId && a.items.some((x) => x.itemId === itemId) && a.date <= date);
    if (!f) return setError(`${itemTitle(items, itemId)} has no first airing before this block.`);
    if (ctx.apply(makeRepeatOf(d, ctx.channelId, date, blockTypeId, f.id))) setOpen(false);
  };
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label={kind === 'episode' ? 'Pick the episode' : 'Repeat which first airing?'}
      width={300}
      trigger={
        <Button size="xs" aria-expanded={open}>
          {label}
        </Button>
      }
    >
      <PopoverTitle>{tab === 'items' ? (kind === 'episode' ? 'Pick the episode' : 'Repeat which episode?') : 'Repeat which first airing?'}</PopoverTitle>
      {kind === 'repeat' && (
        <Segmented
          label="Pick from"
          size="sm"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'days', label: 'Previous days' },
            { value: 'items', label: 'Episodes' },
          ]}
        />
      )}
      <div className="flex max-h-[220px] flex-col gap-0.5 overflow-y-auto">
        {tab === 'days'
          ? before.slice(0, 14).map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => ctx.apply(makeRepeatOf(d, ctx.channelId, date, blockTypeId, a.id)) && setOpen(false)}
                className={cx('hov flex min-h-[30px] cursor-pointer items-center gap-2 rounded-ctl border-0 px-2 text-left text-small', current?.repeatOfId === a.id ? 'bg-accent-soft' : 'bg-transparent')}
              >
                <span className="flex-1">{itemTitle(items, a.items[0]?.itemId)}</span>
                <span className="mono text-[11.5px] text-text-3">
                  {shortDay(a.date).slice(0, 3)} {t.clock(startOf(ctx, a))} · {distanceText(daysBetween(a.date, date))}
                </span>
              </button>
            ))
          : itemRows.map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => pickItem(it.id)}
                className={cx('hov flex min-h-[30px] cursor-pointer items-center gap-2 rounded-ctl border-0 px-2 text-left text-small', it.id === currentItem ? 'bg-accent-soft' : 'bg-transparent')}
              >
                <span className="flex-1">{items.get(it.id)?.info?.title ?? 'Item'}</span>
              </button>
            ))}
        {tab === 'days' && !before.length && (
          <button type="button" onClick={() => setTab('items')} className="hov min-h-[30px] cursor-pointer rounded-ctl border-0 bg-transparent px-2 text-left text-small text-text-3">
            No first airing in the 6 days before this block
          </button>
        )}
      </div>
      {error && <Notice tone="amber">{error}</Notice>}
      <PopoverFooter>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Close
        </Button>
      </PopoverFooter>
    </Popover>
  );
}

function AddRepeatPopover({ ctx, first }: { ctx: OrderCtx; first: AiringDraft }) {
  const { draft: d, t } = ctx;
  const [open, setOpen] = useState(false);
  const [dist, setDist] = useState(0);
  const target = addDays(first.date, dist);
  const blocks = dayBlocks(ctx.template, target);
  const [bt, setBt] = useState('');
  useEffect(() => {
    if (open) {
      setDist(0);
      setBt('');
    }
  }, [open]);
  const chosen = bt && blocks.some((b) => b.blockTypeId === bt) ? bt : blocks.find((b) => b.startFrames > startOf(ctx, first) || dist > 0)?.blockTypeId ?? blocks[0]?.blockTypeId ?? '';
  const there = othersIn(ctx.others, ctx.full.order.id, target, chosen).find((w) => isProgrammeMode(w.mode));
  const taken = cellOf(d, ctx.channelId, target, chosen);
  const dayStart = t.clock(0);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label="Add a repeat"
      width={320}
      align="end"
      trigger={
        <Button size="xs" icon="plus" aria-expanded={open}>
          Add repeat
        </Button>
      }
    >
      <PopoverTitle>Add a repeat of {itemTitle(ctx.items, first.items[0]?.itemId)}</PopoverTitle>
      <div className="grid grid-cols-2 gap-2.5">
        <SelectField label="When" value={dist} onChange={(e) => setDist(Number(e.target.value))}>
          {['Same broadcast day', '+1 day', '+2 days', '+3 days', '+4 days', '+5 days', '+6 days'].map((l, i) => (
            <option key={i} value={i}>
              {l}
            </option>
          ))}
        </SelectField>
        <SelectField label="Block" value={chosen} onChange={(e) => setBt(e.target.value)}>
          {blocks.map((b) => (
            <option key={b.blockTypeId} value={b.blockTypeId}>
              {t.clock(b.startFrames)} · {b.name}
            </option>
          ))}
        </SelectField>
      </div>
      <span className="text-meta text-text-3">
        {shortDay(target)}. Days count in broadcast days ({dayStart} → {dayStart}).
      </span>
      {taken && <Notice tone="amber">That block already has an airing of this plan.</Notice>}
      {!taken && there && (
        <Notice tone="amber">
          That block holds {there.orderName} ({there.titles[0] ?? 'a programme'}); the repeat places two programmes in it.
        </Notice>
      )}
      {target > d.endDate && <Notice tone="amber">{shortDay(target)} is after the plan ends.</Notice>}
      <PopoverFooter>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" disabled={!chosen || !!taken || target > d.endDate} onClick={() => ctx.apply(addRepeat(d, first.id, target, chosen)) && setOpen(false)}>
          Add
        </Button>
      </PopoverFooter>
    </Popover>
  );
}
