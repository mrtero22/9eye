// Right panel for one block: type, times, options, linked breaks (main template) or where an ads
// block is used (ads template), note.

import { useEffect, useMemo, useState } from 'react';
import {
  applyPlan,
  breaksAtPositions,
  breaksInside,
  endOf,
  moveBreak,
  ordinal,
  planApply,
  positionsOf,
  setBreaks,
  updateBlock,
  type ApplyScope,
  type BlockDraft,
  type TemplateDraft,
} from '@9eye/core';
import {
  Button,
  CommitField,
  DayToggles,
  Icon,
  IconButton,
  Notice,
  PanelSection,
  Popover,
  PopoverFooter,
  PopoverTitle,
  RadioList,
  RowList,
  SearchField,
  Swatch,
  SwitchRow,
  TextArea,
  useToast,
} from '@/ui';
import type { BreakList, TemplateFull } from '@/lib/types';
import {
  adsBlockFor,
  clock,
  clockTc,
  dayName,
  dayRun,
  groupOf,
  hourFloor,
  lengthTc,
  lengthWords,
  parseClock,
  parseLength,
  range,
  typeColor,
  typeName,
  type PageCtx,
} from './model';
import { TypePicker } from './TypePicker';

export interface BlockPanelProps {
  ctx: PageCtx;
  full: TemplateFull;
  draft: TemplateDraft;
  block: BlockDraft;
  lists: BreakList[];
  onChange: (d: TemplateDraft) => void;
  onRemove: () => void;
  onDetails: () => void;
  onOpenAds: (weekday: number, typeId: string) => void;
  onOpenMain: (blockId: string) => void;
  onNewList: () => void;
  onSaveAsList: (positions: number[]) => void;
  onManageLists: () => void;
}

export function BlockPanel(p: BlockPanelProps) {
  const { ctx, draft, block } = p;
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [block.id]);
  const type = ctx.types.get(block.blockTypeId);
  const group = groupOf(ctx, block.blockTypeId);
  const edit = (patch: Partial<BlockDraft>): string | null => {
    const r = updateBlock(draft, block.id, patch, ctx.rule);
    if (!r.ok) return r.problems[0].message;
    p.onChange(r.draft);
    setError(null);
    return null;
  };
  return (
    <div className="flex flex-col gap-5 p-4">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-section font-semibold tracking-[-0.01em]">{type?.name ?? 'Unknown block type'}</h2>
        <div className="text-text-2">
          {dayName(block.weekday)} · <span className="mono">{range(ctx, block)}</span>
        </div>
      </div>
      <dl className="m-0 grid grid-cols-[110px_minmax(0,1fr)] items-center gap-3 text-small">
        <dt className="text-text-3">Block type</dt>
        <dd className="m-0 flex min-w-0 items-center gap-2">
          <Swatch color={type?.color} />
          <span className="min-w-0 truncate">{group?.name ?? '—'}</span>
          <span className="ml-auto">
            <TypePicker
              ctx={ctx}
              draft={draft}
              weekday={block.weekday}
              exceptBlockId={block.id}
              label="Change block type"
              trigger={
                <Button size="xs" variant="secondary">
                  Change
                </Button>
              }
              onPick={(t) => setError(edit({ blockTypeId: t.id }))}
            />
          </span>
        </dd>
        <dt className="text-text-3">Start</dt>
        <dd className="m-0">
          <CommitField value={block.startFrames} format={(v) => clockTc(ctx, v)} parse={(s) => parseClock(ctx, s)} onCommit={(v) => edit({ startFrames: v })} width={130} ariaLabel="Start time" />
        </dd>
        <dt className="text-text-3">Length</dt>
        <dd className="m-0">
          <CommitField value={block.lengthFrames} format={(v) => lengthTc(ctx, v)} parse={(s) => parseLength(ctx, s)} onCommit={(v) => edit({ lengthFrames: v })} width={130} ariaLabel="Length" />
        </dd>
      </dl>
      {error && <Notice tone="amber">{error}</Notice>}
      <div className="flex flex-col gap-3">
        <SwitchRow title="Fill gaps from rotation list" description="Free time in this block is filled automatically" checked={block.fillGaps} onChange={(v) => edit({ fillGaps: v })} />
        <SwitchRow title="Opens with linked break" description="The block starts with its first break" checked={block.opensWithBreak} onChange={(v) => edit({ opensWithBreak: v })} />
      </div>
      {ctx.allowsBreaks && <LinkedBreaks {...p} />}
      {ctx.kind === 'main' && !ctx.hasAds && (
        <Notice>This channel has no ads playlist, so its blocks have no linked breaks.</Notice>
      )}
      {ctx.kind === 'ads' && <LinkedFrom {...p} />}
      <NoteField key={block.id} value={block.note} onCommit={(note) => edit({ note })} />
      <div className="flex flex-wrap gap-2">
        <Button onClick={p.onDetails}>All details</Button>
        <Button variant="danger" onClick={p.onRemove}>
          Remove block
        </Button>
      </div>
    </div>
  );
}

function NoteField({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return <TextArea label="Note" rows={2} placeholder="Add a note" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text !== value && onCommit(text)} />;
}

// ---------------------------------------------------------------- linked breaks (main template)

function LinkedBreaks(p: BlockPanelProps) {
  const { ctx, draft, block, full } = p;
  const toast = useToast();
  const set = (breaks: string[]) => p.onChange(setBreaks(draft, block.id, breaks));
  const noAdsTemplate = !full.ads?.template;
  return (
    <PanelSection
      title={
        <>
          Linked breaks <span className="mono font-normal text-text-3">{block.breaks.length}</span>
        </>
      }
      aside={<span title={full.ads?.template?.name}>filled in the ads layout</span>}
    >
      {noAdsTemplate && <Notice tone="amber">No ads layout covers this layout's dates, so breaks cannot be picked.</Notice>}
      <div className="flex flex-wrap gap-1.5">
        <AddBreak ctx={ctx} block={block} disabled={noAdsTemplate} onAdd={(id) => set([...block.breaks, id])} />
        <UseList {...p} onUse={(ids, name) => { set(ids); toast(`Breaks from "${name}"`); }} />
        <ApplyToOthers ctx={ctx} draft={draft} block={block} onApply={(d, n) => { p.onChange(d); toast(`Applied to ${n} ${n === 1 ? 'block' : 'blocks'}`); }} />
      </div>
      <RowList footer="Ends with a gap holder (length 0), added automatically">
        {block.breaks.map((id, i) => {
          const ads = adsBlockFor(ctx, block.weekday, id);
          const name = typeName(ctx, id);
          return (
            <div key={`${id}-${i}`} className="flex min-h-9 items-center gap-1.5 pl-2.5 pr-1">
              <span className="mono w-3.5 text-tiny text-text-3">{i + 1}</span>
              <Swatch color={typeColor(ctx, id)} size={7} />
              <span className="min-w-0 flex-1 truncate text-small">{name}</span>
              {ads ? (
                <span className="mono mr-0.5 text-[11.5px] text-text-3" title="Capacity in the ads layout">
                  {lengthWords(ctx, ads.lengthFrames)}
                </span>
              ) : (
                <span className="mr-0.5 text-[11.5px] text-amber-text" title="This break is not a block of the ads layout on this day">
                  not in ads layout
                </span>
              )}
              <IconButton icon="chevronUp" size="xs" tone="quiet" label={`Move ${name} up`} disabled={i === 0} onClick={() => p.onChange(moveBreak(draft, block.id, i, -1))} />
              <IconButton icon="chevronDown" size="xs" tone="quiet" label={`Move ${name} down`} disabled={i === block.breaks.length - 1} onClick={() => p.onChange(moveBreak(draft, block.id, i, 1))} />
              <IconButton icon="open" size="xs" tone="quiet" label={`Open ${name} in the ads layout`} disabled={!ads} onClick={() => p.onOpenAds(block.weekday, id)} />
              <IconButton icon="close" size="xs" tone="quiet" label={`Remove ${name}`} onClick={() => set(block.breaks.filter((_, j) => j !== i))} />
            </div>
          );
        })}
        {!block.breaks.length && <div className="p-2.5 text-small text-text-3">No breaks. The programme runs without interruption.</div>}
      </RowList>
    </PanelSection>
  );
}

function AddBreak({ ctx, block, disabled, onAdd }: { ctx: PageCtx; block: BlockDraft; disabled: boolean; onAdd: (typeId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const day = ctx.adsDays[block.weekday] ?? [];
  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle) return day.filter((a) => typeName(ctx, a.blockTypeId).toLowerCase().includes(needle));
    const from = hourFloor(ctx, block.startFrames);
    const hours = Math.max(1, Math.ceil((endOf(block) - from) / ctx.fph)) + 1;
    return day.filter((a) => a.startFrames >= from && a.startFrames < from + hours * ctx.fph);
  }, [q, day, ctx, block]);
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQ('');
      }}
      label="Add a break"
      width={330}
      trigger={
        <Button size="sm" icon="plus" disabled={disabled}>
          Add break
        </Button>
      }
    >
      <PopoverTitle hint="Breaks are the blocks of the ads layout. Pick one; names are never typed.">Add a break</PopoverTitle>
      <SearchField value={q} onChange={setQ} placeholder={`Search all ${day.length} breaks`} label="Search breaks" size="sm" autoFocus />
      <div className="flex max-h-[260px] flex-col gap-0.5 overflow-y-auto">
        {items.map((a) => {
          const added = block.breaks.includes(a.blockTypeId);
          return (
            <button
              key={a.blockTypeId}
              type="button"
              disabled={added}
              onClick={() => {
                onAdd(a.blockTypeId);
                setOpen(false);
                setQ('');
              }}
              className="hov flex min-h-[30px] cursor-pointer items-center gap-2 rounded-ctl border-0 bg-transparent px-2 text-left text-small"
            >
              <Swatch color={typeColor(ctx, a.blockTypeId)} size={7} />
              <span className="flex-1">{typeName(ctx, a.blockTypeId)}</span>
              <span className="mono text-[11.5px] text-text-3">{added ? 'added' : lengthWords(ctx, a.lengthFrames)}</span>
            </button>
          );
        })}
        {!items.length && <span className="px-2 py-1.5 text-small text-text-3">No breaks found.</span>}
      </div>
      <PopoverFooter>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Close
        </Button>
      </PopoverFooter>
    </Popover>
  );
}

function UseList(p: BlockPanelProps & { onUse: (ids: string[], name: string) => void }) {
  const { ctx, block, lists } = p;
  const [open, setOpen] = useState(false);
  const own = positionsOf(block, ctx.adsDays);
  const ownOk = block.breaks.length > 0 && own.every((k) => k >= 0);
  const win = breaksInside(ctx.adsDays[block.weekday], block.startFrames, block.lengthFrames);
  const item = 'hov flex min-h-[30px] w-full cursor-pointer items-center rounded-ctl border-0 bg-transparent px-2 text-left text-small';
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label="Use a break list"
      width={330}
      padding="p-2"
      trigger={<Button size="sm">Use a list</Button>}
    >
      <span className="flex flex-col gap-px px-2 pb-1.5 pt-1">
        <span className="text-small font-semibold">Break lists of {ctx.channel.name}</span>
        <span className="text-meta text-text-3">Made by your team for this channel. Picking one replaces this block's breaks.</span>
      </span>
      <div className="flex flex-col gap-0.5">
        {lists.map((l) => {
          const ids = breaksAtPositions(l.positions, block, ctx.adsDays);
          const missing = l.positions.filter((k) => k >= win.length).map((k) => ordinal(k + 1));
          return (
            <button
              key={l.id}
              type="button"
              disabled={!ids}
              onClick={() => {
                if (!ids) return;
                p.onUse(ids, l.name);
                setOpen(false);
              }}
              className="hov flex cursor-pointer flex-col items-start gap-px rounded-ctl border-0 bg-transparent px-2 py-1.5 text-left"
            >
              <span className="text-small font-medium">{l.name}</span>
              <span className="text-meta text-text-3">
                {ids
                  ? ids.length
                    ? `${ids.length} ${ids.length === 1 ? 'break' : 'breaks'} · ${ids.map((id) => typeName(ctx, id)).join(' · ')}`
                    : 'No breaks: the programme runs without interruption'
                  : `Does not fit this block: it has ${win.length} ads-template ${win.length === 1 ? 'break' : 'breaks'}, the list needs the ${missing.join(', ')}`}
              </span>
            </button>
          );
        })}
        {!lists.length && <span className="px-2 py-1.5 text-small text-text-3">No lists yet.</span>}
      </div>
      <div className="my-1 h-px bg-hairline" />
      <button type="button" className={item} onClick={() => { setOpen(false); p.onNewList(); }}>
        New list…
      </button>
      <button
        type="button"
        className={item}
        disabled={!ownOk}
        title={ownOk ? undefined : 'Every break must be inside this block’s time'}
        onClick={() => { setOpen(false); p.onSaveAsList(own); }}
      >
        Save these breaks as a list…
      </button>
      <button type="button" className={item} onClick={() => { setOpen(false); p.onManageLists(); }}>
        Manage break lists…
      </button>
    </Popover>
  );
}

function ApplyToOthers({ ctx, draft, block, onApply }: { ctx: PageCtx; draft: TemplateDraft; block: BlockDraft; onApply: (d: TemplateDraft, n: number) => void }) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<ApplyScope>('type');
  const [days, setDays] = useState<boolean[]>([true, true, true, true, true, true, true]);
  const plan = useMemo(() => (open ? planApply(draft, block.id, scope, days, ctx.rule.blockTypes, ctx.adsDays) : null), [open, draft, block.id, scope, days, ctx]);
  const group = groupOf(ctx, block.blockTypeId);
  const label = (b: BlockDraft) => `${dayName(b.weekday).slice(0, 3)} ${clock(ctx, b.startFrames)}`;
  let preview = '';
  let warn = false;
  if (plan) {
    if (plan.outside.length) {
      warn = true;
      preview = `${plan.outside.map((id) => typeName(ctx, id)).join(', ')} ${plan.outside.length === 1 ? 'is' : 'are'} not inside this block's time, so ${plan.outside.length === 1 ? 'it has' : 'they have'} no position. Nothing will be applied.`;
    } else if (!plan.targets.length) {
      warn = true;
      preview = 'No blocks match.';
    } else if (plan.failures.length) {
      warn = true;
      preview = `${plan.failures.length} of ${plan.targets.length} blocks have no break at the same position (e.g. ${label(plan.failures[0])}). Nothing will be applied.`;
    } else {
      preview = `${plan.targets.length} ${plan.targets.length === 1 ? 'block gets' : 'blocks get'} these ${block.breaks.length} breaks.`;
    }
  }
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label="Apply breaks to other blocks"
      width={330}
      trigger={
        <Button size="sm" variant="ghost">
          Apply to other blocks…
        </Button>
      }
    >
      <PopoverTitle>Apply these breaks to</PopoverTitle>
      <RadioList
        label="Which blocks"
        value={scope}
        onChange={setScope}
        options={[
          { value: 'type', label: 'Same block type on other days' },
          { value: 'group', label: `All "${group?.name ?? 'this group'}" blocks` },
          { value: 'length', label: `All ${lengthWords(ctx, block.lengthFrames)} blocks` },
        ]}
      />
      <DayToggles label="On days" tone="accent" size="sm" weekStart={ctx.channel.weekStart} value={days} onToggle={(d) => setDays(days.map((v, i) => (i === d ? !v : v)))} />
      <span className={warn ? 'text-small text-amber-text' : 'text-small text-text'}>{preview}</span>
      {plan && plan.failures.length > 1 && (
        <span className="text-meta text-text-3">
          Without a match: {plan.failures.slice(0, 8).map(label).join(', ')}
          {plan.failures.length > 8 ? ` and ${plan.failures.length - 8} more` : ''}.
        </span>
      )}
      <span className="text-meta text-text-3">
        Each break is matched by its position among the ads-template breaks inside the target block (1st, 2nd, …), never by its name. If any block has no match, nothing is applied.
      </span>
      <PopoverFooter>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={!plan?.ok}
          onClick={() => {
            if (!plan?.ok) return;
            onApply(applyPlan(draft, plan), plan.targets.length);
            setOpen(false);
          }}
        >
          Apply
        </Button>
      </PopoverFooter>
    </Popover>
  );
}

// ---------------------------------------------------------------- ads template: where a break is used

function LinkedFrom({ ctx, full, block, onOpenMain }: BlockPanelProps) {
  const rows = useMemo(() => {
    const main = full.main?.blocks ?? [];
    const out: { days: number[]; blockId: string; typeId: string; start: number; length: number }[] = [];
    for (const d of ctx.order) {
      const m = main.find((b) => b.weekday === d && b.breaks.includes(block.blockTypeId));
      if (!m) continue;
      const last = out[out.length - 1];
      const prevDay = last ? ctx.order.indexOf(last.days[last.days.length - 1]) : -2;
      if (last && last.typeId === m.blockTypeId && last.start === m.startFrames && prevDay === ctx.order.indexOf(d) - 1) last.days.push(d);
      else out.push({ days: [d], blockId: m.id, typeId: m.blockTypeId, start: m.startFrames, length: m.lengthFrames });
    }
    return out;
  }, [full.main, block.blockTypeId, ctx.order]);
  return (
    <PanelSection>
      <span className="flex flex-col">
        <span className="font-medium">Linked from the main layout</span>
        <span className="text-meta text-text-3">
          This block is a break; its spots are copied into these main blocks{full.main?.template ? ` (${full.main.template.name})` : ''}
        </span>
      </span>
      <RowList>
        {rows.map((r) => (
          <button key={r.blockId} type="button" onClick={() => onOpenMain(r.blockId)} className="hov flex min-h-10 cursor-pointer items-center gap-2.5 border-0 bg-transparent px-2.5 py-1 text-left">
            <span className="w-14 shrink-0 text-meta text-text-3">{dayRun(ctx, r.days)}</span>
            <span className="flex min-w-0 flex-1 flex-col leading-[1.3]">
              <span className="truncate text-small font-medium">{typeName(ctx, r.typeId)}</span>
              <span className="mono text-[11.5px] text-text-3">{range(ctx, { startFrames: r.start, lengthFrames: r.length })}</span>
            </span>
            <Icon name="open" size={13} strokeWidth={2} className="shrink-0 text-text-3" />
          </button>
        ))}
        {!rows.length && <div className="p-2.5 text-small text-text-3">No main block uses this break.</div>}
      </RowList>
    </PanelSection>
  );
}
