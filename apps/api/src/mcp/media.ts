// The tools of Media (decision 0025, group 6.5): categories, titles and items (read, create, change,
// delete), a series of episodes, cuts (create, recut), rotation lists (read, create, clone, change,
// shuffle, delete) and relations (stings, graphics, time windows, product codes). Changing one item's
// fields and adding to a rotation list were there before (changes.ts). Each previews first, applies
// at the version it showed where the thing has one, and undo_change puts it back (undoMedia) while
// nobody changed it since.

import { z } from 'zod';
import { formatTc, frameRate, parseTc, seriesTitles, SERIES_MAX, type CatalogLevel, type FrameRate } from '@9eye/core';
import type { AuditEvent } from '@prisma/client';
import { demand } from '../access';
import { db, toIsoDate } from '../db';
import { HttpError } from '../errors';
import { createItem, getItem, saveItem } from '../services/catalogItems';
import {
  cloneList, createSegmentation, createSeries, deleteCheck, deleteItems, getRelations, regenerateSegmentation, saveRelations, shuffleList, addListItems,
} from '../services/catalogOps';
import type { Principal } from './auth';
import { APPLY, FAMILY, UNDO_HINT, capped, findChannel, isUuid, isoDate, plural, quote, type DefineTool, type ToolResult } from './common';
import { mediaItems } from './plans';

const apply = z.boolean().default(false).describe(APPLY);
const version = z.number().int().optional().describe('With apply: the version the preview showed.');
const categoryArg = z.string().trim().min(1).max(300).describe('A category: its id, name or code (list_categories shows them).');
const titleArg = z.string().trim().min(1).max(400).describe('A title: its id, name or code (search_media finds them).');
const itemArg = z.string().trim().min(1).max(400).describe('An item: its id, code or title (search_media, get_title).');
const listArg = z.string().trim().min(1).max(300).describe('A rotation list: its id or name (get_rotation_lists shows them).');
const lengthArgS = z.string().max(11).describe('HH:MM:SS:FF at the catalog frame rate.');
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'a colour as #RRGGBB');
const KIND_WORD: Record<string, string> = { program: 'Programmes', filling: 'Trailers and stings', advert: 'Ads' };
const pv = (applying: boolean, what = 'nothing is saved') => (applying ? '' : ` — preview, ${what}`);
const words = (v: unknown) => (v === null || v === undefined || v === '' ? 'none' : typeof v === 'string' ? quote(v) : String(v));

function checkVersion(applying: boolean, asked: number | undefined, now: number, what: string) {
  if (!applying) return;
  if (asked === undefined) throw new HttpError(400, 'Apply needs the version the preview showed.');
  if (asked !== now) throw new HttpError(409, `The ${what} changed since the preview (version ${asked}, now ${now}): preview it again.`);
}

function lengthOf(s: string | null | undefined, r: FrameRate): number | null {
  if (s === null || s === undefined || s.trim() === '') return null;
  const f = parseTc(s.trim(), r);
  if (f === null || f <= 0) throw new HttpError(400, `"${s}" is not a length (HH:MM:SS:FF).`);
  return f;
}
const codeFrom = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 8) || 'NEW';
const refuse = (applying: boolean, head: string[], why: string, status = 409): string => {
  const text = [...head, `Cannot: ${why} Nothing was changed.`].join('\n');
  if (applying) throw new HttpError(status, text);
  return text;
};

// ---------------------------------------------------------------- lookups

/** By id, exact name or code, else the one whose name has the words. */
function pick<T extends { id: string }>(rows: T[], ref: string, name: (x: T) => string, code: (x: T) => string, what: string, hint: string): T {
  const r = ref.trim();
  const k = r.toLowerCase();
  const exact = rows.filter((x) => x.id === r || name(x).toLowerCase() === k || (code(x) && code(x).toLowerCase() === k));
  const hit = exact.length ? exact : rows.filter((x) => name(x).toLowerCase().includes(k));
  if (hit.length === 1) return hit[0];
  if (hit.length > 1) throw new HttpError(400, `"${r}" fits ${hit.length} ${what}s: ${hit.slice(0, 10).map((x) => `${quote(name(x))} (id ${x.id})`).join(', ')}. Name one by its id.`);
  throw new HttpError(404, `No ${what} ${quote(r)}. ${hint}`);
}

async function categoryRef(ref: string) {
  const rows = await db.contentType.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } });
  return pick(rows, ref, (x) => x.name, (x) => x.code, 'category', 'list_categories shows them.');
}

async function titleRef(ref: string) {
  const r = ref.trim();
  const where = isUuid(r) ? { id: r } : { OR: [{ title: { contains: r, mode: 'insensitive' as const } }, { code: { equals: r, mode: 'insensitive' as const } }] };
  const rows = await db.content.findMany({ where: { deletedAt: null, ...where }, include: { contentType: true }, take: 50 });
  return pick(rows, r, (x) => x.title, (x) => x.code, 'title', 'search_media finds titles.');
}

async function itemRef(ref: string) {
  const r = ref.trim();
  const where = isUuid(r) ? { id: r } : { OR: [{ title: { contains: r, mode: 'insensitive' as const } }, { code: { equals: r, mode: 'insensitive' as const } }] };
  const rows = await db.production.findMany({ where: { deletedAt: null, isTemplate: false, ...where }, include: { content: true }, take: 50 });
  return pick(rows, r, (x) => x.title, (x) => x.code, 'item', 'search_media finds items.');
}

async function listRef(ref: string) {
  const rows = await db.rotationList.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } });
  return pick(rows, ref, (x) => x.name, () => '', 'rotation list', 'get_rotation_lists shows them.');
}

async function listWithItems(id: string) {
  return db.rotationList.findFirstOrThrow({ where: { id, deletedAt: null }, include: { items: { orderBy: [{ position: 'asc' }, { name: 'asc' }], include: { production: true, segmentation: true } } } });
}

/** A media source by name, code or id; else the fallback, else the company's first. */
async function sourceOf(ref: string | undefined, fallback: string | null) {
  const all = await db.source.findMany({ orderBy: { name: 'asc' } });
  if (ref) return pick(all, ref, (x) => x.name, (x) => x.code, 'media source', `Sources: ${all.map((s) => quote(s.name)).join(', ') || 'none'}.`);
  const s = all.find((x) => x.id === fallback) ?? all[0];
  if (!s) throw new HttpError(400, 'The company has no media source yet (Settings): items need one.');
  return s;
}

async function cutRef(ref: string, item?: string) {
  const r = ref.trim();
  const prod = item ? await itemRef(item) : null;
  const rows = await db.segmentation.findMany({
    where: { deletedAt: null, ...(prod ? { productionId: prod.id } : isUuid(r) ? { id: r } : { name: { equals: r, mode: 'insensitive' as const } }) },
    include: { production: true },
  });
  return pick(rows, r, (x) => x.name, (x) => String(x.code), 'cut', 'get_title lists the cuts of each item.');
}

// ---------------------------------------------------------------- what is under a category, title or item

type Level = 'content-type' | 'content' | 'production';
interface Tree {
  contentTypes: string[];
  contents: string[];
  productions: string[];
  segmentations: string[];
  segments: string[];
}
async function subtree(level: Level, ids: string[]): Promise<Tree> {
  const live = { deletedAt: null };
  const contents = level === 'content-type' ? (await db.content.findMany({ where: { ...live, contentTypeId: { in: ids } }, select: { id: true } })).map((x) => x.id) : level === 'content' ? ids : [];
  const productions = level === 'production' ? ids : (await db.production.findMany({ where: { ...live, contentId: { in: contents } }, select: { id: true } })).map((x) => x.id);
  const segmentations = (await db.segmentation.findMany({ where: { ...live, productionId: { in: productions } }, select: { id: true } })).map((x) => x.id);
  const segments = (await db.segment.findMany({ where: { ...live, segmentationId: { in: segmentations } }, select: { id: true } })).map((x) => x.id);
  return { contentTypes: level === 'content-type' ? ids : [], contents, productions, segmentations, segments };
}

// ---------------------------------------------------------------- rotation lists

const LIST_SETTINGS = {
  days_between: z.number().int().min(0).max(3650).optional().describe('Days before an item may play again.'),
  same_day_repeat: z.boolean().optional().describe('An item may play twice the same day.'),
  random_insert: z.boolean().optional().describe('Items are picked at random, not in turn.'),
  channel_restrictions: z.boolean().optional().describe("Items keep their channels' limits."),
  item_repeats: z.boolean().optional().describe('An item may repeat inside one block.'),
  overlap: z.boolean().optional().describe('A block may run over with the last item.'),
};
type ListRow = Awaited<ReturnType<typeof listWithItems>>;
const listFields = (l: ListRow) => ({
  name: l.name, insertionDaysInterval: l.insertionDaysInterval, allowSameDayRepeat: l.allowSameDayRepeat, randomInsert: l.randomInsert,
  applyChannelRestrictions: l.applyChannelRestrictions, allowProductionRepeats: l.allowProductionRepeats, allowOverlap: l.allowOverlap,
});
type ListFields = ReturnType<typeof listFields>;
const LIST_LABELS: [keyof ListFields, string][] = [
  ['name', 'name'], ['insertionDaysInterval', 'days between plays'], ['allowSameDayRepeat', 'same-day repeat'], ['randomInsert', 'random'],
  ['applyChannelRestrictions', 'channel limits'], ['allowProductionRepeats', 'repeats in a block'], ['allowOverlap', 'run over'],
];
function withSettings(f: ListFields, a: { name?: string } & { [K in keyof typeof LIST_SETTINGS]?: z.infer<(typeof LIST_SETTINGS)[K]> }): ListFields {
  return {
    name: a.name ?? f.name, insertionDaysInterval: a.days_between ?? f.insertionDaysInterval, allowSameDayRepeat: a.same_day_repeat ?? f.allowSameDayRepeat,
    randomInsert: a.random_insert ?? f.randomInsert, applyChannelRestrictions: a.channel_restrictions ?? f.applyChannelRestrictions,
    allowProductionRepeats: a.item_repeats ?? f.allowProductionRepeats, allowOverlap: a.overlap ?? f.allowOverlap,
  };
}
const settingsWords = (f: ListFields) =>
  [
    f.insertionDaysInterval ? `${plural(f.insertionDaysInterval, 'day')} between plays` : null, f.randomInsert ? 'random' : 'in turn', f.allowSameDayRepeat ? 'same-day repeat' : null,
    f.applyChannelRestrictions ? 'channel limits' : null, f.allowProductionRepeats ? 'repeats in a block' : null, f.allowOverlap ? 'may run over' : null,
  ].filter(Boolean).join(' · ');
const itemRows = (l: ListRow) => l.items.map((i) => ({ id: i.id, productionId: i.productionId, segmentationId: i.segmentationId, name: i.name, position: i.position, insertedAt: i.insertedAt?.toISOString() ?? null }));

/** The items of a list by place ("3", as get_rotation_lists numbers them), name, code or item title. */
function listItemOf(items: ListRow['items'], ref: string) {
  const r = ref.trim();
  const k = r.toLowerCase();
  const n = /^#?(\d{1,6})$/.exec(r);
  if (n) {
    const x = items[Number(n[1]) - 1];
    if (!x) throw new HttpError(404, `The list has ${plural(items.length, 'item')}: there is no item ${n[1]}.`);
    return x;
  }
  const hit = items.filter((i) => i.id === r || i.productionId === r || i.name.toLowerCase() === k || i.production.code.toLowerCase() === k || i.production.title.toLowerCase() === k);
  if (hit.length === 1) return hit[0];
  if (hit.length > 1) throw new HttpError(400, `"${r}" fits ${hit.length} items of the list: name it by its place.`);
  throw new HttpError(404, `No item ${quote(r)} in the list: get_rotation_lists numbers its items.`);
}

// ---------------------------------------------------------------- relations

const RELATION_KIND = { stings: 'linear', graphics: 'graphics', time_windows: 'time-window', product_codes: 'product-code' } as const;
type RelKind = keyof typeof RELATION_KIND;
const relationRow = z.object({
  sting: z.string().trim().max(400).optional().describe('stings: the sting item (id, code or title).'),
  when: z.enum(['pre', 'post']).optional().describe('stings: before (pre) or after (post) the item.'),
  graphic: z.string().trim().max(300).optional().describe('graphics: the graphic template by name or id; its timing comes from the template.'),
  layer: z.enum(['auto', '1', '2', '3', '4']).optional().describe('graphics: the layer (default the template’s).'),
  window: z.string().trim().max(300).optional().describe('time_windows: the time window by name or id.'),
  rule: z.enum(['allowed', 'rejected']).optional().describe('time_windows: allowed in it, or never in it.'),
  code: z.string().trim().max(300).optional().describe('product_codes: the product code by name, code or id.'),
  parts: z.enum(['all', 'first', 'last', 'first-last']).default('all').describe('stings and graphics: which parts of the item.'),
  channel: z.string().trim().max(200).optional().describe('Only on this channel. Default: every channel.'),
});
type RelInput = z.infer<typeof relationRow>;
interface RelRow {
  channelId: string | null;
  params: Record<string, unknown>;
}

async function relationParams(kind: RelKind, x: RelInput): Promise<Record<string, unknown>> {
  if (kind === 'stings') {
    if (!x.sting || !x.when) throw new HttpError(400, 'A sting row needs sting and when (pre or post).');
    const s = await itemRef(x.sting);
    return { jingle: x.when, segments: x.parts, productionId: s.id };
  }
  if (kind === 'graphics') {
    if (!x.graphic) throw new HttpError(400, 'A graphics row needs graphic.');
    const all = await db.graphicTemplate.findMany({ where: { deletedAt: null } });
    const g = pick(all, x.graphic, (t) => t.name, (t) => t.code, 'graphic template', `Templates: ${all.map((t) => quote(t.name)).join(', ') || 'none'}.`);
    return {
      graphicTemplateId: g.id, segments: x.parts, startType: g.startType, startOffsetFrames: g.startOffsetFrames, tcInFrames: g.startTcInFrames, endType: g.endType,
      durationFrames: g.endDurationFrames, tcOutFrames: g.endTcOutFrames, frequency: g.frequency, intervalFrames: g.repeatIntervalFrames, repetitions: g.repeatCount, layer: x.layer ?? g.layer,
    };
  }
  if (kind === 'time_windows') {
    if (!x.window || !x.rule) throw new HttpError(400, 'A time window row needs window and rule (allowed or rejected).');
    const all = await db.timeWindow.findMany();
    const w = pick(all, x.window, (t) => t.name, () => '', 'time window', `Time windows: ${all.map((t) => quote(t.name)).join(', ') || 'none'}.`);
    return { timeWindowId: w.id, rule: x.rule };
  }
  if (!x.code) throw new HttpError(400, 'A product code row needs code.');
  const all = await db.productCode.findMany();
  const c = pick(all, x.code, (t) => t.name, (t) => t.code, 'product code', `Product codes: ${all.map((t) => quote(t.name)).join(', ') || 'none'}.`);
  return { productCodeId: c.id };
}

async function relationWords(rows: RelRow[]): Promise<string[]> {
  const ids = (k: string) => rows.map((r) => r.params[k]).filter((x): x is string => typeof x === 'string');
  const names = new Map<string, string>();
  for (const x of await db.production.findMany({ where: { id: { in: ids('productionId') } } })) names.set(x.id, x.title);
  for (const x of await db.graphicTemplate.findMany({ where: { id: { in: ids('graphicTemplateId') } } })) names.set(x.id, x.name);
  for (const x of await db.timeWindow.findMany({ where: { id: { in: ids('timeWindowId') } } })) names.set(x.id, x.name);
  for (const x of await db.productCode.findMany({ where: { id: { in: ids('productCodeId') } } })) names.set(x.id, x.name);
  const chans = new Map((await db.channel.findMany({ where: { id: { in: rows.map((r) => r.channelId).filter((x): x is string => !!x) } } })).map((c) => [c.id, c.name]));
  return rows.map((r) => {
    const q = r.params;
    const on = r.channelId ? ` on ${chans.get(r.channelId) ?? 'a channel'}` : '';
    if (q.productionId) return `${q.jingle} sting ${quote(names.get(q.productionId as string) ?? '?')} · parts ${q.segments}${on}`;
    if (q.graphicTemplateId) return `graphic ${quote(names.get(q.graphicTemplateId as string) ?? '?')} · parts ${q.segments} · layer ${q.layer}${on}`;
    if (q.timeWindowId) return `${q.rule} in ${quote(names.get(q.timeWindowId as string) ?? '?')}${on}`;
    return `product code ${quote(names.get(q.productCodeId as string) ?? '?')}${on}`;
  });
}

const own = async (level: CatalogLevel, id: string, kind: string): Promise<RelRow[]> =>
  (await getRelations(level, id)).rows.filter((r) => !r.inherited && r.kind === kind).map((r) => ({ channelId: r.channelId, params: r.params }));

// ---------------------------------------------------------------- read

export function registerMediaRead(tool: DefineTool, p: Principal) {
  tool(
    'list_categories',
    'List categories',
    'The categories of Media (what titles are: series, films, trailers, ads, …): kind, code, colour, how many titles, version and id.',
    z.object({}),
    async () => {
      demand(p.access, 'catalog', 'view');
      const rows = await db.contentType.findMany({ where: { deletedAt: null }, include: { _count: { select: { contents: { where: { deletedAt: null } } } } }, orderBy: { name: 'asc' } });
      return [
        `Categories (${rows.length}):`,
        ...(rows.length
          ? rows.map((c) => `- ${quote(c.name)} · ${KIND_WORD[c.family] ?? c.family} · code ${c.code || 'none'} · colour ${c.color ?? 'none'} · ${plural(c._count.contents, 'title')} · version ${c.version} · id ${c.id}`)
          : ['- none']),
      ].join('\n');
    },
  );

  tool(
    'get_title',
    'Title',
    'One title of Media: its category, fields and version, and its items (episodes or versions) with episode, code, length, media state, rights dates, cuts and their parts — and the next free episode number.',
    z.object({ title: titleArg }),
    async (a) => {
      demand(p.access, 'catalog', 'view');
      const t = await titleRef(a.title);
      const r = frameRate(p.tenant.catalogFrameRate);
      const items = await db.production.findMany({
        where: { contentId: t.id, deletedAt: null },
        include: { segmentations: { where: { deletedAt: null }, orderBy: { code: 'asc' }, include: { _count: { select: { segments: { where: { deletedAt: null } } } } } } },
        orderBy: [{ chapter: 'asc' }, { title: 'asc' }],
      });
      const next = Math.max(0, ...items.filter((x) => !x.isTemplate).map((x) => x.chapter ?? 0)) + 1;
      const d = (x: Date | null) => (x ? toIsoDate(x) : '…');
      return [
        `Title ${quote(t.title)} · category ${quote(t.contentType.name)} (${KIND_WORD[t.contentType.family] ?? t.contentType.family}) · code ${t.code || 'none'} · version ${t.version} · id ${t.id}`,
        [
          t.originalTitle ? `original title ${quote(t.originalTitle)}` : null, t.season ? `season ${t.season}` : null, t.lengthFrames !== null ? `length ${formatTc(t.lengthFrames, r)}` : null,
          `${plural(t.segmentCount, 'part')}`, t.validFrom || t.validTo ? `valid ${d(t.validFrom)} → ${d(t.validTo)}` : null, t.genres ? `genres ${t.genres}` : null,
        ].filter(Boolean).join(' · '),
        ...(t.synopsis ? [`Synopsis: ${t.synopsis.slice(0, 400)}${t.synopsis.length > 400 ? '…' : ''}`] : []),
        ...(t.notes ? [`Notes: ${t.notes.slice(0, 400)}`] : []),
        '',
        `Items (${items.length}; the next free episode is ${next}):`,
        ...(items.length
          ? capped(
              items.map((x) =>
                [
                  `- ${quote(x.title)}${x.isTemplate ? ' (template)' : ''}`, x.chapter ? `ep ${x.chapter}` : null, x.code ? `code ${x.code}` : null,
                  x.lengthFrames !== null ? formatTc(x.lengthFrames, r) : 'no length', x.mediaStatus === 'ready' ? 'media ready' : x.mediaStatus === 'not-ready' ? 'MEDIA NOT READY' : null,
                  x.starts || x.expires ? `rights ${d(x.starts)} → ${d(x.expires)}` : null,
                  x.segmentations.length ? `cuts ${x.segmentations.map((s) => `${quote(s.name)} (${plural(s._count.segments, 'part')})`).join(', ')}` : 'no cut',
                  `version ${x.version}`, `id ${x.id}`,
                ].filter(Boolean).join(' · '),
              ),
              'and more',
              150,
            )
          : ['- none']),
      ].join('\n');
    },
  );

  tool(
    'get_rotation_lists',
    'Rotation lists',
    'The rotation lists (what fills the free time of blocks): without a list, every list with its settings and how many items; with one, its items in order (numbered, as the list tools take them) and the one played last.',
    z.object({ list: listArg.optional() }),
    async (a) => {
      demand(p.access, 'catalog', 'view');
      const r = frameRate(p.tenant.catalogFrameRate);
      if (!a.list) {
        const rows = await db.rotationList.findMany({ where: { deletedAt: null }, include: { _count: { select: { items: true } } }, orderBy: { name: 'asc' } });
        return [`Rotation lists (${rows.length}):`, ...(rows.length ? capped(rows.map((l) => `- ${quote(l.name)} · ${plural(l._count.items, 'item')} · ${settingsWords(l)} · version ${l.version} · id ${l.id}`), 'name a list') : ['- none'])].join('\n');
      }
      const l = await listWithItems((await listRef(a.list)).id);
      return [
        `Rotation list ${quote(l.name)} · ${settingsWords(l)} · version ${l.version} · id ${l.id}`,
        `Items (${l.items.length}):`,
        ...(l.items.length
          ? capped(
              l.items.map((i, n) => `${n + 1}. ${quote(i.name)} · item ${quote(i.production.title)}${i.production.code ? ` (${i.production.code})` : ''} · ${i.production.lengthFrames !== null ? formatTc(i.production.lengthFrames, r) : 'no length'}${i.segmentation ? ` · cut ${quote(i.segmentation.name)}` : ''}${l.lastItemPosition === i.position ? ' · played last' : ''}`),
              'and more',
              200,
            )
          : ['- none']),
      ].join('\n');
    },
  );
}

// ---------------------------------------------------------------- writes

export function registerMediaTools(tool: DefineTool, p: Principal) {
  const rate = () => frameRate(p.tenant.catalogFrameRate);

  // ---------------------------------------------------------------- categories

  tool(
    'create_category',
    'Create a category',
    `Create a category of Media (what its titles are). Preview first. ${UNDO_HINT} (undo deletes it while it has no titles)`,
    z.object({
      name: z.string().trim().min(1).max(300),
      kind: z.enum(['programmes', 'trailers_and_stings', 'ads']).describe('programmes, trailers_and_stings or ads.'),
      code: z.string().trim().min(1).max(100).optional().describe('Default: from the name.'),
      colour: hex.optional().describe('Default #64748b.'),
      apply,
    }),
    async (a, { changeId }) => {
      demand(p.access, 'catalog', 'edit');
      const body = { name: a.name, code: a.code ?? codeFrom(a.name), color: (a.colour ?? '#64748b').toLowerCase(), family: FAMILY[a.kind] };
      const taken = await db.contentType.findFirst({ where: { deletedAt: null, name: { equals: a.name, mode: 'insensitive' } } });
      const out = [`New category ${quote(a.name)} · ${KIND_WORD[body.family]} · code ${body.code} · colour ${body.color}${pv(a.apply, 'nothing is made')}`];
      if (taken) return refuse(a.apply, out, `there is a category ${quote(taken.name)} already.`);
      if (!a.apply) return { text: [...out, 'To make it: create_category with the same arguments and apply: true.'].join('\n'), applyWith: { apply: true } };
      const made = await createItem('content-type', null, body);
      return { text: `Category ${quote(a.name)} made (id ${made.id}). Change id ${changeId} — undo_change deletes it while it has no titles.`, change: { targetId: made.id, channelIds: [], before: null, after: { level: 'content-type', id: made.id, version: 1 } } };
    },
    'write',
  );

  tool(
    'edit_category',
    'Change a category',
    `Change a category's name, code or colour. Preview first; apply saves at the version the preview showed. ${UNDO_HINT}`,
    z.object({ category: categoryArg, name: z.string().trim().min(1).max(300).optional(), code: z.string().trim().min(1).max(100).optional(), colour: hex.optional(), apply, version }),
    async (a, { changeId }) => {
      demand(p.access, 'catalog', 'edit');
      const c = await categoryRef(a.category);
      checkVersion(a.apply, a.version, c.version, 'category');
      const was = await getItem('content-type', c.id);
      const fields: Record<string, unknown> = { ...was, color: (was.color as string | null) ?? '#64748b' };
      const next: Record<string, unknown> = { ...fields, name: a.name ?? c.name, code: a.code ?? c.code, color: (a.colour ?? (fields.color as string)).toLowerCase() };
      const lines = (['name', 'code', 'color'] as const).filter((k) => next[k] !== fields[k]).map((k) => `- ${k === 'color' ? 'colour' : k}: ${words(fields[k])} → ${words(next[k])}`);
      const head = `Category ${quote(c.name)} · version ${c.version}${pv(a.apply)}`;
      if (!lines.length) return `${head}\nNothing to change.`;
      if (!a.apply) return { text: [head, ...lines, `To save it: edit_category with the same arguments, apply: true and version ${c.version}.`].join('\n'), applyWith: { apply: true, version: c.version } };
      const v = await saveItem('content-type', c.id, { ...next, version: c.version });
      return { text: [`Category ${quote(String(next.name))} saved as version ${v.version}. Change id ${changeId} — ${UNDO_HINT}`, ...lines].join('\n'), change: { targetId: c.id, channelIds: [], before: { level: 'content-type', id: c.id, fields }, after: { level: 'content-type', id: c.id, version: v.version } } };
    },
    'write',
  );

  // ---------------------------------------------------------------- titles and items

  const titleFields = {
    code: z.string().trim().min(1).max(400).optional(),
    original_title: z.string().max(400).optional(),
    season: z.string().max(100).nullable().optional(),
    length: lengthArgS.nullable().optional().describe('The usual length, HH:MM:SS:FF; null = none.'),
    parts: z.number().int().min(1).max(500).optional().describe('How many parts its items have.'),
    valid_from: isoDate.nullable().optional(),
    valid_to: isoDate.nullable().optional(),
    genres: z.string().max(4000).optional(),
    synopsis: z.string().max(20000).optional(),
    notes: z.string().max(20000).optional(),
  };
  type TitleArgs = { [K in keyof typeof titleFields]?: z.infer<(typeof titleFields)[K]> } & { title?: string };
  const titleBody = (was: Record<string, unknown>, a: TitleArgs, r: FrameRate) => ({
    ...was,
    title: a.title ?? was.title, code: a.code ?? was.code, originalTitle: a.original_title ?? was.originalTitle, season: a.season === undefined ? was.season : a.season,
    lengthFrames: a.length === undefined ? was.lengthFrames : lengthOf(a.length, r), segmentCount: a.parts ?? was.segmentCount,
    validFrom: a.valid_from === undefined ? was.validFrom : a.valid_from, validTo: a.valid_to === undefined ? was.validTo : a.valid_to,
    genres: a.genres ?? was.genres, synopsis: a.synopsis ?? was.synopsis, notes: a.notes ?? was.notes,
  });
  const TITLE_LABELS: [string, string][] = [
    ['title', 'title'], ['code', 'code'], ['originalTitle', 'original title'], ['season', 'season'], ['lengthFrames', 'length'], ['segmentCount', 'parts'],
    ['validFrom', 'valid from'], ['validTo', 'valid to'], ['genres', 'genres'], ['synopsis', 'synopsis'], ['notes', 'notes'],
  ];
  const fieldLines = (was: Record<string, unknown>, next: Record<string, unknown>, labels: [string, string][], r: FrameRate) =>
    labels
      .filter(([k]) => JSON.stringify(was[k] ?? null) !== JSON.stringify(next[k] ?? null))
      .map(([k, l]) => {
        const show = (v: unknown) => (k === 'lengthFrames' && typeof v === 'number' ? formatTc(v, r) : words(v));
        return `- ${l}: ${show(was[k])} → ${show(next[k])}`;
      });

  tool(
    'create_title',
    'Create a title',
    `Create a title in a category of Media (a series, a film, a trailer, an ad, …); its items come next (create_item, create_episodes). Preview first. ${UNDO_HINT} (undo deletes it while it has no items)`,
    z.object({ category: categoryArg, title: z.string().trim().min(1).max(400), ...titleFields, apply }),
    async (a, { changeId }) => {
      demand(p.access, 'catalog', 'edit');
      const cat = await categoryRef(a.category);
      const r = rate();
      const empty: Record<string, unknown> = {
        title: a.title, code: codeFrom(a.title), originalTitle: '', season: null, lengthFrames: null, segmentCount: 1, validFrom: null, validTo: null, genres: '', synopsis: '', notes: '', nextProductionId: 1,
      };
      const body = titleBody(empty, a, r);
      const out = [`New title ${quote(a.title)} in ${quote(cat.name)} · code ${body.code}${pv(a.apply, 'nothing is made')}`, ...fieldLines(empty, body, TITLE_LABELS.filter(([k]) => k !== 'title' && k !== 'code'), r).map((x) => x.replace(/: none → /, ': '))];
      const taken = await db.content.findFirst({ where: { deletedAt: null, contentTypeId: cat.id, title: { equals: a.title, mode: 'insensitive' } } });
      if (taken) out.push(`Note: ${quote(cat.name)} has a title ${quote(taken.title)} already; the tools will need this one's id.`);
      if (!a.apply) return { text: [...out, 'To make it: create_title with the same arguments and apply: true. Then create_episodes or create_item make its items.'].join('\n'), applyWith: { apply: true } };
      const made = await createItem('content', cat.id, body);
      out[0] = `Title ${quote(a.title)} made in ${quote(cat.name)} (id ${made.id}). Change id ${changeId} — undo_change deletes it while it has no items.`;
      return { text: out.join('\n'), change: { targetId: made.id, channelIds: [], before: null, after: { level: 'content', id: made.id, version: 1 } } };
    },
    'write',
  );

  tool(
    'edit_title',
    'Change a title',
    `Change a title's fields: title, code, original title, season, length, parts, valid dates, genres, synopsis, notes. Only what is given changes. Preview first; apply saves at the version the preview showed. ${UNDO_HINT}`,
    z.object({ title_ref: titleArg.describe('The title to change: its id, name or code.'), title: z.string().trim().min(1).max(400).optional().describe('A new title.'), ...titleFields, apply, version }),
    async (a, { changeId }) => {
      demand(p.access, 'catalog', 'edit');
      const t = await titleRef(a.title_ref);
      checkVersion(a.apply, a.version, t.version, 'title');
      const r = rate();
      const was = await getItem('content', t.id);
      const next = titleBody(was, a, r);
      const lines = fieldLines(was, next, TITLE_LABELS, r);
      const head = `Title ${quote(t.title)} · version ${t.version}${pv(a.apply)}`;
      if (!lines.length) return `${head}\nNothing to change.`;
      if (!a.apply) return { text: [head, ...lines, `To save it: edit_title with the same arguments, apply: true and version ${t.version}.`].join('\n'), applyWith: { apply: true, version: t.version } };
      const v = await saveItem('content', t.id, { ...next, version: t.version });
      return { text: [`Title ${quote(String(next.title))} saved as version ${v.version}. Change id ${changeId} — ${UNDO_HINT}`, ...lines].join('\n'), change: { targetId: t.id, channelIds: [], before: { level: 'content', id: t.id, fields: was }, after: { level: 'content', id: t.id, version: v.version } } };
    },
    'write',
  );

  tool(
    'create_item',
    'Create an item',
    `Create one item of a title (an episode, a version, a trailer, an ad). Its code comes from the media source's pattern when not given. Preview first. ${UNDO_HINT} (undo deletes it while nothing uses it)`,
    z.object({
      title: titleArg,
      name: z.string().trim().min(1).max(400).optional().describe('The item title. Default: "<title> - <episode>" for programmes, else the title.'),
      episode: z.number().int().min(0).max(1_000_000).optional().describe('Default: the next free episode for programmes, else 0.'),
      code: z.string().trim().max(400).optional(),
      length: lengthArgS.optional(),
      source: z.string().max(200).optional().describe("The media source by name or code. Default: the title's, else the company's first."),
      starts: isoDate.optional().describe('First day it may air.'),
      expires: isoDate.optional().describe('Last day it may air.'),
      media: z.enum(['ready', 'not-ready']).optional(),
      notes: z.string().max(20000).optional(),
      apply,
    }),
    async (a, { changeId }) => {
      demand(p.access, 'catalog', 'edit');
      const t = await titleRef(a.title);
      const r = rate();
      const programmes = t.contentType.family === 'program';
      const top = await db.production.aggregate({ where: { contentId: t.id, deletedAt: null, isTemplate: false }, _max: { chapter: true } });
      const episode = a.episode ?? (programmes ? (top._max.chapter ?? 0) + 1 : 0);
      const src = await sourceOf(a.source, t.sourceId);
      const name = a.name ?? (programmes ? `${t.title} - ${episode}` : t.title);
      const body = {
        title: name, chapter: episode, code: a.code ?? '', lengthFrames: lengthOf(a.length, r), sourceId: src.id, starts: a.starts ?? null, expires: a.expires ?? null,
        mediaStatus: a.media ?? null, notes: a.notes ?? '', segmentCount: t.segmentCount,
      };
      const dup = programmes && episode ? await db.production.findFirst({ where: { contentId: t.id, deletedAt: null, isTemplate: false, chapter: episode } }) : null;
      const out = [
        `New item ${quote(name)} of ${quote(t.title)}${programmes ? ` · ep ${episode}` : ''} · ${body.lengthFrames !== null ? formatTc(body.lengthFrames, r) : 'no length'} · source ${src.name} · code ${a.code || 'from the source'}${pv(a.apply, 'nothing is made')}`,
        ...(a.starts || a.expires ? [`Rights ${a.starts ?? '…'} → ${a.expires ?? '…'}`] : []),
      ];
      if (dup) return refuse(a.apply, out, `${quote(t.title)} has episode ${episode} already (${quote(dup.title)}).`);
      if (!a.apply) return { text: [...out, 'To make it: create_item with the same arguments and apply: true.'].join('\n'), applyWith: { apply: true, episode } };
      const made = await createItem('production', t.id, body);
      const row = await db.production.findUniqueOrThrow({ where: { id: made.id } });
      out[0] = `Item ${quote(name)} made (code ${row.code}, id ${made.id}). Change id ${changeId} — undo_change deletes it while nothing uses it.`;
      return { text: out.join('\n'), change: { targetId: made.id, channelIds: [], before: null, after: { level: 'production', id: made.id, version: 1 } } };
    },
    'write',
  );

  tool(
    'create_episodes',
    'Create episodes',
    `Create numbered episodes of a series title in one go ("<name> - 12", "- 13", …), each with one cut of equal parts. Refused when an episode number exists. Preview first. ${UNDO_HINT} (undo deletes them while nothing uses them)`,
    z.object({
      title: titleArg,
      count: z.number().int().min(1).max(SERIES_MAX),
      first: z.number().int().min(0).max(1_000_000).optional().describe('The first episode number. Default: the next free one.'),
      name: z.string().trim().min(1).max(400).optional().describe('The name before " - N". Default: the title.'),
      length: lengthArgS.optional(),
      parts: z.number().int().min(1).max(50).optional().describe("Parts of each episode's cut. Default: the title's."),
      source: z.string().max(200).optional().describe("The media source by name or code. Default: the title's, else the company's first."),
      apply,
    }),
    async (a, { changeId }) => {
      demand(p.access, 'catalog', 'edit');
      const t = await titleRef(a.title);
      const r = rate();
      const top = await db.production.aggregate({ where: { contentId: t.id, deletedAt: null, isTemplate: false }, _max: { chapter: true } });
      const first = a.first ?? (top._max.chapter ?? 0) + 1;
      const names = seriesTitles(a.name ?? t.title, first, a.count);
      const src = await sourceOf(a.source, t.sourceId);
      const lengthFrames = lengthOf(a.length, r);
      const parts = a.parts ?? Math.min(50, t.segmentCount);
      const chapters = names.map((_, i) => first + i);
      const out = [
        `${quote(t.title)} · ${plural(a.count, 'new episode')} ${first}–${first + a.count - 1}: ${capped(names.map(quote), 'and more', 6).join(', ')} · ${lengthFrames !== null ? formatTc(lengthFrames, r) : 'no length'} · ${plural(parts, 'part')} each · source ${src.name}${pv(a.apply, 'nothing is made')}`,
      ];
      const taken = await db.production.findMany({ where: { contentId: t.id, deletedAt: null, isTemplate: false, chapter: { in: chapters } }, select: { chapter: true } });
      if (taken.length) return refuse(a.apply, out, `episodes ${taken.map((x) => x.chapter).sort((x, y) => (x ?? 0) - (y ?? 0)).join(', ')} exist already.`);
      if (!a.apply) return { text: [...out, 'To make them: create_episodes with the same arguments and apply: true.'].join('\n'), applyWith: { apply: true, first } };
      const nextBefore = t.nextProductionId;
      await createSeries(t.id, { title: a.name ?? t.title, first, count: a.count, lengthFrames, segments: parts, sourceId: src.id });
      const made = await db.production.findMany({ where: { contentId: t.id, deletedAt: null, isTemplate: false, chapter: { in: chapters } }, select: { id: true } });
      const nextAfter = (await db.content.findUniqueOrThrow({ where: { id: t.id } })).nextProductionId;
      out[0] = `${quote(t.title)} · ${plural(made.length, 'episode')} made (${first}–${first + a.count - 1}). Change id ${changeId} — undo_change deletes them while nothing uses them.`;
      return { text: out.join('\n'), change: { targetId: t.id, channelIds: [], before: { contentId: t.id, next: nextBefore }, after: { contentId: t.id, ids: made.map((x) => x.id), next: nextAfter } } };
    },
    'write',
  );

  tool(
    'delete_media',
    'Delete from Media',
    `Delete categories, titles or items with everything under them (items, cuts, parts, their relations) — or nothing, when anything of them is used in plans, playlists, campaigns or rotation lists. Preview first. ${UNDO_HINT} (undo brings them back)`,
    z.object({
      what: z.enum(['categories', 'titles', 'items']),
      refs: z.array(z.string().trim().min(1).max(400)).min(1).max(50).describe('Ids, names or codes.'),
      apply,
    }),
    async (a, { changeId }) => {
      demand(p.access, 'catalog', 'edit');
      const level: Level = a.what === 'categories' ? 'content-type' : a.what === 'titles' ? 'content' : 'production';
      const ids = [...new Set(await Promise.all(a.refs.map(async (x) => (level === 'content-type' ? (await categoryRef(x)).id : level === 'content' ? (await titleRef(x)).id : (await itemRef(x)).id))))];
      const check = await deleteCheck(level, ids);
      const tree = await subtree(level, ids);
      const out = [
        `Delete ${plural(ids.length, a.what.slice(0, -1))}: ${check.map((x) => quote(x.name)).join(', ')}${level === 'content-type' ? ` · with ${plural(tree.contents.length, 'title')}` : ''}${level === 'production' ? '' : ` · ${plural(tree.productions.length, 'item')}`} · ${plural(tree.segmentations.length, 'cut')}${pv(a.apply, 'nothing is deleted')}`,
      ];
      const used = check.filter((x) => x.usedBy);
      if (used.length) return refuse(a.apply, out, used.map((x) => `${quote(x.name)}: ${x.usedBy}`).join('; ') + '.');
      if (!a.apply) return { text: [...out, 'To delete them: delete_media with the same arguments and apply: true.'].join('\n'), applyWith: { apply: true } };
      const all = [...ids, ...tree.contents, ...tree.productions, ...tree.segmentations, ...tree.segments];
      const relations = await db.catalogRelation.findMany({ where: { itemId: { in: all } } });
      await deleteItems(level, ids);
      const stampRow = level === 'content-type' ? await db.contentType.findUniqueOrThrow({ where: { id: ids[0] } }) : level === 'content' ? await db.content.findUniqueOrThrow({ where: { id: ids[0] } }) : await db.production.findUniqueOrThrow({ where: { id: ids[0] } });
      out[0] = `Deleted ${plural(ids.length, a.what.slice(0, -1))} with everything under them. Change id ${changeId} — undo_change brings them back.`;
      return {
        text: out.join('\n'),
        change: { targetId: ids[0], channelIds: [], before: { level, ids, tree, relations: relations.map((x) => ({ ...x, createdAt: undefined, updatedAt: undefined })) }, after: { stamp: stampRow.deletedAt!.toISOString() } },
      };
    },
    'write',
  );

  // ---------------------------------------------------------------- cuts

  tool(
    'create_cut',
    'Create a cut',
    `Create a cut of an item: its parts, equal in length, with time codes when the length is known. Preview first. ${UNDO_HINT} (undo deletes it while nothing uses it)`,
    z.object({
      item: itemArg,
      parts: z.number().int().min(1).max(50),
      length: lengthArgS.optional().describe("The length to split. Default: the item's."),
      name: z.string().trim().min(1).max(400).optional().describe('Default: "<item code>-<n>".'),
      source: z.string().max(200).optional().describe("The media source. Default: the item's, else the company's first."),
      apply,
    }),
    async (a, { changeId }) => {
      demand(p.access, 'catalog', 'edit');
      const it = await itemRef(a.item);
      const r = rate();
      const last = await db.segmentation.findFirst({ where: { productionId: it.id, deletedAt: null }, orderBy: { code: 'desc' } });
      const name = a.name ?? `${it.code || codeFrom(it.title)}-${(last?.code ?? 0) + 1}`;
      const lengthFrames = a.length ? lengthOf(a.length, r) : it.lengthFrames;
      const src = await sourceOf(a.source, it.sourceId);
      const out = [`Item ${quote(it.title)} · new cut ${quote(name)} · ${plural(a.parts, 'part')} of ${lengthFrames !== null ? formatTc(Math.floor(lengthFrames / a.parts), r) : 'unknown length'} · source ${src.name}${pv(a.apply, 'nothing is made')}`];
      if (!a.apply) return { text: [...out, 'To make it: create_cut with the same arguments and apply: true.'].join('\n'), applyWith: { apply: true } };
      const made = await createSegmentation(it.id, { name, sourceId: src.id, segments: a.parts, lengthFrames });
      out[0] = `Cut ${quote(name)} made on ${quote(it.title)} (id ${made.id}). Change id ${changeId} — undo_change deletes it while nothing uses it.`;
      return { text: out.join('\n'), change: { targetId: made.id, channelIds: [], before: null, after: { segmentationId: made.id, version: 1 } } };
    },
    'write',
  );

  tool(
    'recut',
    'Recut',
    `Replace the parts of a cut with new equal ones (and rename it). Preview first; apply saves at the version the preview showed. ${UNDO_HINT}`,
    z.object({
      cut: z.string().trim().min(1).max(400).describe('The cut: its id or name (get_title lists them).'),
      item: itemArg.optional().describe('The item, when the cut name is not enough.'),
      parts: z.number().int().min(1).max(50),
      length: lengthArgS.optional().describe("The length to split. Default: the item's."),
      name: z.string().trim().min(1).max(400).optional(),
      source: z.string().max(200).optional(),
      apply,
      version,
    }),
    async (a, { changeId }) => {
      demand(p.access, 'catalog', 'edit');
      const c = await cutRef(a.cut, a.item);
      checkVersion(a.apply, a.version, c.version, 'cut');
      const r = rate();
      const old = await db.segment.findMany({ where: { segmentationId: c.id, deletedAt: null }, orderBy: { code: 'asc' } });
      const lengthFrames = a.length ? lengthOf(a.length, r) : c.production.lengthFrames;
      const src = await sourceOf(a.source, old[0]?.sourceId ?? c.production.sourceId);
      const name = a.name ?? c.name;
      const used = await db.playlistEvent.count({ where: { segmentId: { in: old.map((x) => x.id) } } });
      const out = [
        `Cut ${quote(c.name)} of ${quote(c.production.title)} · version ${c.version} · ${plural(old.length, 'part')} → ${plural(a.parts, 'part')} of ${lengthFrames !== null ? formatTc(Math.floor(lengthFrames / a.parts), r) : 'unknown length'}${name !== c.name ? ` · renamed ${quote(name)}` : ''}${pv(a.apply)}`,
        ...(used ? [`Note: ${plural(used, 'playlist row')} use its parts now; they keep the old parts.`] : []),
      ];
      if (!a.apply) return { text: [...out, `To recut it: recut with the same arguments, apply: true and version ${c.version}.`].join('\n'), applyWith: { apply: true, version: c.version } };
      const v = await regenerateSegmentation(c.id, { name, sourceId: src.id, segments: a.parts, lengthFrames, version: c.version });
      const fresh = await db.segment.findMany({ where: { segmentationId: c.id, deletedAt: null }, select: { id: true } });
      out[0] = `Cut ${quote(name)} recut: ${plural(a.parts, 'part')} (version ${v.version}). Change id ${changeId} — ${UNDO_HINT}`;
      return { text: out.join('\n'), change: { targetId: c.id, channelIds: [], before: { segmentationId: c.id, name: c.name, segmentIds: old.map((x) => x.id) }, after: { segmentationId: c.id, version: v.version, segmentIds: fresh.map((x) => x.id) } } };
    },
    'write',
  );

  // ---------------------------------------------------------------- rotation lists

  tool(
    'create_rotation_list',
    'Create a rotation list',
    `Create a rotation list (what fills the free time of blocks) with its settings and, optionally, its items. Preview first. ${UNDO_HINT} (undo deletes it while no block uses it)`,
    z.object({ name: z.string().trim().min(1).max(400), ...LIST_SETTINGS, items: z.array(z.string().trim().min(1).max(400)).max(200).default([]).describe('Items of Media (id, code or title; a title brings all its items).'), apply }),
    async (a, { changeId }) => {
      demand(p.access, 'catalog', 'edit');
      const f = withSettings({ name: a.name, insertionDaysInterval: 0, allowSameDayRepeat: false, randomInsert: false, applyChannelRestrictions: false, allowProductionRepeats: false, allowOverlap: false }, a);
      const found = a.items.length ? await mediaItems(a.items) : [];
      const seen = new Set<string>();
      const items = found.filter((x) => !seen.has(x.id) && seen.add(x.id));
      const out = [`New rotation list ${quote(a.name)} · ${settingsWords(f)} · ${plural(items.length, 'item')}${items.length ? `: ${capped(items.map((x) => quote(x.title)), 'and more', 20).join(', ')}` : ''}${pv(a.apply, 'nothing is made')}`];
      if (await db.rotationList.findFirst({ where: { deletedAt: null, name: { equals: a.name, mode: 'insensitive' } } })) return refuse(a.apply, out, `there is a rotation list called ${quote(a.name)} already.`);
      if (!a.apply) return { text: [...out, 'To make it: create_rotation_list with the same arguments and apply: true.'].join('\n'), applyWith: { apply: true } };
      const made = await createItem('rotation-list', null, f);
      if (items.length) await addListItems(made.id, items.map((x) => x.id));
      const v = (await db.rotationList.findUniqueOrThrow({ where: { id: made.id } })).version;
      out[0] = `Rotation list ${quote(a.name)} made with ${plural(items.length, 'item')} (id ${made.id}). Change id ${changeId} — undo_change deletes it while no block uses it.`;
      return { text: out.join('\n'), change: { targetId: made.id, channelIds: [], before: null, after: { listId: made.id, version: v } } };
    },
    'write',
  );

  tool(
    'clone_rotation_list',
    'Clone a rotation list',
    `A copy of a rotation list with its settings and items, named "<name> (Clone)". Preview first. ${UNDO_HINT} (undo deletes the copy)`,
    z.object({ list: listArg, apply }),
    async (a, { changeId }) => {
      demand(p.access, 'catalog', 'edit');
      const l = await listWithItems((await listRef(a.list)).id);
      const out = [`A copy of ${quote(l.name)} with its ${plural(l.items.length, 'item')} and settings (${settingsWords(l)})${pv(a.apply, 'nothing is made')}`];
      if (!a.apply) return { text: [...out, 'To make it: clone_rotation_list with the same list and apply: true.'].join('\n'), applyWith: { apply: true } };
      const made = await cloneList(l.id);
      return { text: `Rotation list ${quote(made.name)} made as a copy of ${quote(l.name)} (id ${made.id}). Change id ${changeId} — undo_change deletes it.`, change: { targetId: made.id, channelIds: [], before: null, after: { listId: made.id, version: 1 } } };
    },
    'write',
  );

  tool(
    'edit_rotation_list',
    'Change a rotation list',
    `Change a rotation list: its name and settings, take items out, move items to another place. Only what is given changes. Preview first; apply saves at the version the preview showed. ${UNDO_HINT}`,
    z.object({
      list: listArg,
      name: z.string().trim().min(1).max(400).optional(),
      ...LIST_SETTINGS,
      remove_items: z.array(z.string().trim().min(1).max(400)).max(500).optional().describe('Items to take out: their place ("3"), name, code or item title.'),
      move: z.array(z.object({ item: z.string().trim().min(1).max(400), to: z.number().int().min(1).max(100000).describe('The new place, 1 = first.') })).max(100).optional(),
      apply,
      version,
    }),
    async (a, { changeId }) => {
      demand(p.access, 'catalog', 'edit');
      const l = await listWithItems((await listRef(a.list)).id);
      checkVersion(a.apply, a.version, l.version, 'rotation list');
      const was = listFields(l);
      const next = withSettings(was, a);
      const lines = LIST_LABELS.filter(([k]) => was[k] !== next[k]).map(([k, label]) => `- ${label}: ${words(was[k])} → ${words(next[k])}`);
      let order = [...l.items];
      if (a.remove_items?.length) {
        const gone = [...new Set(a.remove_items.map((x) => listItemOf(l.items, x)))];
        order = order.filter((x) => !gone.includes(x));
        lines.push(`- taken out: ${gone.map((x) => quote(x.name)).join(', ')}`);
      }
      for (const m of a.move ?? []) {
        const x = listItemOf(order, m.item);
        order = order.filter((y) => y !== x);
        order.splice(Math.min(m.to, order.length + 1) - 1, 0, x);
      }
      const moved = order.some((x, i) => x.position !== i + 1) && (a.move?.length ?? 0) > 0;
      if (moved) lines.push(`- new order: ${capped(order.map((x, i) => `${i + 1} ${quote(x.name)}`), 'and more', 30).join(', ')}`);
      const head = `Rotation list ${quote(l.name)} · version ${l.version}${pv(a.apply)}`;
      if (!lines.length) return `${head}\nNothing to change.`;
      if (next.name !== l.name && (await db.rotationList.findFirst({ where: { deletedAt: null, id: { not: l.id }, name: { equals: next.name, mode: 'insensitive' } } }))) {
        return refuse(a.apply, [head, ...lines], `there is a rotation list called ${quote(next.name)} already.`);
      }
      if (!a.apply) return { text: [head, ...lines, `To save it: edit_rotation_list with the same arguments, apply: true and version ${l.version}.`].join('\n'), applyWith: { apply: true, version: l.version } };
      const lastItem = l.items.find((x) => x.position === l.lastItemPosition);
      const lastAt = lastItem ? order.indexOf(lastItem) : -1;
      await db.$transaction(async (tx) => {
        const u = await tx.rotationList.updateMany({ where: { id: l.id, version: l.version, deletedAt: null }, data: { ...next, lastItemPosition: lastAt >= 0 ? lastAt + 1 : null, version: { increment: 1 } } });
        if (u.count !== 1) throw new HttpError(409, 'Someone else changed this rotation list first: preview it again.');
        const keep = new Set(order.map((x) => x.id));
        await tx.rotationListItem.deleteMany({ where: { listId: l.id, id: { notIn: [...keep] } } });
        for (const [i, x] of order.entries()) if (x.position !== i + 1) await tx.rotationListItem.update({ where: { id: x.id }, data: { position: i + 1 } });
      });
      return {
        text: [`Rotation list ${quote(next.name)} saved as version ${l.version + 1}. Change id ${changeId} — ${UNDO_HINT}`, ...lines].join('\n'),
        change: { targetId: l.id, channelIds: [], before: { listId: l.id, fields: was, items: itemRows(l), lastItemPosition: l.lastItemPosition }, after: { listId: l.id, version: l.version + 1 } },
      };
    },
    'write',
  );

  tool(
    'shuffle_rotation_list',
    'Shuffle a rotation list',
    `Put a rotation list's items in a random order (drawn when applied). Preview first. ${UNDO_HINT}`,
    z.object({ list: listArg, apply, version }),
    async (a, { changeId }) => {
      demand(p.access, 'catalog', 'edit');
      const l = await listWithItems((await listRef(a.list)).id);
      checkVersion(a.apply, a.version, l.version, 'rotation list');
      const head = `Rotation list ${quote(l.name)} · ${plural(l.items.length, 'item')} in a random order${pv(a.apply, 'the order is drawn when it is applied')}`;
      if (l.items.length < 2) return `${head}\nNothing to shuffle.`;
      if (!a.apply) return { text: `${head}\nTo shuffle it: shuffle_rotation_list with apply: true and version ${l.version}.`, applyWith: { apply: true, version: l.version } };
      await shuffleList(l.id);
      const now = await listWithItems(l.id);
      return {
        text: [`Rotation list ${quote(l.name)} shuffled (version ${now.version}). Change id ${changeId} — ${UNDO_HINT}`, `New order: ${capped(now.items.map((x, i) => `${i + 1} ${quote(x.name)}`), 'and more', 30).join(', ')}`].join('\n'),
        change: { targetId: l.id, channelIds: [], before: { listId: l.id, fields: listFields(l), items: itemRows(l), lastItemPosition: l.lastItemPosition }, after: { listId: l.id, version: now.version } },
      };
    },
    'write',
  );

  tool(
    'delete_rotation_list',
    'Delete a rotation list',
    `Delete a rotation list no block type or layout uses. Preview first; apply needs the version the preview showed. ${UNDO_HINT} (undo brings it back)`,
    z.object({ list: listArg, apply, version }),
    async (a, { changeId }) => {
      demand(p.access, 'catalog', 'edit');
      const l = await listWithItems((await listRef(a.list)).id);
      checkVersion(a.apply, a.version, l.version, 'rotation list');
      const head = [`Delete rotation list ${quote(l.name)} with its ${plural(l.items.length, 'item')}${pv(a.apply, 'nothing is deleted')}`];
      const [check] = await deleteCheck('rotation-list', [l.id]);
      if (check.usedBy) return refuse(a.apply, head, `${check.usedBy.toLowerCase()} use it.`);
      if (!a.apply) return { text: [...head, `To delete it: delete_rotation_list with apply: true and version ${l.version}.`].join('\n'), applyWith: { apply: true, version: l.version } };
      await deleteItems('rotation-list', [l.id]);
      return { text: `Rotation list ${quote(l.name)} is deleted. Change id ${changeId} — undo_change brings it back.`, change: { targetId: l.id, channelIds: [], before: { listId: l.id }, after: { listId: l.id, deleted: true } } };
    },
    'write',
  );

  // ---------------------------------------------------------------- relations

  tool(
    'edit_relations',
    'Change relations',
    `Set one kind of relations of a category, title or item — stings (pre / post), graphics, time windows (allowed / rejected), product codes (ads) — replacing its own rows of that kind; what it inherits stays. rows: [] takes them all out. Preview first. ${UNDO_HINT}`,
    z.object({
      category: categoryArg.optional(),
      title: titleArg.optional(),
      item: itemArg.optional(),
      kind: z.enum(['stings', 'graphics', 'time_windows', 'product_codes']),
      rows: z.array(relationRow).max(100),
      apply,
    }),
    async (a, { changeId }) => {
      demand(p.access, 'catalog', 'edit');
      const given = [a.category, a.title, a.item].filter(Boolean).length;
      if (given !== 1) throw new HttpError(400, 'Name one of category, title or item.');
      const level: CatalogLevel = a.category ? 'content-type' : a.title ? 'content' : 'production';
      const target = a.category ? await categoryRef(a.category) : a.title ? await titleRef(a.title) : await itemRef(a.item!);
      const label = 'name' in target ? target.name : target.title;
      const kind = RELATION_KIND[a.kind];
      const rel = await getRelations(level, target.id);
      const head = [`${level === 'content-type' ? 'Category' : level === 'content' ? 'Title' : 'Item'} ${quote(label)} · ${a.kind.replace('_', ' ')}${pv(a.apply)}`];
      if (!rel.tabs.includes(kind)) return refuse(a.apply, head, `a ${level === 'content-type' ? 'category' : level === 'content' ? 'title' : 'item'} like this has no ${a.kind.replace('_', ' ')}${a.kind === 'product_codes' ? ' (only ads have product codes)' : ''}.`, 422);
      const rows: RelRow[] = [];
      for (const x of a.rows) rows.push({ channelId: x.channel ? (await findChannel(p, x.channel)).id : null, params: await relationParams(a.kind, x) });
      const now = rel.rows.filter((r) => !r.inherited && r.kind === kind).map((r) => ({ channelId: r.channelId, params: r.params }));
      const inherited = rel.rows.filter((r) => r.inherited && r.kind === kind);
      head.push(
        `Now: ${now.length ? (await relationWords(now)).join('; ') : 'none of its own'}`,
        `New: ${rows.length ? (await relationWords(rows)).join('; ') : 'none of its own'}`,
        ...(inherited.length ? [`Inherited (they stay): ${(await relationWords(inherited.map((r) => ({ channelId: r.channelId, params: r.params })))).map((x, i) => `${x} from ${inherited[i].from}`).join('; ')}`] : []),
      );
      if (!a.apply) return { text: [...head, `To save it: edit_relations with the same arguments and apply: true.`].join('\n'), applyWith: { apply: true } };
      await saveRelations(level, target.id, { kinds: [kind], rows: rows.map((r) => ({ kind, channelId: r.channelId, params: r.params })) });
      const after = await own(level, target.id, kind);
      head[0] = `${head[0]} — saved. Change id ${changeId} — ${UNDO_HINT}`;
      return { text: head.join('\n'), change: { targetId: target.id, channelIds: [], before: { level, id: target.id, kind, rows: now }, after: { level, id: target.id, kind, rows: after } } };
    },
    'write',
  );
}

// ---------------------------------------------------------------- undo

const stale = (change: string, what: string) => new HttpError(409, `The ${what} changed after change ${change}, so undo would overwrite newer work: nothing was changed.`);

/** JSON with its keys in order: the audit log (JSONB) does not keep the order they were written in. */
const canon = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(v ?? null);

async function restoreList(listId: string, version: number, fields: ListFields, items: ReturnType<typeof itemRows>, lastItemPosition: number | null, change: string) {
  await db.$transaction(async (tx) => {
    const u = await tx.rotationList.updateMany({ where: { id: listId, version, deletedAt: null }, data: { ...fields, lastItemPosition, version: { increment: 1 } } });
    if (u.count !== 1) throw stale(change, 'rotation list');
    await tx.rotationListItem.deleteMany({ where: { listId } });
    if (items.length) await tx.rotationListItem.createMany({ data: items.map((x) => ({ ...x, listId, insertedAt: x.insertedAt ? new Date(x.insertedAt) : null })) });
  });
}

/** Puts back what a change of these tools made; null for a tool that is not one of them. */
export async function undoMedia(e: AuditEvent, change: string): Promise<ToolResult | null> {
  const after = (e.after ?? {}) as Record<string, unknown>;
  const before = (e.before ?? {}) as Record<string, unknown>;
  const done = (text: string, a: object): ToolResult => ({ text, change: { targetId: change, channelIds: [], before: null, after: a } });
  switch (e.action) {
    case 'tool create_category':
    case 'tool create_title':
    case 'tool create_item': {
      const level = after.level as Level;
      const id = after.id as string;
      const row = (await getItem(level, id)) as { version: number };
      if (row.version !== after.version) throw stale(change, level === 'content-type' ? 'category' : level === 'content' ? 'title' : 'item');
      const tree = await subtree(level, [id]);
      if (level === 'content-type' && tree.contents.length) throw new HttpError(409, `The category of change ${change} has titles now: it stays. Nothing was changed.`);
      if (level === 'content' && tree.productions.length) throw new HttpError(409, `The title of change ${change} has items now: it stays. Nothing was changed.`);
      await deleteItems(level, [id]);
      return done(`What change ${change} made is deleted.`, { deleted: id });
    }
    case 'tool edit_category':
    case 'tool edit_title': {
      const level = after.level as Level;
      const id = after.id as string;
      const row = (await getItem(level, id)) as { version: number };
      if (row.version !== after.version) throw stale(change, level === 'content-type' ? 'category' : 'title');
      await saveItem(level, id, { ...(before.fields as object), version: row.version });
      return done(`It is back as it was before change ${change}.`, { id });
    }
    case 'tool create_episodes': {
      const ids = after.ids as string[];
      const rows = await db.production.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { version: true } });
      if (rows.length !== ids.length || rows.some((x) => x.version !== 1)) throw stale(change, 'episodes');
      await deleteItems('production', ids);
      await db.content.updateMany({ where: { id: after.contentId as string, nextProductionId: after.next as number }, data: { nextProductionId: before.next as number } });
      return done(`The ${plural(ids.length, 'episode')} change ${change} made ${ids.length === 1 ? 'is' : 'are'} deleted.`, { deleted: ids });
    }
    case 'tool delete_media': {
      const tree = before.tree as Tree;
      const stamp = new Date(after.stamp as string);
      const back = { deletedAt: null };
      const at = (ids: string[]) => ({ id: { in: ids }, deletedAt: stamp });
      const rels = before.relations as { id: string; tenantId: string; kind: string; level: string; itemId: string; channelId: string | null; position: number; params: object }[];
      await db.$transaction(async (tx) => {
        await tx.contentType.updateMany({ where: at(tree.contentTypes), data: back });
        await tx.content.updateMany({ where: at(tree.contents), data: back });
        await tx.production.updateMany({ where: at(tree.productions), data: back });
        await tx.segmentation.updateMany({ where: at(tree.segmentations), data: back });
        await tx.segment.updateMany({ where: at(tree.segments), data: back });
        if (rels.length) {
          await tx.catalogRelation.createMany({
            data: rels.map((r) => ({ id: r.id, tenantId: r.tenantId, kind: r.kind, level: r.level, itemId: r.itemId, channelId: r.channelId, position: r.position, params: r.params })),
            skipDuplicates: true,
          });
        }
      });
      return done(`What change ${change} deleted is back.`, { restored: true });
    }
    case 'tool create_cut': {
      const id = after.segmentationId as string;
      const s = await db.segmentation.findFirst({ where: { id, deletedAt: null } });
      if (!s || s.version !== after.version) throw stale(change, 'cut');
      const segs = (await db.segment.findMany({ where: { segmentationId: id, deletedAt: null }, select: { id: true } })).map((x) => x.id);
      if ((await db.rotationListItem.count({ where: { segmentationId: id } })) || (await db.playlistEvent.count({ where: { segmentId: { in: segs } } }))) {
        throw new HttpError(409, `The cut of change ${change} is used in a rotation list or a playlist now: it stays. Nothing was changed.`);
      }
      const now = new Date();
      await db.$transaction(async (tx) => {
        await tx.segment.updateMany({ where: { id: { in: segs } }, data: { deletedAt: now } });
        await tx.segmentation.updateMany({ where: { id }, data: { deletedAt: now } });
      });
      return done(`The cut change ${change} made is deleted.`, { deleted: id });
    }
    case 'tool recut': {
      const id = after.segmentationId as string;
      const s = await db.segmentation.findFirst({ where: { id, deletedAt: null } });
      if (!s || s.version !== after.version) throw stale(change, 'cut');
      const fresh = after.segmentIds as string[];
      if (await db.playlistEvent.count({ where: { segmentId: { in: fresh } } })) throw new HttpError(409, `The new parts of change ${change} are used in a playlist now: they stay. Nothing was changed.`);
      await db.$transaction(async (tx) => {
        await tx.segment.updateMany({ where: { id: { in: fresh } }, data: { deletedAt: new Date() } });
        await tx.segment.updateMany({ where: { id: { in: before.segmentIds as string[] } }, data: { deletedAt: null } });
        await tx.segmentation.update({ where: { id }, data: { name: before.name as string, version: { increment: 1 } } });
      });
      return done(`The cut is back as it was before change ${change}.`, { segmentationId: id });
    }
    case 'tool create_rotation_list':
    case 'tool clone_rotation_list': {
      const id = after.listId as string;
      const l = await db.rotationList.findFirst({ where: { id, deletedAt: null } });
      if (!l || l.version !== after.version) throw stale(change, 'rotation list');
      const [check] = await deleteCheck('rotation-list', [id]);
      if (check.usedBy) throw new HttpError(409, `${check.usedBy} the rotation list of change ${change} now: it stays. Nothing was changed.`);
      await deleteItems('rotation-list', [id]);
      return done(`The rotation list change ${change} made is deleted.`, { deleted: id });
    }
    case 'tool edit_rotation_list':
    case 'tool shuffle_rotation_list': {
      await restoreList(after.listId as string, after.version as number, before.fields as ListFields, before.items as ReturnType<typeof itemRows>, before.lastItemPosition as number | null, change);
      return done(`The rotation list is back as it was before change ${change}.`, { listId: after.listId });
    }
    case 'tool delete_rotation_list': {
      const id = before.listId as string;
      await db.rotationList.updateMany({ where: { id }, data: { deletedAt: null } });
      return done(`The rotation list change ${change} deleted is back.`, { listId: id });
    }
    case 'tool edit_relations': {
      const level = after.level as CatalogLevel;
      const id = after.id as string;
      const kind = after.kind as string;
      const now = await own(level, id, kind);
      if (canon(now) !== canon(after.rows)) throw stale(change, 'relations');
      const rows = before.rows as RelRow[];
      await saveRelations(level, id, { kinds: [kind as never], rows: rows.map((r) => ({ kind: kind as never, channelId: r.channelId, params: r.params })) });
      return done(`The relations are back as they were before change ${change}.`, { id });
    }
    default:
      return null;
  }
}

