// Admin → Break positions (spec commercials §7): where in an ad break a booked spot goes, 1 = the
// start of the break. The list is edited here and saved as a whole: order (drag, or the arrow keys
// on a row's grip), the one default, colour, price modifier and the content types that may take a
// position (none = any).

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, errorText } from '@/lib/api';
import { keys } from '@/lib/queries';
import type { BreakPosition, ContentType } from '@/lib/types';
import { Badge, Button, ChipsField, ColorField, EmptyState, IconButton, Notice, NumberField, SectionHead, SidePanel, SortableTable, Swatch, SwitchRow, TextField, useToast } from '@/ui';

const ALL_FAMILIES = 'program,filling,advert';
const NEW_COLOR = '#9b9b9b';

interface Draft {
  /** The saved id, or a key of its own for a new position. */
  key: string;
  id: string | null;
  version: number | null;
  name: string;
  isDefault: boolean;
  color: string | null;
  priceModifier: number;
  contentTypeIds: string[];
}

const toDraft = (p: BreakPosition): Draft => ({
  key: p.id,
  id: p.id,
  version: p.version,
  name: p.name,
  isDefault: p.isDefault,
  color: p.color,
  priceModifier: p.priceModifier,
  contentTypeIds: p.contentTypeIds,
});
const sameFields = (a: Draft, b: Draft) =>
  a.name === b.name && a.isDefault === b.isDefault && a.color === b.color && a.priceModifier === b.priceModifier && JSON.stringify(a.contentTypeIds) === JSON.stringify(b.contentTypeIds);
const percent = (n: number) => (n === 0 ? '—' : `${n > 0 ? '+' : ''}${n} %`);

export function BreakPositionsSection() {
  const qc = useQueryClient();
  const toast = useToast();
  const saved = useQuery({ queryKey: keys.breakPositions(), queryFn: () => api<BreakPosition[]>('GET', '/admin/break-positions') });
  const types = useQuery({ queryKey: keys.catalogTypes(ALL_FAMILIES), queryFn: () => api<ContentType[]>('GET', `/catalog/types?families=${ALL_FAMILIES}`) });

  const base = useMemo(() => (saved.data ?? []).map(toDraft), [saved.data]);
  const [rows, setRows] = useState<Draft[]>([]);
  const [deleted, setDeleted] = useState<string[]>([]);
  // the list was edited here: a refetch must not replace the edits (saving then says someone else changed it)
  const [touched, setTouched] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<ApiError | null>(null);
  const [conflict, setConflict] = useState(false);
  useEffect(() => {
    if (touched) return;
    setRows(base);
    setDeleted([]);
  }, [base, touched]);

  // what is different from the saved list: each added, removed or edited position, and the order once
  const changes = useMemo(() => {
    let n = deleted.length;
    for (const r of rows) {
      const was = base.find((b) => b.key === r.key);
      if (!was || !sameFields(r, was)) n++;
    }
    const keptBefore = base.filter((b) => !deleted.includes(b.key)).map((b) => b.key);
    const keptNow = rows.filter((r) => r.id).map((r) => r.key);
    if (keptBefore.join() !== keptNow.join()) n++;
    return n;
  }, [rows, deleted, base]);
  const unnamed = rows.filter((r) => !r.name.trim()).length;

  useEffect(() => {
    if (!changes) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [changes]);

  const save = useMutation({
    mutationFn: () =>
      api<BreakPosition[]>('PUT', '/admin/break-positions', {
        rows: rows.map((r) => ({ id: r.id, version: r.version, name: r.name, isDefault: r.isDefault, color: r.color, priceModifier: r.priceModifier, contentTypeIds: r.contentTypeIds })),
        deletedIds: deleted,
      }),
    onSuccess: (list) => {
      // the saved list is in the order sent, so the open row keeps its place
      const was = rows.findIndex((r) => r.key === open);
      qc.setQueryData(keys.breakPositions(), list);
      setRows(list.map(toDraft));
      setDeleted([]);
      setTouched(false);
      setOpen(was >= 0 ? (list[was]?.id ?? null) : null);
      toast('Break positions saved');
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) setConflict(true);
      else setRefusal(e instanceof ApiError ? e : new ApiError(0, errorText(e), []));
    },
  });

  const edit = (key: string, patch: Partial<Draft>) => {
    setTouched(true);
    // one default: turning it on for a position turns it off for the others
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : patch.isDefault ? { ...r, isDefault: false } : r)));
  };
  const move = (from: number, to: number) => {
    setTouched(true);
    setRows((rs) => {
      const next = [...rs];
      const [r] = next.splice(from, 1);
      next.splice(to, 0, r);
      return next;
    });
  };
  const add = () => {
    const key = `new-${Date.now()}`;
    setTouched(true);
    setRows((rs) => [...rs, { key, id: null, version: null, name: '', isDefault: rs.length === 0, color: NEW_COLOR, priceModifier: 0, contentTypeIds: [] }]);
    setOpen(key);
  };
  const remove = (r: Draft) => {
    setTouched(true);
    setRows((rs) => rs.filter((x) => x.key !== r.key));
    if (r.id) setDeleted((d) => [...d, r.id!]);
    setOpen(null);
  };
  const discard = () => {
    setRows(base);
    setDeleted([]);
    setTouched(false);
    setRefusal(null);
    setOpen((k) => (base.some((b) => b.key === k) ? k : null));
  };

  const typeOptions = (types.data ?? []).map((t) => ({ value: t.id, label: t.name }));
  const typeName = (id: string) => types.data?.find((t) => t.id === id)?.name ?? 'Unknown type';
  const current = rows.find((r) => r.key === open) ?? null;
  const index = current ? rows.indexOf(current) : -1;

  return (
    <>
      <SectionHead title="Break positions" description="Where in an ad break a booked spot goes; 1 is the start of the break. New spots get the default position.">
        {changes > 0 && (
          <Badge tone="amber" round>
            {changes === 1 ? '1 change' : `${changes} changes`}
          </Badge>
        )}
        {changes > 0 && (
          <Button variant="ghost" onClick={discard}>
            Discard
          </Button>
        )}
        <Button variant={changes ? 'secondary' : 'primary'} icon="plus" onClick={add}>
          Add position
        </Button>
        {changes > 0 && (
          <Button variant="primary" disabled={unnamed > 0 || save.isPending} title={unnamed ? 'Every position needs a name' : undefined} onClick={() => { setRefusal(null); save.mutate(); }}>
            Save changes
          </Button>
        )}
      </SectionHead>

      {saved.error && <Notice tone="red">{errorText(saved.error)}</Notice>}
      {conflict && (
        <Notice
          tone="amber"
          action={
            <Button size="sm" onClick={() => { setConflict(false); setOpen(null); setTouched(false); void saved.refetch(); }}>
              Reload
            </Button>
          }
        >
          Someone else changed the break positions since you opened them. Reload to see their changes; yours here will be lost.
        </Notice>
      )}
      {refusal && (
        <Notice tone="red">
          <span className="font-medium">{refusal.message}</span>
          {refusal.problems.length > 1 && (
            <ul className="m-0 flex flex-col gap-1 pl-4">
              {refusal.problems.map((p, i) => (
                <li key={i}>{p.message}</li>
              ))}
            </ul>
          )}
        </Notice>
      )}

      {saved.isSuccess && rows.length === 0 && (
        <EmptyState action={<Button icon="plus" onClick={add}>Add position</Button>}>No break positions yet. Booked spots then go into a break in the order they come.</EmptyState>
      )}

      {rows.length > 0 && (
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-2">
            <SortableTable
              columns="44px minmax(180px, 1.6fr) 90px minmax(140px, 1fr)"
              head={['Order', 'Name', 'Price', 'Categories']}
              selected={open}
              onOpen={(k) => setOpen((o) => (o === k ? null : k))}
              onMove={move}
              rows={rows.map((r, i) => ({
                key: r.key,
                label: r.name || `position ${i + 1}`,
                cells: [
                  <span key="o" className="mono text-text-2">
                    {i + 1}
                  </span>,
                  <span key="n" className="flex min-w-0 items-center gap-2">
                    <Swatch color={r.color} size={10} />
                    <span className={r.name.trim() ? 'truncate font-medium' : 'italic text-amber-text'}>{r.name.trim() || 'No name'}</span>
                    {r.isDefault && <Badge tone="accent">Default</Badge>}
                    {!r.id && <Badge>New</Badge>}
                  </span>,
                  <span key="p" className="mono text-text-2">
                    {percent(r.priceModifier)}
                  </span>,
                  <span key="t" className="block truncate text-text-2">
                    {r.contentTypeIds.length ? r.contentTypeIds.map(typeName).join(', ') : <span className="text-text-3">Any</span>}
                  </span>,
                ],
              }))}
            />
            <span className="text-small text-text-3">Drag a row by its handle to change the order, or focus the handle and use the arrow keys.</span>
          </div>

          {current && (
            <SidePanel title={current.name.trim() || 'New position'} onClose={() => setOpen(null)}>
              <div className="flex flex-col gap-4 p-4">
                <TextField label="Name" value={current.name} autoFocus={!current.id} maxLength={500} error={current.name.trim() ? undefined : 'A name is required.'} onChange={(e) => edit(current.key, { name: e.target.value })} />
                <div className="flex items-end gap-3">
                  <ColorField label="Colour" value={current.color ?? NEW_COLOR} onChange={(color) => edit(current.key, { color })} />
                  <span className="flex flex-col gap-1 text-meta text-text-2">
                    Plan
                    <span className="flex h-8 items-center gap-1">
                      <span className="mono px-1 text-small text-text">
                        {index + 1} of {rows.length}
                      </span>
                      <IconButton icon="chevronUp" size="sm" label="Move up" disabled={index === 0} onClick={() => move(index, index - 1)} />
                      <IconButton icon="chevronDown" size="sm" label="Move down" disabled={index === rows.length - 1} onClick={() => move(index, index + 1)} />
                    </span>
                  </span>
                </div>
                <SwitchRow
                  title="Default position"
                  description={current.isDefault ? 'New booked spots get this position.' : 'Make it the one new booked spots get.'}
                  checked={current.isDefault}
                  onChange={(on) => edit(current.key, { isDefault: on })}
                />
                <NumberField
                  label="Price modifier"
                  value={current.priceModifier}
                  min={-100}
                  max={10000}
                  decimals={2}
                  suffix="%"
                  hint="Added to the price of a spot in this position; below 0 it is taken off."
                  onChange={(v) => edit(current.key, { priceModifier: v ?? 0 })}
                />
                <ChipsField
                  label="Categories"
                  values={current.contentTypeIds}
                  options={typeOptions}
                  hint="Only spots of these types may take the position. None chosen: any type may."
                  onChange={(contentTypeIds) => edit(current.key, { contentTypeIds })}
                />
              </div>
              <div className="mt-auto flex justify-between border-t border-hairline px-4 py-3">
                <Button variant="danger" onClick={() => remove(current)}>
                  Remove position
                </Button>
                <Button variant="ghost" onClick={() => setOpen(null)}>
                  Done
                </Button>
              </div>
            </SidePanel>
          )}
        </div>
      )}
    </>
  );
}
