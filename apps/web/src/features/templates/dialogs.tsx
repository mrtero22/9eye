// Dialogs of the Templates page: templates (new, clone, rename, delete), block types, break lists,
// block details, unsaved changes.

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  addDays,
  breaksInside,
  checkDates,
  endOf,
  formatDate,
  lastWeekday,
  ordinal,
  weekStartOn,
  WEEKDAYS,
  type BlockDraft,
  type TemplateDraft,
} from '@9eye/core';
import { api, errorText } from '@/lib/api';
import type { BlockGroup, BlockType, BreakList, Channel, PlaylistKind, TemplateFull, TemplateSummary } from '@/lib/types';
import {
  Button,
  Checkbox,
  ColorField,
  ConfirmDialog,
  DatePicker,
  DayToggles,
  Dialog,
  Field,
  IconButton,
  Notice,
  RowList,
  Segmented,
  SelectField,
  SwitchRow,
  TextArea,
  TextField,
  useToast,
} from '@/ui';
import { clock, dayName, lengthTc, lengthWords, parseLength, range, todayIso, typeName, type PageCtx } from './model';
import { keys } from './queries';

// ---------------------------------------------------------------- templates

function nextWeekStart(weekStart: number): string {
  const t = todayIso();
  const s = weekStartOn(t, weekStart);
  return s === t ? s : addDays(s, 7);
}

function DatesFields({ from, to, setFrom, setTo, channel }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void; channel: Channel }) {
  return (
    <DatePicker
      mode="range"
      wholeWeeks
      label="Valid dates"
      width={400}
      weekStart={channel.weekStart}
      today={channel.today}
      from={from}
      to={to}
      onChange={(v) => {
        setFrom(v.from);
        setTo(v.to);
      }}
      help={`Starts on a ${WEEKDAYS[channel.weekStart].long} and ends on a ${WEEKDAYS[lastWeekday(channel.weekStart)].long}, the channel's week.`}
    />
  );
}

export function TemplateFormDialog({
  mode,
  open,
  onOpenChange,
  channel,
  source,
  onDone,
}: {
  mode: 'new' | 'clone';
  open: boolean;
  onOpenChange: (o: boolean) => void;
  channel: Channel;
  source?: TemplateSummary;
  onDone: (full: TemplateFull) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<PlaylistKind>('main');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const f = nextWeekStart(channel.weekStart);
    setName(mode === 'clone' && source ? `Copy of ${source.name}`.slice(0, 50) : '');
    setKind(source?.kind ?? 'main');
    setFrom(mode === 'clone' && source ? source.validFrom : f);
    setTo(mode === 'clone' && source ? source.validTo : addDays(f, 7 * 52 - 1));
    setError(null);
  }, [open, mode, source, channel.weekStart]);
  const m = useMutation({
    mutationFn: () =>
      mode === 'clone' && source
        ? api<TemplateFull>('POST', `/templates/${source.id}/clone`, { name, validFrom: from, validTo: to })
        : api<TemplateFull>('POST', '/templates', { playlistId: kind === 'main' ? channel.mainPlaylistId : channel.adsPlaylistId, name, validFrom: from, validTo: to }),
    onSuccess: (full) => {
      qc.invalidateQueries({ queryKey: keys.templates(channel.id) });
      qc.invalidateQueries({ queryKey: keys.channels() });
      toast(mode === 'clone' ? 'Layout cloned' : 'Layout created');
      onOpenChange(false);
      onDone(full);
    },
    onError: (e) => setError(errorText(e)),
  });
  const submit = () => {
    const problems = checkDates(from, to, channel.weekStart);
    if (!name.trim() || name.trim().length > 50) return setError('The name is required and has at most 50 characters.');
    if (problems.length) return setError(problems[0].message);
    m.mutate();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={mode === 'clone' ? 'Clone this layout' : 'New layout'}
      description={mode === 'clone' ? 'A copy with every block and linked break, for other dates.' : `For ${channel.name}. Its blocks are added afterwards.`}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={m.isPending} onClick={submit}>
            {mode === 'clone' ? 'Clone' : 'Create'}
          </Button>
        </>
      }
    >
      <TextField label="Name" value={name} maxLength={50} autoFocus onChange={(e) => setName(e.target.value)} />
      {mode === 'new' && channel.adsPlaylistId && (
        <Field label="Playlist">
          <Segmented label="Playlist" value={kind} onChange={setKind} options={[{ value: 'main', label: 'Main playlist' }, { value: 'ads', label: 'Ads playlist' }]} />
        </Field>
      )}
      <DatesFields from={from} to={to} setFrom={setFrom} setTo={setTo} channel={channel} />
      {error && <Notice tone="amber">{error}</Notice>}
    </Dialog>
  );
}

export function RenameDialog({ open, onOpenChange, value, onRename }: { open: boolean; onOpenChange: (o: boolean) => void; value: string; onRename: (v: string) => void }) {
  const [name, setName] = useState(value);
  useEffect(() => {
    if (open) setName(value);
  }, [open, value]);
  const ok = name.trim().length > 0 && name.trim().length <= 50;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Rename layout"
      description="Saved with the layout's other changes."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!ok} onClick={() => { onRename(name.trim()); onOpenChange(false); }}>
            Rename
          </Button>
        </>
      }
    >
      <TextField label="Name" value={name} maxLength={50} autoFocus onChange={(e) => setName(e.target.value)} hint={`${name.trim().length} of 50 characters`} />
    </Dialog>
  );
}

// ---------------------------------------------------------------- block types

export function BlockTypeDialog({
  open,
  onOpenChange,
  ctx,
  playlistId,
  playlistLabel,
  editing,
  groups,
  defaultFrom,
  defaultTo,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ctx: PageCtx;
  playlistId: string;
  playlistLabel: string;
  editing: BlockType | null;
  groups: BlockGroup[];
  defaultFrom: string;
  defaultTo: string;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [groupId, setGroupId] = useState('');
  const [newGroup, setNewGroup] = useState('');
  const [several, setSeveral] = useState<'one' | 'several'>('one');
  const [name, setName] = useState('');
  const [firstNo, setFirstNo] = useState('1');
  const [count, setCount] = useState('6');
  const [color, setColor] = useState('#4a90e2');
  const [textColor, setTextColor] = useState('#ffffff');
  const [length, setLength] = useState('');
  const [weekdays, setWeekdays] = useState<boolean[]>([true, true, true, true, true, true, true]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [fill, setFill] = useState(true);
  const [opens, setOpens] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const e = editing;
    setGroupId(e?.groupId ?? groups[0]?.id ?? '');
    setNewGroup('');
    setSeveral('one');
    setName(e?.name ?? '');
    setFirstNo('1');
    setCount('6');
    setColor(e?.color ?? '#4a90e2');
    setTextColor(e?.textColor ?? '#ffffff');
    setLength(lengthTc(ctx, e?.lengthFrames ?? ctx.fph));
    setWeekdays(e?.validWeekdays ?? [true, true, true, true, true, true, true]);
    setFrom(e?.validFrom ?? defaultFrom);
    setTo(e?.validTo ?? defaultTo);
    setFill(e?.fillGaps ?? ctx.kind === 'main');
    setOpens(e?.opensWithBreak ?? false);
    setNote(e?.note ?? '');
    setError(null);
  }, [open, editing, groups, ctx, defaultFrom, defaultTo]);
  const names = useMemo(() => {
    if (editing || several === 'one') return [name.trim()];
    const n = Math.max(0, Math.min(200, Number(count) || 0));
    const f = Math.max(0, Number(firstNo) || 0);
    return Array.from({ length: n }, (_, i) => `${name.trim()} ${f + i}`);
  }, [editing, several, name, count, firstNo]);
  const m = useMutation({
    mutationFn: (body: object) => (editing ? api('PATCH', `/block-types/${editing.id}`, body) : api('POST', '/block-types', body)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.blockTypes() });
      qc.invalidateQueries({ queryKey: keys.blockGroups() });
      toast(editing ? 'Block type saved' : names.length > 1 ? `${names.length} block types created` : 'Block type created');
      onOpenChange(false);
    },
    onError: (e) => setError(errorText(e)),
  });
  const submit = () => {
    const lengthFrames = parseLength(ctx, length);
    if (!name.trim()) return setError('A name is required.');
    if (lengthFrames === null) return setError('The length is not a valid timecode.');
    if (!weekdays.some(Boolean)) return setError('Pick at least one weekday.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) return setError('Check the dates (YYYY-MM-DD, from before to).');
    if (groupId === '__new' && !newGroup.trim()) return setError('Name the new block group.');
    const group = groupId === '__new' ? { newGroupName: newGroup.trim() } : { groupId };
    const fields = { ...group, color, textColor, lengthFrames, validFrom: from, validTo: to, validWeekdays: weekdays, fillGaps: fill, opensWithBreak: opens, note };
    m.mutate(editing ? { ...fields, name: name.trim() } : { ...fields, playlistId, names });
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width={520}
      title={editing ? `Edit ${editing.name}` : 'New block type'}
      description={editing ? `${editing.channelName} · ${editing.kind === 'main' ? 'Main' : 'Ads'} playlist. Blocks already in layouts keep their own start and length.` : `For ${playlistLabel}.`}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={m.isPending} onClick={submit}>
            {editing ? 'Save' : names.length > 1 ? `Create ${names.length}` : 'Create'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2.5">
        <SelectField label="Block group" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
          <option value="__new">New group…</option>
        </SelectField>
        {groupId === '__new' ? <TextField label="New group name" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} /> : <span />}
      </div>
      {!editing && (
        <Segmented
          label="One or several"
          size="sm"
          value={several}
          onChange={setSeveral}
          options={[
            { value: 'one', label: 'One block type' },
            { value: 'several', label: 'Several, numbered' },
          ]}
        />
      )}
      {several === 'one' || editing ? (
        <TextField label="Name" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      ) : (
        <>
          <div className="grid grid-cols-[1fr_90px_90px] gap-2.5">
            <TextField label="Base name" value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="1H Series Run Block" />
            <TextField label="First number" type="number" min={0} value={firstNo} onChange={(e) => setFirstNo(e.target.value)} />
            <TextField label="How many" type="number" min={1} max={200} value={count} onChange={(e) => setCount(e.target.value)} />
          </div>
          <span className="text-meta text-text-3">
            {names.length ? `${names.slice(0, 3).join(', ')}${names.length > 3 ? `, … ${names[names.length - 1]}` : ''}` : 'No names yet.'}
          </span>
        </>
      )}
      <div className="grid grid-cols-3 gap-2.5">
        <ColorField label="Colour" value={color} onChange={setColor} />
        <ColorField label="Text colour" value={textColor} onChange={setTextColor} />
        <TextField label="Length" className="[&_input]:mono" value={length} onChange={(e) => setLength(e.target.value)} />
      </div>
      <Field label="Valid on">
        <DayToggles label="Valid weekdays" tone="accent" size="sm" weekStart={ctx.channel.weekStart} value={weekdays} onToggle={(d) => setWeekdays(weekdays.map((v, i) => (i === d ? !v : v)))} />
      </Field>
      <DatePicker
        mode="range"
        label="Valid"
        width={400}
        weekStart={ctx.channel.weekStart}
        today={ctx.channel.today}
        from={from}
        to={to}
        onChange={(v) => {
          setFrom(v.from);
          setTo(v.to);
        }}
      />
      <SwitchRow title="Fill gaps from rotation list" description="Default for new blocks of this type" checked={fill} onChange={setFill} />
      <SwitchRow title="Opens with linked break" description="Default for new blocks of this type" checked={opens} onChange={setOpens} />
      <TextArea label="Note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      <span className="text-meta text-text-3">Limits per category come with Media.</span>
      {error && <Notice tone="amber">{error}</Notice>}
    </Dialog>
  );
}

export function DeleteBlockTypeDialog({ type, onOpenChange }: { type: BlockType | null; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [type]);
  const m = useMutation({
    mutationFn: () => api('DELETE', `/block-types/${type!.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.blockTypes() });
      toast('Block type deleted');
      onOpenChange(false);
    },
    onError: (e) => setError(errorText(e)),
  });
  return (
    <ConfirmDialog
      open={!!type}
      onOpenChange={onOpenChange}
      title={`Delete ${type?.name ?? ''}?`}
      description={error ?? 'It is no longer offered for new blocks. Layouts do not use it.'}
      confirmLabel="Delete"
      danger
      onConfirm={() => m.mutate()}
    />
  );
}

// ---------------------------------------------------------------- break lists

function describePositions(positions: number[]): string {
  if (!positions.length) return 'No breaks';
  return `${positions.length} ${positions.length === 1 ? 'break' : 'breaks'} · ${positions.map((k) => ordinal(k + 1)).join(', ')}`;
}

/** Example block for naming positions: the selected block, else the first block that has breaks around it. */
function exampleBlock(ctx: PageCtx, draft: TemplateDraft, selected: BlockDraft | null): BlockDraft | null {
  if (selected) return selected;
  return draft.blocks.find((b) => breaksInside(ctx.adsDays[b.weekday], b.startFrames, b.lengthFrames).length > 0) ?? null;
}

function PositionPicker({ ctx, draft, example, value, onChange }: { ctx: PageCtx; draft: TemplateDraft; example: BlockDraft | null; value: number[]; onChange: (v: number[]) => void }) {
  const win = example ? breaksInside(ctx.adsDays[example.weekday], example.startFrames, example.lengthFrames) : [];
  const most = Math.max(win.length, ...draft.blocks.map((b) => breaksInside(ctx.adsDays[b.weekday], b.startFrames, b.lengthFrames).length), ...value.map((k) => k + 1), 1);
  const n = Math.min(most, 40);
  return (
    <Field label="Breaks, by position inside a block's time" hint={example ? `Names are examples from ${dayName(example.weekday)} ${range(ctx, example)} (${typeName(ctx, example.blockTypeId)}).` : undefined}>
      <div className="grid max-h-[260px] grid-cols-2 gap-1.5 overflow-y-auto pt-1">
        {Array.from({ length: n }, (_, k) => (
          <Checkbox key={k} checked={value.includes(k)} onChange={(on) => onChange(on ? [...value, k].sort((a, b) => a - b) : value.filter((x) => x !== k))}>
            <span className="text-text">{ordinal(k + 1)}</span>
            {win[k] && <span className="truncate text-text-3">· {typeName(ctx, win[k].blockTypeId)}</span>}
          </Checkbox>
        ))}
      </div>
    </Field>
  );
}

export function BreakListsDialog({
  open,
  onOpenChange,
  ctx,
  draft,
  selected,
  lists,
  startWith,
  presetPositions,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ctx: PageCtx;
  draft: TemplateDraft;
  selected: BlockDraft | null;
  lists: BreakList[];
  /** "manage": the lists; "new": straight to a new list (optionally with positions from a block). */
  startWith: 'manage' | 'new';
  presetPositions?: number[];
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [mode, setMode] = useState<'manage' | 'new'>(startWith);
  const [name, setName] = useState('');
  const [positions, setPositions] = useState<number[]>([]);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<BreakList | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setMode(startWith);
    setName('');
    setPositions(presetPositions ?? []);
    setRenaming(null);
    setError(null);
  }, [open, startWith, presetPositions]);
  const refresh = () => qc.invalidateQueries({ queryKey: keys.breakLists(ctx.channel.id) });
  const create = useMutation({
    mutationFn: () => api<BreakList>('POST', `/channels/${ctx.channel.id}/break-lists`, { name: name.trim(), positions }),
    onSuccess: (l) => {
      refresh();
      toast(`List "${l.name}" saved`);
      if (startWith === 'new') onOpenChange(false);
      else setMode('manage');
    },
    onError: (e) => setError(errorText(e)),
  });
  const rename = useMutation({
    mutationFn: (r: { id: string; name: string }) => api('PATCH', `/break-lists/${r.id}`, { name: r.name.trim() }),
    onSuccess: () => {
      refresh();
      setRenaming(null);
    },
    onError: (e) => setError(errorText(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api('DELETE', `/break-lists/${id}`),
    onSuccess: () => {
      refresh();
      setConfirmDelete(null);
      toast('List deleted');
    },
    onError: (e) => setError(errorText(e)),
  });
  const example = exampleBlock(ctx, draft, selected);
  return (
    <>
      <Dialog
        open={open && !confirmDelete}
        onOpenChange={onOpenChange}
        width={500}
        title={mode === 'new' ? (presetPositions ? 'Save these breaks as a list' : 'New break list') : `Break lists of ${ctx.channel.name}`}
        description={
          mode === 'new'
            ? 'A list holds positions among the ads-template breaks inside a block’s time (1st, 2nd, …), so it fits every hour.'
            : 'Your team’s own lists for this channel. They are used by "Use a list" and "Add block".'
        }
        footer={
          mode === 'new' ? (
            <>
              <Button variant="ghost" onClick={() => (startWith === 'new' ? onOpenChange(false) : setMode('manage'))}>
                Cancel
              </Button>
              <Button variant="primary" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
                Save list
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button variant="primary" icon="plus" onClick={() => { setName(''); setPositions([]); setError(null); setMode('new'); }}>
                New list
              </Button>
            </>
          )
        }
      >
        {mode === 'new' ? (
          <>
            <TextField label="Name" value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="e.g. Hourly" />
            {presetPositions ? (
              <span className="text-small text-text-2">{describePositions(positions)}</span>
            ) : (
              <PositionPicker ctx={ctx} draft={draft} example={example} value={positions} onChange={setPositions} />
            )}
          </>
        ) : (
          <RowList>
            {lists.map((l) => (
              <div key={l.id} className="flex min-h-11 items-center gap-2 px-2.5 py-1">
                {renaming?.id === l.id ? (
                  <>
                    <input
                      autoFocus
                      aria-label="List name"
                      value={renaming.name}
                      onChange={(e) => setRenaming({ id: l.id, name: e.target.value })}
                      onKeyDown={(e) => e.key === 'Enter' && renaming.name.trim() && rename.mutate(renaming)}
                      className="h-8 min-w-0 flex-1 rounded-ctl border border-border-strong bg-surface px-2 text-small outline-none"
                    />
                    <Button size="sm" variant="primary" disabled={!renaming.name.trim()} onClick={() => rename.mutate(renaming)}>
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="flex min-w-0 flex-1 flex-col leading-[1.3]">
                      <span className="truncate text-small font-medium">{l.name}</span>
                      <span className="truncate text-meta text-text-3">{describePositions(l.positions)}</span>
                    </span>
                    <Button size="xs" variant="ghost" onClick={() => setRenaming({ id: l.id, name: l.name })}>
                      Rename
                    </Button>
                    <IconButton icon="close" size="xs" tone="quiet" label={`Delete ${l.name}`} onClick={() => setConfirmDelete(l)} />
                  </>
                )}
              </div>
            ))}
            {!lists.length && <div className="p-2.5 text-small text-text-3">No lists yet. Lists are each channel’s own; there are no built-in ones.</div>}
          </RowList>
        )}
        {error && <Notice tone="amber">{error}</Notice>}
      </Dialog>
      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title={`Delete "${confirmDelete?.name ?? ''}"?`}
        description="Blocks keep the breaks they already have."
        confirmLabel="Delete"
        danger
        onConfirm={() => confirmDelete && remove.mutate(confirmDelete.id)}
      />
    </>
  );
}

// ---------------------------------------------------------------- block details

export function BlockDetailsDialog({ open, onOpenChange, ctx, block }: { open: boolean; onOpenChange: (o: boolean) => void; ctx: PageCtx; block: BlockDraft | null }) {
  if (!block) return null;
  const t = ctx.types.get(block.blockTypeId);
  const g = t ? ctx.groups.get(t.groupId) : undefined;
  const rows: [string, string][] = [
    ['Block type', t?.name ?? '—'],
    ['Block group', g?.name ?? '—'],
    ['Owned by', t ? `${t.channelName} · ${t.kind === 'main' ? 'Main' : 'Ads'} playlist` : '—'],
    ['Day', dayName(block.weekday)],
    ['Start', clock(ctx, block.startFrames)],
    ['Length', `${lengthTc(ctx, block.lengthFrames)} (${lengthWords(ctx, block.lengthFrames)})`],
    ['End', clock(ctx, endOf(block))],
    ['Fill gaps from rotation list', block.fillGaps ? 'Yes — the rotation list is chosen when the playlist is filled' : 'No'],
    ['Opens with linked break', block.opensWithBreak ? 'Yes' : 'No'],
    ['Linked breaks', ctx.allowsBreaks ? String(block.breaks.length) : 'None (no ads playlist or an ads layout)'],
    ['Limits per category', block.limitsPerContentType.length ? `${block.limitsPerContentType.length} set` : 'None — set with Media'],
    ['Note', block.note || '—'],
    ['Block type valid', t ? `${formatDate(t.validFrom)} – ${formatDate(t.validTo)}` : '—'],
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t?.name ?? 'Block'} description={`${dayName(block.weekday)} · ${range(ctx, block)}`} width={480} footer={<Button onClick={() => onOpenChange(false)}>Close</Button>}>
      <dl className="m-0 grid grid-cols-[170px_minmax(0,1fr)] gap-x-3 gap-y-2 text-small">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-text-3">{k}</dt>
            <dd className="m-0 [overflow-wrap:anywhere]">{v}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
