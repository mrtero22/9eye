// The form panel of the Catalog page: the selected item's fields (or a new item), Cancel / Save.
// Unsaved edits are kept per item while the user looks at other items (catalog-page.md).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { frameRate, type CatalogLevel } from '@9eye/core';
import { api, ApiError, errorText } from '@/lib/api';
import type { CatalogItem, CatalogLookups } from '@/lib/types';
import {
  ChipsField,
  ColorField,
  FormGroup,
  FormPanel,
  Notice,
  NumberField,
  OptionalDateField,
  ReadValue,
  Req,
  SelectField,
  SwitchField,
  TextArea,
  TextField,
  TimecodeField,
  useToast,
} from '@/ui';
import { formGroups, NAME_KEY, newValues, type FieldDef } from './forms';
import { LEVELS } from './levels';
import { refreshCatalog, useItem } from './queries';

export type Edits = Record<string, Record<string, unknown>>;

const NEW_TITLE: Partial<Record<CatalogLevel, string>> = {
  'content-type': 'New category', content: 'New title', production: 'New item', segmentation: 'New cut', segment: 'New part',
  'rotation-list': 'New rotation list', 'graphic-source': 'New graphic source', 'graphic-template': 'New graphic template', 'graphic-object': 'New graphic object',
};

/** A template item's values for "Create from template": the same fields, the name with "(copy)". */
function copyOf(level: CatalogLevel, item: CatalogItem): Record<string, unknown> {
  const { id: _id, version: _v, ...rest } = item;
  const nk = NAME_KEY[level];
  return nk ? { ...rest, [nk]: `${String(rest[nk] ?? '')} (copy)` } : rest;
}

export function ItemForm({
  level,
  itemId,
  creating,
  parentId,
  parentName,
  lookups,
  edits,
  setEdit,
  nextChapter,
  nextCode,
  onSaved,
  onCancelCreate,
  onRelations,
}: {
  level: CatalogLevel | null;
  itemId: string | null;
  creating: { fromId: string | null } | null;
  parentId: string | null;
  parentName: string | null;
  lookups: CatalogLookups;
  edits: Edits;
  setEdit: (key: string, patch: Record<string, unknown> | null) => void;
  nextChapter: number;
  nextCode: number;
  onSaved: (level: CatalogLevel, id: string, created: boolean) => void;
  onCancelCreate: () => void;
  onRelations: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [groupsOpen, setGroupsOpen] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<ApiError | Error | null>(null);
  const source = useItem(level, creating ? creating.fromId : itemId);
  const key = level ? `${level}|${creating ? 'new' : itemId}` : '';
  const own = edits[key] ?? {};
  const rate = frameRate(lookups.frameRate);

  const base: Record<string, unknown> | null = !level
    ? null
    : creating
      ? creating.fromId
        ? source.data
          ? copyOf(level, source.data)
          : null
        : newValues(level, lookups, { parentId, nextChapter, nextCode })
      : (source.data ?? null);
  const values = base ? { ...base, ...own } : null;
  const dirty = Object.keys(own).length > 0;
  const set = (k: string, v: unknown) => {
    setError(null);
    setEdit(key, { ...own, [k]: v });
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!level || !values) return null;
      if (creating) return api<{ id: string }>('POST', `/catalog/items/${level}`, { ...values, parentId });
      await api('PUT', `/catalog/items/${level}/${itemId}`, values);
      return { id: itemId! };
    },
    onSuccess: async (r) => {
      if (!r || !level) return;
      setEdit(key, null);
      setError(null);
      toast(creating ? `${LEVELS[level].entity} created` : `${LEVELS[level].entity} saved`);
      await refreshCatalog(qc);
      onSaved(level, r.id, !!creating);
    },
    onError: (e) => setError(e as Error),
  });

  if (!level || (!creating && !itemId)) {
    return <FormPanel entity="" title="" dirty={false} emptyText="Select an item to see its fields" onCancel={() => {}} onSave={() => {}} saveLabel="Save" saveDisabled />;
  }
  const info = LEVELS[level];
  if (!values) {
    return <FormPanel entity={info.entity} title="" dirty={false} emptyText={source.isError ? errorText(source.error) : 'Loading…'} onCancel={() => {}} onSave={() => {}} saveLabel="Save" saveDisabled />;
  }
  const nk = NAME_KEY[level];
  const title = creating ? (NEW_TITLE[level] ?? 'New') : level === 'segment' ? `Part ${String(values.code ?? '')}` : String((nk ? values[nk] : values.name) ?? '');
  const groups = formGroups(level, values, lookups, !!creating, parentName);

  const field = (f: FieldDef, i: number) => {
    const val = 'key' in f ? values[f.key] : undefined;
    switch (f.k) {
      case 'text':
        return <TextField key={i} label={<Req required={f.req}>{f.label}</Req>} mono={f.mono} value={val == null ? '' : String(val)} onChange={(e) => set(f.key, f.key === 'season' && !e.target.value ? null : e.target.value)} hint={f.hint ? <span className={f.hintTone === 'amber' ? 'text-amber-text' : undefined}>{f.hint}</span> : undefined} />;
      case 'area':
        return <TextArea key={i} label={f.label} rows={f.rows ?? 3} className={f.mono ? '[&_textarea]:mono' : undefined} value={val == null ? '' : String(val)} onChange={(e) => set(f.key, e.target.value)} />;
      case 'int':
        return <NumberField key={i} label={f.label} required={f.req} nullable={f.nullable} value={val == null ? null : Number(val)} onChange={(v) => set(f.key, v)} />;
      case 'tc':
        return <TimecodeField key={i} label={f.label} required={f.req} nullable={f.nullable ?? true} rate={rate} value={val == null ? null : Number(val)} onChange={(v) => set(f.key, v)} hint={f.hint} hintTone={f.hintTone} />;
      case 'select':
        return (
          <SelectField key={i} label={<Req required={f.req}>{f.label}</Req>} value={val == null ? '' : String(val)} onChange={(e) => set(f.key, e.target.value || null)}>
            {(f.nullable || val == null) && <option value="">—</option>}
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </SelectField>
        );
      case 'switch':
        return <SwitchField key={i} label={f.label} checked={!!val} onChange={(v) => set(f.key, v)} />;
      case 'chips':
        return <ChipsField key={i} label={f.label} values={Array.isArray(val) ? (val as string[]) : []} options={f.options} hint={f.hint} onChange={(v) => set(f.key, v)} />;
      case 'color':
        return <ColorField key={i} label={<Req required={f.req}>{f.label}</Req>} value={val == null ? '#9b9b9b' : String(val)} onChange={(v) => set(f.key, v)} />;
      case 'date':
        return <OptionalDateField key={i} label={f.label} value={val == null ? null : String(val)} onChange={(v) => set(f.key, v)} weekStart={lookups.weekStart} today={lookups.today} />;
      case 'read':
        return <ReadValue key={i} label={f.label} value={f.value} required={f.req} mono={f.mono} hint={f.hint} actions={f.actions?.map((label) => ({ label, disabledReason: 'No MAM connected' }))} />;
      case 'custom': {
        const cv = (values.customValues ?? {}) as Record<string, string>;
        return (
          <TextField
            key={i}
            label={f.label}
            value={cv[f.key] ?? ''}
            onChange={(e) => {
              const next = { ...cv };
              if (e.target.value) next[f.key] = e.target.value;
              else delete next[f.key];
              set('customValues', next);
            }}
          />
        );
      }
    }
  };

  const problems = error instanceof ApiError ? error.problems : [];
  return (
    <FormPanel
      entity={info.entity}
      title={title}
      dirty={dirty || !!creating}
      onRelations={info.relations && !creating ? onRelations : undefined}
      onCancel={() => {
        setEdit(key, null);
        setError(null);
        if (creating) onCancelCreate();
      }}
      onSave={() => save.mutate()}
      saveLabel={creating ? 'Create' : 'Save'}
      saveDisabled={(!dirty && !creating) || save.isPending}
      error={
        error && (
          <Notice tone="red">
            <span>{errorText(error)}</span>
            {problems.length > 1 && (
              <ul className="m-0 pl-4">
                {problems.map((p) => (
                  <li key={p.message}>{p.message}</li>
                ))}
              </ul>
            )}
          </Notice>
        )
      }
    >
      {groups.map((g, gi) => {
        const gk = `${level}:${g.label}`;
        const open = groupsOpen[gk] ?? g.open;
        return (
          <FormGroup key={gk} label={g.label} count={g.fields.length} open={open} last={gi === groups.length - 1} onToggle={() => setGroupsOpen({ ...groupsOpen, [gk]: !open })}>
            {g.fields.map(field)}
          </FormGroup>
        );
      })}
    </FormPanel>
  );
}
