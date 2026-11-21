// The one catalog picker of 9eye (docs/design/catalog-picker.md, mockup the CatalogPicker mockup (private)): a
// dialog over the page with the catalog's path (content types → contents → productions) and a search.
// Picks a series (one content, its episodes in order), several items, or exactly one item.

import * as RDialog from '@radix-ui/react-dialog';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { formatLength, formatTc, frameRate as rateOf } from '@9eye/core';
import { api } from '@/lib/api';
import { keys } from '@/lib/queries';
import type { CatalogContent, CatalogFamily, CatalogSearchHit, ContentType, Production } from '@/lib/types';
import { cx } from './cx';
import { dayText } from './dates';
import { Icon } from './icons';
import { ToggleChip } from './ToggleChip';

export type CatalogPickMode = 'series' | 'items' | 'one';

export interface CatalogPickItem {
  productionId: string;
  contentId: string;
  content: string;
  title: string;
  chapter: number | null;
  houseId: string;
  lengthFrames: number | null;
}

export interface CatalogPick {
  mode: CatalogPickMode;
  /** Series pick: the content whose episodes were taken. */
  content: { id: string; title: string } | null;
  type: { id: string; name: string } | null;
  items: CatalogPickItem[];
}

export interface CatalogPickerProps {
  pick: CatalogPickMode;
  /** Kinds that may be picked; `graphics` opens the graphics catalog. */
  families: (CatalogFamily | 'graphics')[];
  /** Frame rate the lengths are shown in (the channel's). */
  frameRate: string;
  startType?: string | null;
  startContent?: string | null;
  /** Production ids already in the order: marked "In this order", not pickable. */
  already?: string[];
  /** Day the items should be valid on. */
  date?: string | null;
  title?: string;
  context?: string;
  trigger?: string;
  triggerStyle?: 'dashed' | 'button' | 'small' | 'none';
  /** In a form: after the pick the field shows what was taken, with Change. */
  showResult?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onPick: (r: CatalogPick) => void;
  onClose?: () => void;
}

const FAMILY_LABEL: Record<CatalogFamily, string> = { program: 'Programmes', filling: 'Fillers & trailers', advert: 'Ads' };
const FAMILY_DOT: Record<CatalogFamily, string> = { program: 'bg-[var(--ct-program)]', filling: 'bg-[var(--ct-promo)]', advert: 'bg-[var(--ct-commercial)]' };
const plural = (n: number, u: string) => `${n} ${u}${n === 1 ? '' : 's'}`;
const TITLES: Record<CatalogPickMode, string> = { series: 'Pick a series', items: 'Pick items', one: 'Pick one item' };

/** A short length: "4 h 27 min", "12 min 05 s", "10 s". */
function lengthText(frames: number, rate: string): string {
  const r = rateOf(rate);
  const s = Math.round(frames / r.nominal);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  if (h) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m) return `${m} min ${String(rest).padStart(2, '0')} s`;
  return formatLength(frames, r);
}

export function CatalogPicker(props: CatalogPickerProps) {
  const { pick, families, frameRate, already = [], date, triggerStyle = 'dashed', showResult = false } = props;
  const [ownOpen, setOwnOpen] = useState(false);
  const open = props.open ?? ownOpen;
  const setOpen = (o: boolean) => {
    if (props.open === undefined) setOwnOpen(o);
    props.onOpenChange?.(o);
    if (!o) props.onClose?.();
  };
  const [result, setResult] = useState<CatalogPick | null>(null);
  const famList = families.filter((f): f is CatalogFamily => f !== 'graphics');
  const graphicsOnly = families.length > 0 && famList.length === 0;
  const resultCard = showResult && result && (
    <div className="flex items-start gap-2.5 rounded-item border border-border bg-surface px-3 py-2.5">
      <span className={cx('mt-[7px] size-2 shrink-0 rounded-[2px]', FAMILY_DOT[famList[0] ?? 'program'])} />
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="font-medium [overflow-wrap:anywhere]">{result.mode === 'series' ? result.content?.title : result.mode === 'one' ? result.items[0]?.title : plural(result.items.length, 'item')}</span>
        <span className="text-meta text-text-3">
          {result.mode === 'series'
            ? `${plural(result.items.length, 'episode')} · ${result.type?.name ?? ''}`
            : result.mode === 'one'
              ? `${result.items[0]?.houseId} · ${result.items[0]?.content}`
              : `${result.items.slice(0, 3).map((i) => i.title).join(', ')}${result.items.length > 3 ? ' …' : ''}`}
        </span>
      </span>
      <button type="button" onClick={() => setOpen(true)} className="hov h-[26px] shrink-0 cursor-pointer rounded-ctl border border-border-strong bg-surface px-2 text-meta font-medium">
        Change
      </button>
    </div>
  );
  const trigger =
    triggerStyle === 'none' ? null : (
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={cx(
          'ctl hov inline-flex cursor-pointer items-center gap-1.5 font-medium text-text',
          triggerStyle === 'dashed' && 'h-9 w-full justify-center rounded-item border border-dashed border-border-strong bg-transparent text-small',
          triggerStyle === 'small' && 'h-[26px] self-start rounded-ctl border border-border-strong bg-surface px-2 text-meta',
          triggerStyle === 'button' && 'h-ctl self-start rounded-ctl border border-border-strong bg-surface px-3',
        )}
      >
        <Icon name="catalog" size={14} />
        {props.trigger ?? 'Pick from Media…'}
      </button>
    );
  return (
    <>
      {resultCard || trigger}
      <RDialog.Root open={open} onOpenChange={setOpen}>
        <RDialog.Portal>
          <RDialog.Overlay className="fixed inset-0 z-50 bg-overlay" />
          <RDialog.Content
            className="fixed left-1/2 top-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-panel border border-border bg-surface shadow-pop outline-none"
            style={{ width: 'min(1240px, calc(100vw - 64px))', height: 'min(760px, calc(100vh - 64px))' }}
            aria-describedby={undefined}
          >
            {open && (
              <PickerBody
                {...props}
                pick={pick}
                famList={famList}
                graphicsOnly={graphicsOnly}
                frameRate={frameRate}
                already={already}
                date={date ?? null}
                onCancel={() => setOpen(false)}
                onUse={(r) => {
                  setResult(r);
                  setOpen(false);
                  props.onPick(r);
                }}
              />
            )}
          </RDialog.Content>
        </RDialog.Portal>
      </RDialog.Root>
    </>
  );
}

function PickerBody({
  pick,
  famList,
  graphicsOnly,
  frameRate,
  already,
  date,
  startType,
  startContent,
  title,
  context,
  onCancel,
  onUse,
}: CatalogPickerProps & { famList: CatalogFamily[]; graphicsOnly: boolean; already: string[]; date: string | null; onCancel: () => void; onUse: (r: CatalogPick) => void }) {
  const series = pick === 'series';
  const multi = pick !== 'one';
  const rate = rateOf(frameRate);
  const [fam, setFam] = useState<CatalogFamily>(famList[0] ?? 'program');
  const [typeId, setTypeId] = useState<string | null>(startType ?? null);
  const [contentId, setContentId] = useState<string | null>(startContent ?? null);
  const [q, setQ] = useState('');
  const [ready, setReady] = useState(false);
  const [validOnly, setValidOnly] = useState(false);
  /** Ticked items (items / one), kept while browsing other contents. */
  const [picked, setPicked] = useState<Map<string, CatalogPickItem>>(new Map());
  /** Series: null = all selectable episodes of the content (the default). */
  const [seriesSel, setSeriesSel] = useState<Set<string> | null>(null);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [focus, setFocus] = useState(0);
  const [listFocused, setListFocused] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const alreadySet = useMemo(() => new Set(already), [already]);

  const famKey = famList.join(',');
  const types = useQuery({ queryKey: keys.catalogTypes(famKey), queryFn: () => api<ContentType[]>('GET', `/catalog/types?families=${famKey}`), enabled: !graphicsOnly });
  const typesOfFam = (types.data ?? []).filter((t) => t.family === fam);
  const type = typesOfFam.find((t) => t.id === typeId) ?? typesOfFam.find((t) => t.contentCount > 0) ?? typesOfFam[0] ?? null;
  const contents = useQuery({ queryKey: keys.catalogContents(type?.id ?? null), queryFn: () => api<CatalogContent[]>('GET', `/catalog/types/${type!.id}/contents`), enabled: !!type });
  const prods = useQuery({
    queryKey: keys.catalogProductions(contentId),
    queryFn: () => api<{ content: CatalogContent & { typeName: string }; productions: Production[] }>('GET', `/catalog/contents/${contentId}/productions`),
    enabled: !!contentId,
  });
  // Opened on a content (e.g. the order's own): show its type too.
  useEffect(() => {
    const c = prods.data?.content;
    if (c && c.contentTypeId !== type?.id && c.id === startContent) {
      setTypeId(c.contentTypeId);
      const t = (types.data ?? []).find((x) => x.id === c.contentTypeId);
      if (t) setFam(t.family);
    }
  }, [prods.data, types.data, startContent, type?.id]);
  const query = q.trim();
  const search = useQuery({
    queryKey: keys.catalogSearch(query, famKey),
    queryFn: () => api<{ contents: (CatalogContent & { typeName: string })[]; productions: CatalogSearchHit[] }>('GET', `/catalog/search?families=${famKey}&q=${encodeURIComponent(query)}`),
    enabled: !!query && !graphicsOnly,
  });

  const content = prods.data && prods.data.content.id === contentId ? prods.data.content : null;
  const all = content ? prods.data!.productions : [];
  const templates = all.filter((p) => p.isTemplate).length;
  const notValid = (p: Production) => !!date && ((!!p.starts && p.starts > date) || (!!p.expires && p.expires < date));
  const visible = all.filter((p) => !p.isTemplate && (!ready || p.mediaStatus === 'ready') && (!validOnly || !notValid(p)));
  const selectable = visible.filter((p) => !alreadySet.has(p.id));
  const isEpisodeType = series || /series/i.test(type?.name ?? '');
  const unit = isEpisodeType ? 'episode' : 'item';

  const toItem = (p: Production, contentTitle: string): CatalogPickItem => ({
    productionId: p.id, contentId: p.contentId, content: contentTitle, title: p.title, chapter: p.chapter, houseId: p.code, lengthFrames: p.lengthFrames,
  });
  const seriesPicked = (): Production[] => (seriesSel === null ? selectable : selectable.filter((p) => seriesSel.has(p.id)));
  const isOn = (p: Production) => (series ? (seriesSel === null ? !alreadySet.has(p.id) : seriesSel.has(p.id)) : picked.has(p.id));
  const toggle = (p: Production, contentTitle: string) => {
    if (alreadySet.has(p.id)) return;
    if (series) {
      const base = new Set(seriesSel ?? selectable.map((x) => x.id));
      if (base.has(p.id)) base.delete(p.id);
      else base.add(p.id);
      setSeriesSel(base);
      setRange(null);
      return;
    }
    if (pick === 'one') {
      setPicked(new Map([[p.id, toItem(p, contentTitle)]]));
      return;
    }
    const next = new Map(picked);
    if (next.has(p.id)) next.delete(p.id);
    else next.set(p.id, toItem(p, contentTitle));
    setPicked(next);
  };
  const openContent = (id: string, tId?: string) => {
    setContentId(id);
    if (tId) setTypeId(tId);
    setFocus(0);
    if (series) {
      setSeriesSel(null);
      setRange(null);
    }
  };

  const chapters = visible.filter((p) => p.chapter !== null).map((p) => p.chapter!);
  const rangeFrom = range?.from ?? (chapters.length ? String(Math.min(...chapters)) : '');
  const rangeTo = range?.to ?? (chapters.length ? String(Math.max(...chapters)) : '');
  const applyRange = (a: string, b: string) => {
    setRange({ from: a, to: b });
    const lo = Number(a);
    const hi = Number(b);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return;
    setSeriesSel(new Set(selectable.filter((p) => p.chapter !== null && p.chapter >= lo && p.chapter <= hi).map((p) => p.id)));
  };
  const allOn = selectable.length > 0 && selectable.every(isOn);
  const toggleAll = () => {
    if (series) {
      setSeriesSel(allOn ? new Set() : null);
      setRange(null);
      return;
    }
    const next = new Map(picked);
    for (const p of selectable) {
      if (allOn) next.delete(p.id);
      else next.set(p.id, toItem(p, content!.title));
    }
    setPicked(next);
  };

  // ---------------------------------------------------------------- what will be taken
  const items: CatalogPickItem[] = series ? (content ? seriesPicked().map((p) => toItem(p, content.title)) : []) : [...picked.values()];
  const n = items.length;
  const known = items.filter((i) => i.lengthFrames);
  const total = known.reduce((s, i) => s + (i.lengthFrames ?? 0), 0);
  let sumMain = 'Nothing picked yet';
  let sumSub = '';
  if (n) {
    if (series) {
      const eps = items.map((i) => i.chapter).filter((c): c is number => c !== null);
      sumMain = `${content!.title} · ${plural(n, 'episode')}${eps.length ? ` (${eps.length > 1 ? `${Math.min(...eps)}–${Math.max(...eps)}` : eps[0]})` : ''}`;
    } else if (pick === 'one') sumMain = items[0].title;
    else sumMain = `${plural(n, 'item')} from ${plural(new Set(items.map((i) => i.contentId)).size, 'content')}`;
    sumSub = `${known.length ? `${lengthText(total, frameRate)} known` : 'No length known'}${known.length < n ? ` · ${n - known.length} without a length in the catalog` : ''}`;
  } else if (series && content && visible.length && selectable.length === 0) {
    sumMain = 'Nothing new to add';
    sumSub = `Every episode of ${content.title} is already in this plan.`;
  }
  const confirmLabel = pick === 'one' ? 'Pick' : series ? (n ? `Use ${plural(n, 'episode')}` : 'Use episodes') : n ? `Add ${plural(n, 'item')}` : 'Add items';
  const use = () => {
    if (!n) return;
    onUse({ mode: pick, content: series && content ? { id: content.id, title: content.title } : null, type: type ? { id: type.id, name: type.name } : null, items });
  };

  // ---------------------------------------------------------------- rows
  const row = (p: Production, contentTitle: string, i: number, focusable: boolean) => {
    const inOrder = alreadySet.has(p.id);
    const on = isOn(p);
    const noLength = !p.lengthFrames;
    const tags: { label: string; tone: 'neutral' | 'amber' }[] = [];
    if (inOrder) tags.push({ label: 'In this plan', tone: 'neutral' });
    if (noLength) tags.push({ label: 'No length in Media', tone: 'amber' });
    if (p.mediaStatus === 'not-ready') tags.push({ label: 'Media not ready', tone: 'amber' });
    if (notValid(p) && date) tags.push({ label: `Not valid on ${dayText(date)}`, tone: 'amber' });
    return (
      <div
        key={p.id}
        role="option"
        aria-selected={on}
        aria-disabled={inOrder}
        title={inOrder ? 'Already in this plan' : noLength ? 'The catalog has no length for this item; the playlist will warn' : undefined}
        onClick={() => !inOrder && toggle(p, contentTitle)}
        className={cx('hov grid min-h-[34px] grid-cols-[22px_34px_minmax(0,1fr)_128px_96px] items-center gap-x-2.5 rounded-ctl px-2 text-small', on ? 'bg-accent-soft' : 'bg-transparent', inOrder ? 'cursor-default opacity-50' : 'cursor-pointer')}
        style={{ outline: focusable && listFocused && i === focus ? '2px solid var(--accent)' : 'none', outlineOffset: -2 }}
      >
        <span aria-hidden="true" className={cx('inline-flex size-4 items-center justify-center border-[1.5px] text-on-accent', multi ? 'rounded-[4px]' : 'rounded-full', on ? 'border-accent bg-accent' : 'border-border-strong bg-surface')}>
          {on && (multi ? <Icon name="check" size={10} strokeWidth={3.5} /> : <span className="size-1.5 rounded-full bg-on-accent" />)}
        </span>
        <span className="mono text-right text-meta text-text-3">{p.chapter ?? ''}</span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">{p.title}</span>
          {tags.map((t) => (
            <span key={t.label} className={cx('inline-flex h-[18px] shrink-0 items-center rounded-badge px-1.5 text-tiny font-medium', t.tone === 'amber' ? 'bg-amber-soft text-amber-text' : 'bg-surface-3 text-text-2')}>
              {t.label}
            </span>
          ))}
        </span>
        <span className="mono truncate text-[11.5px] text-text-3">{p.code}</span>
        <span className={cx('mono text-right text-meta', noLength ? 'text-amber-text' : 'text-text-2')}>{noLength ? 'no length' : formatTc(p.lengthFrames!, rate)}</span>
      </div>
    );
  };

  const listKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') setFocus((f) => Math.min(visible.length - 1, f + 1));
    else if (e.key === 'ArrowUp') setFocus((f) => Math.max(0, f - 1));
    else if (e.key === ' ') {
      const p = visible[focus];
      if (p && content) toggle(p, content.title);
    } else if (e.key === 'Enter') use();
    else return;
    e.preventDefault();
  };

  const searching = !!query && !graphicsOnly;
  const hitGroups = useMemo(() => {
    const out: { path: string; contentTitle: string; rows: CatalogSearchHit[] }[] = [];
    for (const p of search.data?.productions ?? []) {
      if (ready && p.mediaStatus !== 'ready') continue;
      const path = `${p.typeName} › ${p.contentTitle}`;
      const g = out.find((x) => x.path === path);
      if (g) g.rows.push(p);
      else out.push({ path, contentTitle: p.contentTitle, rows: [p] });
    }
    return out;
  }, [search.data, ready]);

  const meta = content
    ? [
        plural(visible.length, unit),
        templates ? `${templates} layout ${unit} hidden` : '',
        visible.filter((p) => !p.lengthFrames).length ? `${visible.filter((p) => !p.lengthFrames).length} without a length` : '',
        visible.filter((p) => alreadySet.has(p.id)).length ? `${visible.filter((p) => alreadySet.has(p.id)).length} already in this plan` : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : '';
  const allAlready = !!content && visible.length > 0 && selectable.length === 0;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(e) => {
        if (e.key === '/' && document.activeElement !== searchRef.current) {
          e.preventDefault();
          searchRef.current?.focus();
        }
      }}
    >
      <div className="flex items-start gap-3 pb-2.5 pl-[18px] pr-3 pt-3.5">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <RDialog.Title className="m-0 text-section font-semibold tracking-[-0.01em]">{title ?? TITLES[pick]}</RDialog.Title>
          <span className="text-small text-text-2">{context ?? (graphicsOnly ? 'From the graphics catalog' : 'From the catalog')}</span>
        </span>
        <RDialog.Close asChild>
          <button type="button" aria-label="Close" title="Close" className="ctl hov inline-flex size-8 cursor-pointer items-center justify-center rounded-ctl border-0 bg-transparent p-0 text-text-2">
            <Icon name="close" size={16} />
          </button>
        </RDialog.Close>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-hairline px-[18px] pb-3">
        <label className="flex h-[34px] min-w-0 flex-[1_1_280px] items-center gap-1.5 rounded-ctl border border-border-strong bg-surface px-2.5 text-text-3">
          <Icon name="search" size={15} className="shrink-0" />
          <span className="sr-only">Search the catalog</span>
          <input
            ref={searchRef}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={series ? 'Search series by title' : 'Search titles and house IDs'}
            className="h-[30px] min-w-0 flex-1 border-0 bg-transparent text-small text-text outline-none"
          />
          <span className="mono text-tiny">/</span>
        </label>
        {famList.length > 1 && (
          <span role="group" aria-label="Kind" className="inline-flex gap-0.5 rounded-[7px] bg-surface-2 p-0.5">
            {famList.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={f === fam}
                onClick={() => {
                  setFam(f);
                  setTypeId(null);
                  setContentId(null);
                }}
                className={cx('h-7 cursor-pointer rounded-[5px] border-0 px-2.5 text-[12.5px] font-medium', f === fam ? 'bg-surface text-text shadow-seg' : 'bg-transparent text-text-2')}
              >
                {FAMILY_LABEL[f]}
              </button>
            ))}
          </span>
        )}
        <ToggleChip on={ready} onClick={() => setReady(!ready)}>
          Ready media only
        </ToggleChip>
        {date && (
          <ToggleChip on={validOnly} onClick={() => setValidOnly(!validOnly)}>
            Valid on {dayText(date)}
          </ToggleChip>
        )}
      </div>

      {graphicsOnly ? (
        <div className="flex-1 px-4 py-6 text-small text-text-3">The graphics catalog comes with the Catalog page; nothing can be picked from it yet.</div>
      ) : searching ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2">
          {(search.data?.contents ?? []).length > 0 && (
            <>
              <div className="px-2 pb-1 pt-1.5 text-meta text-text-3">Titles</div>
              {search.data!.contents.slice(0, 8).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setQ('');
                    openContent(c.id, c.contentTypeId);
                  }}
                  className="hov flex min-h-[34px] w-full cursor-pointer items-center gap-2.5 rounded-ctl border-0 bg-transparent px-2 text-left text-small"
                >
                  <span className={cx('size-[7px] shrink-0 rounded-[2px]', FAMILY_DOT[fam])} />
                  <span className="font-medium">{c.title}</span>
                  <span className="text-text-3">· {c.typeName}</span>
                  <span className="flex-1" />
                  <span className="mono text-tiny text-text-3">{c.productionCount}</span>
                </button>
              ))}
            </>
          )}
          {!series &&
            hitGroups.map((g) => (
              <div key={g.path} role="listbox" aria-label={g.path} aria-multiselectable={multi}>
                <div className="px-2 pb-1 pt-2.5 text-meta text-text-3">{g.path}</div>
                {g.rows.slice(0, 30).map((p, i) => row(p, g.contentTitle, i, false))}
              </div>
            ))}
          {search.isFetched && !(search.data?.contents ?? []).length && (series || !hitGroups.length) && (
            <div className="px-2 py-4 text-small text-text-3">Nothing in the catalog matches “{query}”.</div>
          )}
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[220px_280px_minmax(0,1fr)]">
          <div role="listbox" aria-label="Categories" className="min-h-0 overflow-y-auto border-r border-hairline p-2">
            <div className="px-2 pb-1 pt-2 text-meta text-text-3">{FAMILY_LABEL[fam]} · categories</div>
            {typesOfFam.map((t) => (
              <button
                key={t.id}
                type="button"
                role="option"
                aria-selected={t.id === type?.id}
                onClick={() => {
                  setTypeId(t.id);
                  setContentId(null);
                  setFocus(0);
                }}
                className={cx('hov flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-ctl border-0 px-2 text-left text-small', t.id === type?.id ? 'bg-surface-2 font-semibold' : 'bg-transparent')}
              >
                <span className={cx('size-[7px] shrink-0 rounded-[2px]', FAMILY_DOT[t.family])} />
                <span className="min-w-0 flex-1 truncate">{t.name}</span>
                <span className="mono text-tiny font-normal text-text-3">{t.contentCount}</span>
              </button>
            ))}
            {types.isFetched && !typesOfFam.length && <div className="px-2 py-2 text-small text-text-3">No categories of this kind.</div>}
          </div>
          <div role="listbox" aria-label="Titles" className="min-h-0 overflow-y-auto border-r border-hairline p-2">
            <div className="flex justify-between px-2 pb-1 pt-2 text-meta text-text-3">
              <span className="truncate">{type?.name ?? ''}</span>
              <span className="mono">{type?.contentCount ?? ''}</span>
            </div>
            {(contents.data ?? []).map((c) => {
              const on = c.id === contentId;
              const hasPicked = multi && !series && !on && [...picked.values()].some((i) => i.contentId === c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => openContent(c.id)}
                  className={cx('hov flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-ctl border-0 px-2 text-left text-small', on ? 'bg-accent-soft font-semibold' : 'bg-transparent')}
                >
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  {hasPicked && <span title="Has picked items" className="size-1.5 rounded-full bg-accent" />}
                  <span className="mono text-tiny font-normal text-text-3">{c.productionCount}</span>
                </button>
              );
            })}
          </div>
          <div className="flex min-h-0 flex-col">
            {content ? (
              <>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-hairline px-4 pb-2.5 pt-3">
                  <span className="flex min-w-0 flex-[1_1_200px] flex-col gap-px">
                    <span className="font-semibold">{content.title}</span>
                    <span className="text-meta text-text-3">{meta}</span>
                  </span>
                  {series && chapters.length > 0 && (
                    <span className="inline-flex items-center gap-1.5 text-small text-text-2">
                      Episodes
                      <input aria-label="From episode" value={rangeFrom} onChange={(e) => applyRange(e.target.value, rangeTo)} className="mono h-7 w-[52px] rounded-ctl border border-border-strong bg-surface px-1.5 text-right text-small" />
                      to
                      <input aria-label="To episode" value={rangeTo} onChange={(e) => applyRange(rangeFrom, e.target.value)} className="mono h-7 w-[52px] rounded-ctl border border-border-strong bg-surface px-1.5 text-right text-small" />
                    </span>
                  )}
                  {multi && selectable.length > 0 && (
                    <button type="button" onClick={toggleAll} className="hov h-7 cursor-pointer rounded-ctl border border-border-strong bg-surface px-2.5 text-[12.5px] font-medium">
                      {allOn ? 'Select none' : 'Select all'}
                    </button>
                  )}
                </div>
                {allAlready && (
                  <div className="mx-4 mt-2.5 rounded-item bg-surface-2 px-2.5 py-2 text-small text-text-2">
                    All {plural(visible.length, unit)} of {content.title} are already in this plan. New ones show here as soon as Media has them.
                  </div>
                )}
                <div
                  role="listbox"
                  aria-label={`${isEpisodeType ? 'Episodes' : 'Items'} of ${content.title}`}
                  aria-multiselectable={multi}
                  tabIndex={0}
                  onKeyDown={listKey}
                  onFocus={() => setListFocused(true)}
                  onBlur={() => setListFocused(false)}
                  className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-1.5 outline-none"
                >
                  {visible.map((p, i) => row(p, content.title, i, true))}
                  {!visible.length && <div className="px-2 py-4 text-small text-text-3">{ready ? 'Nothing here has ready media.' : 'This title has no items yet.'}</div>}
                </div>
              </>
            ) : (
              <div className="px-4 py-6 text-small text-text-3">{contentId ? 'Loading…' : `Pick a title on the left${series ? ' — its episodes come in order.' : '.'}`}</div>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-hairline bg-surface py-2.5 pl-[18px] pr-3">
        <span className="flex min-w-0 flex-[1_1_260px] flex-col text-small">
          <span className="font-medium [overflow-wrap:anywhere]">{sumMain}</span>
          <span className={cx('text-meta', n && known.length < n ? 'text-amber-text' : 'text-text-3')}>{sumSub}</span>
        </span>
        {multi && !series && n > 0 && (
          <button type="button" onClick={() => setPicked(new Map())} className="hov h-[30px] cursor-pointer rounded-ctl border-0 bg-transparent px-2.5 text-small font-medium text-text-2">
            Clear
          </button>
        )}
        <button type="button" onClick={onCancel} className="ctl hov h-ctl cursor-pointer rounded-ctl border border-transparent bg-transparent px-3 font-medium text-text-2">
          Cancel
        </button>
        <button type="button" disabled={!n} onClick={use} className="ctl h-ctl cursor-pointer rounded-ctl border border-accent bg-accent px-3.5 font-medium text-on-accent hover:not-disabled:bg-accent-hover">
          {confirmLabel}
        </button>
      </div>
      <div className="bg-surface px-[18px] pb-2 text-[11.5px] text-text-3">/ search · ↑ ↓ move · Space {multi ? 'tick' : 'choose'} · Enter {pick === 'one' ? 'pick' : 'use'} · Esc close</div>
    </div>
  );
}
