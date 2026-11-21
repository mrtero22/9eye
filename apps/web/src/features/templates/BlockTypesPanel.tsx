// "Block types" panel: the library of block types, grouped by block group.

import { useMemo, useState } from 'react';
import { typeInDates, type TemplateDraft } from '@9eye/core';
import type { BlockType } from '@/lib/types';
import { Button, Icon, IconButton, Menu, MenuItem, MenuSeparator, SearchField, Segmented, SelectField, Swatch, cx } from '@/ui';
import { lengthWords, type PageCtx } from './model';

type Scope = 'date' | 'all' | 'other';

export function BlockTypesPanel({
  ctx,
  draft,
  playlistId,
  onNew,
  onEdit,
  onDelete,
  onAddToTemplate,
  onDragType,
  armedId,
  onArm,
}: {
  ctx: PageCtx;
  draft: TemplateDraft;
  playlistId: string;
  onNew: () => void;
  onEdit: (t: BlockType) => void;
  onDelete: (t: BlockType) => void;
  onAddToTemplate: (t: BlockType) => void;
  /** A block type is dragged towards the week grid (null when the drag ends). */
  onDragType: (t: BlockType | null) => void;
  /** Click a block type to place it by clicking on the grid; click again to stop. */
  armedId: string | null;
  onArm: (t: BlockType | null) => void;
}) {
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<Scope>('date');
  const [channel, setChannel] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const pool = useMemo(() => {
    const all = [...ctx.types.values()];
    let xs = scope === 'other' ? all.filter((t) => t.channelId !== ctx.channel.id) : all.filter((t) => t.playlistId === playlistId);
    if (scope === 'date') xs = xs.filter((t) => typeInDates(t, draft.validFrom, draft.validTo));
    return xs;
  }, [ctx, scope, playlistId, draft.validFrom, draft.validTo]);
  const channels = useMemo(() => [...new Map(pool.map((t) => [t.channelId, t.channelName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [pool]);
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const xs = pool.filter((t) => (!channel || t.channelId === channel) && (!needle || t.name.toLowerCase().includes(needle)));
    const by = new Map<string, BlockType[]>();
    for (const t of xs) by.set(t.groupId, [...(by.get(t.groupId) ?? []), t]);
    return [...by.entries()]
      .map(([id, items]) => ({ id, group: ctx.groups.get(id), items: items.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })) }))
      .sort((a, b) => (a.group?.name ?? '').localeCompare(b.group?.name ?? ''));
  }, [pool, channel, q, ctx.groups]);
  const searching = q.trim().length > 0;

  return (
    <div className="flex flex-col gap-3 px-4 pb-4 pt-3">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <SearchField value={q} onChange={setQ} placeholder="Search" label="Search block types" />
        </div>
        <Button variant="primary" size="md" className="!px-2.5 text-small" onClick={onNew}>
          New
        </Button>
      </div>
      <Segmented
        label="Which block types"
        size="sm"
        value={scope}
        onChange={(v) => {
          setScope(v);
          setChannel('');
        }}
        options={[
          { value: 'date', label: 'In date', hint: "Block types valid in this layout's dates" },
          { value: 'all', label: 'All dates', hint: "Also block types outside this layout's dates" },
          { value: 'other', label: 'Other channels', hint: 'Block types of other channels' },
        ]}
      />
      <SelectField label={<span className="sr-only">Channel filter</span>} value={channel} onChange={(e) => setChannel(e.target.value)}>
        <option value="">All channels</option>
        {channels.map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </SelectField>
      <div className="max-h-[560px] overflow-y-auto">
        {groups.map(({ id, group, items }) => {
          const isOpen = searching || !!open[id];
          return (
            <div key={id} className="mb-1">
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen({ ...open, [id]: !open[id] })}
                className="hov flex h-row w-full cursor-pointer items-center gap-2 rounded-ctl border-0 bg-transparent px-2 text-left text-small font-medium"
              >
                <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={13} className="text-text-3" />
                <Swatch color={group?.color ?? items[0]?.color} />
                <span className="min-w-0 flex-1 truncate">{group?.name ?? 'No group'}</span>
                <span className="mono text-tiny text-text-3">{items.length}</span>
              </button>
              {isOpen && (
                <div className="flex flex-col pb-1.5 pl-[30px] pt-0.5">
                  {items.map((t) => (
                    <div
                      key={t.id}
                      draggable={t.kind === ctx.kind}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'copyMove';
                        e.dataTransfer.setData('text/plain', t.name);
                        onDragType(t);
                      }}
                      onDragEnd={() => onDragType(null)}
                      title={t.kind === ctx.kind ? 'Drag onto a day to add a block' : undefined}
                      className={cx('hov flex min-h-[30px] items-center gap-2 rounded-ctl pl-2 pr-1 text-small', t.id === armedId && 'bg-accent-soft', t.kind === ctx.kind && 'active:cursor-grabbing')}
                    >
                      <button
                        type="button"
                        aria-pressed={t.id === armedId}
                        disabled={t.kind !== ctx.kind}
                        onClick={() => onArm(t.id === armedId ? null : t)}
                        className={cx('min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent p-0 text-left', t.id === armedId && 'font-semibold text-accent-text')}
                        title={`${t.name} · ${lengthWords(ctx, t.lengthFrames)}${scope === 'other' ? ` · ${t.channelName}` : ''}${t.kind === ctx.kind ? ' — click to place it on the grid, or drag it onto a day' : ''}`}
                      >
                        {t.name}
                        {scope === 'other' && <span className="font-normal text-text-3"> · {t.channelName}</span>}
                      </button>
                      <Menu label={`${t.name} actions`} width={220} trigger={<IconButton icon="more" size="xs" tone="quiet" label={`${t.name} actions`} />}>
                        <MenuItem onSelect={() => onAddToTemplate(t)} disabled={t.kind !== ctx.kind}>
                          Add to this layout…
                        </MenuItem>
                        <MenuItem onSelect={() => onEdit(t)}>Edit…</MenuItem>
                        <MenuSeparator />
                        <MenuItem danger disabled={t.usedCount > 0} title={t.usedCount ? `Used by ${t.usedCount} blocks in layouts` : undefined} onSelect={() => onDelete(t)}>
                          {t.usedCount ? `Delete (used by ${t.usedCount})` : 'Delete…'}
                        </MenuItem>
                      </Menu>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {!groups.length && <span className="block px-2 py-1.5 text-small text-text-3">No block types here.</span>}
      </div>
    </div>
  );
}
