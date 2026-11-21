// The Catalog page's columns (catalog-page.md "A column"): the rows of one level under the selected
// parent, with search, advanced search, order by and show expired. At most COLUMN_ROWS rows are
// sent, with the total.

import { COLUMN_ROWS, GRAPHIC_START_TYPES, betweenValues, formatTc, frameRate, parseTc, type CatalogLevel, type FrameRate, type SearchCondition } from '@9eye/core';
import type { Prisma } from '@prisma/client';
import { currentTenantId, db, fromIsoDate, platformDb, toIsoDate } from '../db';
import { HttpError } from '../errors';

export interface ColumnRow {
  id: string;
  name: string;
  /** Short text on the right: counts, a length, "template", segment TCs, list order. */
  meta: string;
  /** "amber" for "no length". */
  metaTone: 'amber' | null;
  /** Data colour of the row (the content type's), null = the page's token. */
  color: string | null;
  /** Media is available (MAM). */
  media: boolean;
  /** The last inserted item of a rotation list. */
  last: boolean;
}

export interface ColumnQuery {
  parentId: string | null;
  q: string;
  conditions: SearchCondition[];
  sort: string | null;
  dir: 'asc' | 'desc';
  expired: boolean;
}

/** The company's catalog frame rate and today's date (calendar days, server clock). */
export async function catalogContext(): Promise<{ rate: FrameRate; rateCode: string; today: string }> {
  const t = await platformDb.tenant.findUniqueOrThrow({ where: { id: currentTenantId() } });
  return { rate: frameRate(t.catalogFrameRate), rateCode: t.catalogFrameRate, today: toIsoDate(new Date()) };
}

type FieldType = 'text' | 'ntext' | 'int' | 'nint' | 'tc' | 'date' | 'bool' | 'family' | 'media' | 'source' | 'channel' | 'startType' | 'custom';
interface FieldDef {
  type: FieldType;
  column: string;
}

const T = (column: string): FieldDef => ({ type: 'text', column });
const FIELDS: Record<CatalogLevel, Record<string, FieldDef>> = {
  'content-type': { Name: T('name'), Id: T('code'), Type: { type: 'family', column: 'family' }, 'Show in grid': { type: 'bool', column: 'showInGrid' } },
  content: {
    Title: T('title'), 'Original title': T('originalTitle'), Id: T('code'), Season: { type: 'ntext', column: 'season' }, Genres: T('genres'),
    'Valid from': { type: 'date', column: 'validFrom' }, To: { type: 'date', column: 'validTo' }, Source: { type: 'source', column: 'sourceId' },
  },
  production: {
    Title: T('title'), 'Original title': T('originalTitle'), Id: T('code'), Chapter: { type: 'nint', column: 'chapter' }, Duration: { type: 'tc', column: 'lengthFrames' },
    Starts: { type: 'date', column: 'starts' }, Expires: { type: 'date', column: 'expires' }, Genres: T('genres'), 'Media status': { type: 'media', column: 'mediaStatus' },
    'Additional data': T('additionalData'),
  },
  segmentation: { Name: T('name'), Id: { type: 'int', column: 'code' } },
  segment: { Id: { type: 'int', column: 'code' }, 'TC in': { type: 'tc', column: 'tcInFrames' }, 'TC out': { type: 'tc', column: 'tcOutFrames' }, Duration: { type: 'tc', column: 'lengthFrames' }, 'Media id': T('mediaId') },
  'rotation-list': { Name: T('name') },
  'list-item': { Name: T('name'), Order: { type: 'int', column: 'position' } },
  'graphic-source': { Name: T('name'), Id: T('code'), Channel: { type: 'channel', column: 'channelId' } },
  'graphic-template': { Name: T('name'), 'Start type': { type: 'startType', column: 'startType' } },
  'graphic-object': { Name: T('name'), Code: T('code') },
};

const SORTS: Record<CatalogLevel, Record<string, string[]>> = {
  'content-type': { Name: ['name'], Id: ['code'], Type: ['family', 'name'], 'Created date': ['createdAt'] },
  content: { Title: ['title'], Id: ['code'], Season: ['season', 'title'], 'Created date': ['createdAt'] },
  production: { Chapter: ['chapter', 'title'], Title: ['title'], Id: ['code'], Duration: ['lengthFrames', 'title'], 'Created date': ['createdAt'] },
  segmentation: { Id: ['code'], Name: ['name'] },
  segment: { Id: ['code'], 'TC in': ['tcInFrames', 'code'], Duration: ['lengthFrames', 'code'] },
  'rotation-list': { Name: ['name'], 'Created date': ['createdAt'] },
  'list-item': { Order: ['position', 'name'], Name: ['name'] },
  'graphic-source': { Name: ['name'], Id: ['code'] },
  'graphic-template': { Name: ['name'] },
  'graphic-object': { Name: ['name'], Code: ['code'] },
};

const insensitive = 'insensitive' as const;
const yes = (v: string) => /^(y|yes|true|on|1)$/i.test(v.trim());

/** One advanced-search condition → a Prisma filter (unknown fields and unreadable values are refused). */
async function conditionWhere(level: CatalogLevel, c: SearchCondition, rate: FrameRate): Promise<object> {
  let def = FIELDS[level][c.field];
  if (!def && level === 'production') {
    const cf = await db.customField.findFirst({ where: { entity: 'production', OR: [{ label: c.field }, { key: c.field }] } });
    if (cf) def = { type: 'custom', column: cf.key };
  }
  if (!def) throw new HttpError(400, `"${c.field}" cannot be searched here.`);
  const v = c.value.trim();
  const col = def.column;
  const bad = () => new HttpError(400, `"${v}" is not a valid value for ${c.field}.`);
  const range = <X>(parse: (s: string) => X | null) => {
    const [a, b] = betweenValues(v);
    const pa = parse(a);
    const pb = parse(b);
    if (pa === null || pb === null) throw bad();
    return { gte: pa, lte: pb };
  };
  switch (def.type) {
    case 'text':
    case 'ntext':
      if (c.op === 'empty') return def.type === 'ntext' ? { OR: [{ [col]: null }, { [col]: '' }] } : { [col]: '' };
      if (c.op === 'is') return { [col]: { equals: v, mode: insensitive } };
      if (c.op === 'between') return { [col]: range((s) => s) };
      return { [col]: { contains: v, mode: insensitive } };
    case 'int':
    case 'nint': {
      if (c.op === 'empty') return def.type === 'nint' ? { [col]: null } : { id: { in: [] } };
      const int = (s: string) => (/^-?\d+$/.test(s) ? Number(s) : null);
      if (c.op === 'between') return { [col]: range(int) };
      const n = int(v);
      if (n === null) throw bad();
      return { [col]: n };
    }
    case 'tc': {
      if (c.op === 'empty') return { [col]: null };
      const tc = (s: string) => parseTc(s, rate, { maxHours: 999 });
      if (c.op === 'between') return { [col]: range(tc) };
      const n = tc(v);
      if (n === null) throw bad();
      return { [col]: n };
    }
    case 'date': {
      if (c.op === 'empty') return { [col]: null };
      const d = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? fromIsoDate(s) : null);
      if (c.op === 'between') return { [col]: range(d) };
      const x = d(v);
      if (!x) throw bad();
      return { [col]: x };
    }
    case 'bool':
      return { [col]: c.op === 'empty' ? false : yes(v) };
    case 'family': {
      const f = ['program', 'filling', 'advert'].find((x) => x.startsWith(v.toLowerCase().slice(0, 3)));
      if (c.op === 'empty' || !f) throw bad();
      return { [col]: f };
    }
    case 'media': {
      if (c.op === 'empty') return { [col]: null };
      return { [col]: /not/i.test(v) ? 'not-ready' : /ready/i.test(v) ? 'ready' : '__none__' };
    }
    case 'startType': {
      const st = GRAPHIC_START_TYPES.find((x) => x.label.toLowerCase().includes(v.toLowerCase()) || x.value === v);
      if (!st) throw bad();
      return { [col]: st.value };
    }
    case 'source':
    case 'channel': {
      if (c.op === 'empty') return { [col]: null };
      const rows =
        def.type === 'source'
          ? await db.source.findMany({ where: { name: { contains: v, mode: insensitive } }, select: { id: true } })
          : await db.channel.findMany({ where: { name: { contains: v, mode: insensitive } }, select: { id: true } });
      return { [col]: { in: rows.map((r) => r.id) } };
    }
    case 'custom': {
      // JSON filters cannot ignore case: find the ids with SQL
      const tenantId = currentTenantId();
      const rows =
        c.op === 'empty'
          ? await platformDb.$queryRaw<{ id: string }[]>`SELECT id FROM production WHERE tenant_id = ${tenantId}::uuid AND coalesce(custom_values->>${col}, '') = ''`
          : c.op === 'is'
            ? await platformDb.$queryRaw<{ id: string }[]>`SELECT id FROM production WHERE tenant_id = ${tenantId}::uuid AND lower(custom_values->>${col}) = lower(${v})`
            : await platformDb.$queryRaw<{ id: string }[]>`SELECT id FROM production WHERE tenant_id = ${tenantId}::uuid AND custom_values->>${col} ILIKE ${`%${v.replace(/[%_\\]/g, (m) => `\\${m}`)}%`}`;
      return { id: { in: rows.map((r) => r.id) } };
    }
  }
}

/** Columns that can be empty: they sort last (Prisma takes `nulls` only on those). */
const NULLABLE = new Set(['chapter', 'lengthFrames', 'season', 'tcInFrames', 'tcOutFrames']);

const orderOf = (level: CatalogLevel, sort: string | null, dir: 'asc' | 'desc') => {
  const fields = SORTS[level][sort ?? ''] ?? Object.values(SORTS[level])[0];
  return fields.map((f, i) => ({ [f]: i > 0 ? 'asc' : NULLABLE.has(f) ? { sort: dir, nulls: 'last' as const } : dir }));
};

const short = (frames: number, rate: FrameRate) => formatTc(frames, rate).slice(0, 8);

/** The rows of one column. */
export async function listColumn(level: CatalogLevel, query: ColumnQuery): Promise<{ total: number; rows: ColumnRow[] }> {
  const { rate, today } = await catalogContext();
  const q = query.q.trim();
  const and: object[] = [];
  for (const c of query.conditions) if (c.value.trim() || c.op === 'empty') and.push(await conditionWhere(level, c, rate));
  const text = (...cols: string[]) => (q ? [{ OR: cols.map((c) => ({ [c]: { contains: q, mode: insensitive } })) }] : []);
  const orderBy = orderOf(level, query.sort, query.dir) as never;
  const need = (what: string) => {
    if (!query.parentId) throw new HttpError(400, `Select a ${what} first.`);
    return query.parentId;
  };
  const notExpired = (col: string) => (query.expired ? [] : [{ OR: [{ [col]: null }, { [col]: { gte: fromIsoDate(today) } }] }]);
  const page = { take: COLUMN_ROWS, orderBy };
  const row = (r: Partial<ColumnRow> & { id: string; name: string }): ColumnRow => ({ meta: '', metaTone: null, color: null, media: false, last: false, ...r });

  switch (level) {
    case 'content-type': {
      const where: Prisma.ContentTypeWhereInput = { deletedAt: null, AND: [...and, ...text('name', 'code')] };
      const [total, rows] = await Promise.all([
        db.contentType.count({ where }),
        db.contentType.findMany({ where, ...page, include: { _count: { select: { contents: { where: { deletedAt: null } } } } } }),
      ]);
      return { total, rows: rows.map((t) => row({ id: t.id, name: t.name, meta: String(t._count.contents), color: t.color })) };
    }
    case 'content': {
      const type = await db.contentType.findFirst({ where: { id: need('category'), deletedAt: null } });
      if (!type) throw new HttpError(404, 'Category not found.');
      const where: Prisma.ContentWhereInput = { contentTypeId: type.id, deletedAt: null, AND: [...and, ...text('title', 'code'), ...notExpired('validTo')] };
      const [total, rows] = await Promise.all([
        db.content.count({ where }),
        db.content.findMany({ where, ...page, include: { _count: { select: { productions: { where: { deletedAt: null, isTemplate: false } } } } } }),
      ]);
      return { total, rows: rows.map((c) => row({ id: c.id, name: c.title, meta: String(c._count.productions), color: type.color })) };
    }
    case 'production': {
      const content = await db.content.findFirst({ where: { id: need('content'), deletedAt: null }, include: { contentType: true } });
      if (!content) throw new HttpError(404, 'Title not found.');
      const where: Prisma.ProductionWhereInput = { contentId: content.id, deletedAt: null, AND: [...and, ...text('title', 'code'), ...notExpired('expires')] };
      const [total, rows] = await Promise.all([db.production.count({ where }), db.production.findMany({ where, ...page })]);
      return {
        total,
        rows: rows.map((p) =>
          row({
            id: p.id, name: p.title, color: content.contentType.color, media: p.mediaAvailable,
            meta: p.isTemplate ? 'template' : p.lengthFrames === null ? 'no length' : short(p.lengthFrames, rate),
            metaTone: !p.isTemplate && p.lengthFrames === null ? 'amber' : null,
          }),
        ),
      };
    }
    case 'segmentation': {
      const prod = await db.production.findFirst({ where: { id: need('production'), deletedAt: null }, include: { content: { include: { contentType: true } } } });
      if (!prod) throw new HttpError(404, 'Item not found.');
      const where: Prisma.SegmentationWhereInput = { productionId: prod.id, deletedAt: null, AND: [...and, ...text('name')] };
      const [total, rows] = await Promise.all([db.segmentation.count({ where }), db.segmentation.findMany({ where, ...page })]);
      return { total, rows: rows.map((s) => row({ id: s.id, name: s.name, meta: `#${s.code}`, color: prod.content.contentType.color, media: s.mediaAvailable })) };
    }
    case 'segment': {
      const segm = await db.segmentation.findFirst({ where: { id: need('segmentation'), deletedAt: null }, include: { production: { include: { content: { include: { contentType: true } } } } } });
      if (!segm) throw new HttpError(404, 'Cut not found.');
      const where: Prisma.SegmentWhereInput = { segmentationId: segm.id, deletedAt: null, AND: [...and, ...text('mediaId', 'notes')] };
      const [total, rows] = await Promise.all([db.segment.count({ where }), db.segment.findMany({ where, ...page })]);
      return {
        total,
        rows: rows.map((s) =>
          row({
            id: s.id, name: `Part ${s.code}`, color: segm.production.content.contentType.color, media: s.mediaAvailable,
            meta: s.tcInFrames !== null && s.tcOutFrames !== null ? `${short(s.tcInFrames, rate)}–${short(s.tcOutFrames, rate)}` : '',
          }),
        ),
      };
    }
    case 'rotation-list': {
      const where: Prisma.RotationListWhereInput = { deletedAt: null, AND: [...and, ...text('name')] };
      const [total, rows] = await Promise.all([db.rotationList.count({ where }), db.rotationList.findMany({ where, ...page, include: { _count: { select: { items: true } } } })]);
      return { total, rows: rows.map((l) => row({ id: l.id, name: l.name, meta: l._count.items ? String(l._count.items) : '' })) };
    }
    case 'list-item': {
      const list = await db.rotationList.findFirst({ where: { id: need('rotation list'), deletedAt: null } });
      if (!list) throw new HttpError(404, 'Rotation list not found.');
      const where: Prisma.RotationListItemWhereInput = { listId: list.id, AND: [...and, ...text('name')] };
      const [total, rows] = await Promise.all([db.rotationListItem.count({ where }), db.rotationListItem.findMany({ where, ...page })]);
      return { total, rows: rows.map((i) => row({ id: i.id, name: i.name, meta: `#${i.position}`, last: list.lastItemPosition !== null && i.position === list.lastItemPosition })) };
    }
    case 'graphic-source': {
      const where: Prisma.GraphicSourceWhereInput = { deletedAt: null, AND: [...and, ...text('name', 'code')] };
      const [total, rows, channels] = await Promise.all([db.graphicSource.count({ where }), db.graphicSource.findMany({ where, ...page }), db.channel.findMany({ select: { id: true, name: true } })]);
      return { total, rows: rows.map((g) => row({ id: g.id, name: g.name, meta: channels.find((c) => c.id === g.channelId)?.name ?? '' })) };
    }
    case 'graphic-template': {
      const where: Prisma.GraphicTemplateWhereInput = { sourceId: need('graphic source'), deletedAt: null, AND: [...and, ...text('name')] };
      const [total, rows] = await Promise.all([db.graphicTemplate.count({ where }), db.graphicTemplate.findMany({ where, ...page })]);
      return { total, rows: rows.map((g) => row({ id: g.id, name: g.name, meta: GRAPHIC_START_TYPES.find((s) => s.value === g.startType)?.label ?? '' })) };
    }
    case 'graphic-object': {
      const where: Prisma.GraphicObjectWhereInput = { sourceId: need('graphic source'), deletedAt: null, AND: [...and, ...text('name', 'code')] };
      const [total, rows] = await Promise.all([db.graphicObject.count({ where }), db.graphicObject.findMany({ where, ...page })]);
      return { total, rows: rows.map((g) => row({ id: g.id, name: g.name, meta: g.code })) };
    }
  }
}
