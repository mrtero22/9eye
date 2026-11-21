// One catalog item for the Catalog page's form: read, create (also from a template), save with its
// version (catalog-page.md "Form panel"). Every field of data model §4a + §4b, checked here.

import { productionIdFrom, uuidv7, type CatalogLevel } from '@9eye/core';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db, fromIsoDate, toIsoDate } from '../db';
import { HttpError, notFound } from '../errors';

const id = z.uuid();
const text = (max = 4000) => z.string().max(max).default('');
const req = (what: string) => z.string().trim().min(1, `${what} is required`).max(400);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD').nullable().default(null);
const frames = z.number().int().min(0).max(1_000_000_000).nullable().default(null);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'use #rrggbb');
const ids = z.array(id).max(500).default([]);
const names = z.array(z.string().trim().min(1).max(200)).max(500).default([]);
const media = z.enum(['ready', 'not-ready']).nullable().default(null);
const layer = z.enum(['auto', '1', '2', '3', '4']).default('auto');

export const FIELD_SCHEMAS = {
  'content-type': z.object({
    name: req('Name'), code: req('Id'), color: hex, family: z.enum(['program', 'filling', 'advert']),
    showInGrid: z.boolean().default(false), showTitleInGrid: z.boolean().default(false), showSegmentInGrid: z.boolean().default(false), showChapterInGrid: z.boolean().default(false),
    hasLogo: z.boolean().default(false), contractFree: z.boolean().default(false), showInEpg: z.boolean().default(false), epgNameFromBlock: z.boolean().default(false),
    epgNameFromContent: z.boolean().default(false), epgShortFromContent: z.boolean().default(false), epgShortFromProduction: z.boolean().default(false),
    epgDescFromContent: z.boolean().default(false), epgDescFromProduction: z.boolean().default(false), showInPress: z.boolean().default(false),
  }),
  content: z.object({
    title: req('Title'), originalTitle: text(400), code: req('Id'), nextProductionId: z.number().int().min(0).max(1_000_000_000), season: z.string().max(100).nullable().default(null),
    lengthFrames: frames, segmentCount: z.number().int().min(1).max(500).default(1), sourceId: id.nullable().default(null),
    genres: text(), directors: text(), nationalities: text(), languages: text(), countries: names, synopsis: text(20000), epgDescription: text(20000), notes: text(20000),
    ageLogoId: id.nullable().default(null), channelLogoId: id.nullable().default(null), logo1Id: id.nullable().default(null), logo2Id: id.nullable().default(null),
    logo3Id: id.nullable().default(null), logo4Id: id.nullable().default(null), channelIds: ids, companies: names, secondaryActionIds: ids,
    validFrom: isoDate, validTo: isoDate,
  }),
  production: z.object({
    title: req('Title'), originalTitle: text(400), code: z.string().trim().max(400).default(''), chapter: z.number().int().min(0).max(1_000_000), isDefaultChapter: z.boolean().default(false),
    lengthFrames: frames, sourceId: id, segmentCount: z.number().int().min(1).max(500).default(1), starts: isoDate, expires: isoDate,
    genres: text(), thematics: text(), directors: text(), actors: text(), nationalities: text(), languages: text(), countries: names,
    synopsis: text(20000), epgDescription: text(20000), notes: text(20000), channelIds: ids, secondaryActionIds: ids,
    customValues: z.record(z.string().max(100), z.string().max(4000)).default({}), mediaStatus: media, publishedExternally: z.boolean().default(false),
    externalId: text(400), thumbnail: text(2000), additionalData: text(20000),
  }),
  segmentation: z.object({ code: z.number().int().min(0).max(100000), name: req('Name'), publishedExternally: z.boolean().default(false), externalId: text(400), thumbnail: text(2000) }),
  segment: z.object({
    code: z.number().int().min(0).max(100000), sourceId: id, mediaId: text(400), tcInFrames: frames, tcOutFrames: frames, lengthFrames: frames, notes: text(20000),
    publishedExternally: z.boolean().default(false), externalId: text(400), thumbnail: text(2000),
  }),
  'rotation-list': z.object({
    name: req('Name'), insertionDaysInterval: z.number().int().min(0).max(3650).default(0), allowSameDayRepeat: z.boolean().default(false), randomInsert: z.boolean().default(false),
    applyChannelRestrictions: z.boolean().default(false), allowProductionRepeats: z.boolean().default(false), allowOverlap: z.boolean().default(false),
  }),
  'list-item': z.object({ position: z.number().int().min(0).max(1_000_000) }),
  'graphic-source': z.object({ name: req('Name'), code: req('Id'), channelId: id }),
  'graphic-template': z.object({
    name: req('Name'), sourceId: id, objectId: id.nullable().default(null), description: text(4000),
    startType: z.enum(['from-start', 'at-tc', 'manual', 'to-end']), startOffsetFrames: z.number().int().min(0), startTcInFrames: z.number().int().min(0),
    endType: z.enum(['automatic', 'duration', 'until-end', 'manual']), endDurationFrames: z.number().int().min(0), endTcOutFrames: z.number().int().min(0),
    frequency: z.enum(['once', 'n-times', 'until-end']), repeatIntervalFrames: z.number().int().min(0), repeatCount: z.number().int().min(0).max(100000), layer,
  }),
  'graphic-object': z.object({ name: req('Name'), code: req('Code'), sourceId: id, layer }),
} satisfies Record<CatalogLevel, z.ZodType>;

type Fields<L extends CatalogLevel> = z.infer<(typeof FIELD_SCHEMAS)[L]>;

/** The parent a new item is created under (content type for a content, and so on). */
const PARENT_KEY: Partial<Record<CatalogLevel, string>> = {
  content: 'contentTypeId', production: 'contentId', segmentation: 'productionId', segment: 'segmentationId', 'list-item': 'listId',
};

const d = (x: Date | null) => (x ? toIsoDate(x) : null);
const date = (s: string | null) => (s ? fromIsoDate(s) : null);

// ---------------------------------------------------------------- read

/** An item as the form shows it: its fields, its version, and the names of what it hangs under. */
export async function getItem(level: CatalogLevel, itemId: string): Promise<Record<string, unknown>> {
  switch (level) {
    case 'content-type': {
      const t = await db.contentType.findFirst({ where: { id: itemId, deletedAt: null } });
      if (!t) throw notFound('Category');
      const { tenantId: _t, importRef: _i, createdAt: _c, updatedAt: _u, deletedAt: _d, ...rest } = t;
      return rest;
    }
    case 'content': {
      const c = await db.content.findFirst({ where: { id: itemId, deletedAt: null }, include: { contentType: true } });
      if (!c) throw notFound('Title');
      const { tenantId: _t, importRef: _i, createdAt: _c, updatedAt: _u, deletedAt: _d, contentType, validFrom, validTo, ...rest } = c;
      return { ...rest, validFrom: d(validFrom), validTo: d(validTo), contentTypeName: contentType.name, family: contentType.family };
    }
    case 'production': {
      const p = await db.production.findFirst({ where: { id: itemId, deletedAt: null }, include: { content: { include: { contentType: true } }, source: true } });
      if (!p) throw notFound('Item');
      const { tenantId: _t, importRef: _i, createdAt: _c, updatedAt: _u, deletedAt: _d, content, source, starts, expires, ...rest } = p;
      return {
        ...rest, starts: d(starts), expires: d(expires), contentTitle: content.title, contentTypeId: content.contentTypeId, family: content.contentType.family,
        sourcePattern: source ? (source.mediaIdGeneration === 'custom' ? source.customPattern : '') : '', sourceName: source?.name ?? null,
      };
    }
    case 'segmentation': {
      const s = await db.segmentation.findFirst({ where: { id: itemId, deletedAt: null }, include: { production: true } });
      if (!s) throw notFound('Cut');
      const { tenantId: _t, importRef: _i, createdAt: _c, updatedAt: _u, deletedAt: _d, production, ...rest } = s;
      const segs = await db.segment.aggregate({ where: { segmentationId: s.id, deletedAt: null }, _count: { _all: true }, _max: { tcOutFrames: true } });
      return { ...rest, productionTitle: production.title, productionCode: production.code, productionLengthFrames: production.lengthFrames, segmentCount: segs._count._all, segmentsEndFrames: segs._max.tcOutFrames };
    }
    case 'segment': {
      const s = await segmentOfTenant(itemId);
      const { importRef: _i, createdAt: _c, updatedAt: _u, deletedAt: _d, segmentation, ...rest } = s;
      return { ...rest, segmentationName: segmentation.name, productionCode: segmentation.production.code };
    }
    case 'rotation-list': {
      const l = await db.rotationList.findFirst({ where: { id: itemId, deletedAt: null } });
      if (!l) throw notFound('Rotation list');
      const last = l.lastItemPosition === null ? null : await db.rotationListItem.findFirst({ where: { listId: l.id, position: l.lastItemPosition } });
      const items = await db.rotationListItem.findMany({ where: { listId: l.id }, select: { productionId: true } });
      const { tenantId: _t, importRef: _i, createdAt: _c, updatedAt: _u, deletedAt: _d, ...rest } = l;
      return { ...rest, lastItemName: last?.name ?? null, productionIds: items.map((i) => i.productionId) };
    }
    case 'list-item': {
      const i = await listItemOfTenant(itemId);
      return {
        id: i.id, listId: i.listId, name: i.name, position: i.position, insertedAt: i.insertedAt ? i.insertedAt.toISOString() : null, version: 1,
        productionId: i.productionId, productionTitle: i.production.title, segmentationName: i.segmentation?.name ?? null,
      };
    }
    case 'graphic-source': {
      const g = await db.graphicSource.findFirst({ where: { id: itemId, deletedAt: null } });
      if (!g) throw notFound('Graphic source');
      const { tenantId: _t, importRef: _i, createdAt: _c, updatedAt: _u, deletedAt: _d, ...rest } = g;
      return rest;
    }
    case 'graphic-template': {
      const g = await db.graphicTemplate.findFirst({ where: { id: itemId, deletedAt: null } });
      if (!g) throw notFound('Graphic template');
      const { tenantId: _t, importRef: _i, createdAt: _c, updatedAt: _u, deletedAt: _d, ...rest } = g;
      return rest;
    }
    case 'graphic-object': {
      const g = await db.graphicObject.findFirst({ where: { id: itemId, deletedAt: null } });
      if (!g) throw notFound('Graphic object');
      const { tenantId: _t, importRef: _i, createdAt: _c, updatedAt: _u, deletedAt: _d, ...rest } = g;
      return rest;
    }
  }
}

/** A segment of this company (segments carry no tenant id: reached through their segmentation). */
export async function segmentOfTenant(segmentId: string) {
  const s = await db.segment.findFirst({ where: { id: segmentId, deletedAt: null }, include: { segmentation: { include: { production: true } } } });
  if (!s) throw notFound('Part');
  const own = await db.segmentation.findFirst({ where: { id: s.segmentationId }, select: { id: true } });
  if (!own) throw notFound('Part');
  return s;
}

export async function listItemOfTenant(itemId: string) {
  const i = await db.rotationListItem.findFirst({ where: { id: itemId }, include: { production: true, segmentation: true } });
  if (!i) throw notFound('List item');
  const own = await db.rotationList.findFirst({ where: { id: i.listId, deletedAt: null }, select: { id: true } });
  if (!own) throw notFound('List item');
  return i;
}

// ---------------------------------------------------------------- checks of the references

async function checkRefs(level: CatalogLevel, f: Record<string, unknown>) {
  const problems: string[] = [];
  const one = async (label: string, idv: unknown, find: (x: string) => Promise<unknown>) => {
    if (typeof idv === 'string' && !(await find(idv))) problems.push(`${label} does not exist.`);
  };
  if (level === 'content' || level === 'production' || level === 'segment') await one('The source', f.sourceId, (x) => db.source.findFirst({ where: { id: x } }));
  await one('The channel', f.channelId, (x) => db.channel.findFirst({ where: { id: x, deletedAt: null } }));
  if (Array.isArray(f.channelIds) && f.channelIds.length) {
    const n = await db.channel.count({ where: { id: { in: f.channelIds as string[] }, deletedAt: null } });
    if (n !== new Set(f.channelIds).size) problems.push('A channel does not exist.');
  }
  if (Array.isArray(f.secondaryActionIds) && f.secondaryActionIds.length) {
    const n = await db.secondaryAction.count({ where: { id: { in: f.secondaryActionIds as string[] } } });
    if (n !== new Set(f.secondaryActionIds).size) problems.push('A secondary action does not exist.');
  }
  const LOGO_FIELDS: [string, number][] = [['ageLogoId', 1], ['channelLogoId', 2], ['logo1Id', 3], ['logo2Id', 4], ['logo3Id', 5], ['logo4Id', 6]];
  for (const [k, n] of LOGO_FIELDS) {
    if (typeof f[k] !== 'string') continue;
    const logo = await db.logo.findFirst({ where: { id: f[k] as string }, include: { logoType: true } });
    if (!logo || logo.logoType.number !== n) problems.push(`The ${k.replace('Id', '').replace(/(\d)/, ' $1')} logo is not a logo of that type.`);
  }
  if (level === 'production' && f.customValues) {
    const keys = new Set((await db.customField.findMany({ where: { entity: 'production' } })).map((c) => c.key));
    for (const k of Object.keys(f.customValues as object)) if (!keys.has(k)) problems.push(`${k} is not a custom field of this company.`);
  }
  if (level === 'graphic-template' || level === 'graphic-object') {
    if (!(await db.graphicSource.findFirst({ where: { id: f.sourceId as string, deletedAt: null } }))) problems.push('The graphic source does not exist.');
    if (typeof f.objectId === 'string' && !(await db.graphicObject.findFirst({ where: { id: f.objectId, deletedAt: null } }))) problems.push('The graphic object does not exist.');
  }
  const uniq = [...new Set(problems)];
  if (uniq.length) throw new HttpError(400, uniq[0], uniq.map((message) => ({ code: 'reference', message })));
}

/** Prisma data for a level's fields (dates as dates). */
function data<L extends CatalogLevel>(level: L, f: Fields<L>): Record<string, unknown> {
  const x = { ...(f as Record<string, unknown>) };
  for (const k of ['validFrom', 'validTo', 'starts', 'expires']) if (k in x) x[k] = date(x[k] as string | null);
  if (level === 'production') x.customValues = (x.customValues ?? {}) as Prisma.InputJsonValue;
  return x;
}

// ---------------------------------------------------------------- create

/** Creates an item under its parent. A production without an Id gets one from its source's pattern. */
export async function createItem(level: CatalogLevel, parentId: string | null, body: unknown): Promise<{ id: string }> {
  const f = FIELD_SCHEMAS[level].parse(body) as Record<string, unknown>;
  await checkRefs(level, f);
  const key = PARENT_KEY[level];
  if (key && !parentId) throw new HttpError(400, 'Select where the new item goes first.');
  const newId = uuidv7();
  const row = data(level, f as never);
  switch (level) {
    case 'content-type':
      await db.contentType.create({ data: { id: newId, ...row } as never });
      break;
    case 'content': {
      if (!(await db.contentType.findFirst({ where: { id: parentId!, deletedAt: null } }))) throw notFound('Category');
      await db.content.create({ data: { id: newId, contentTypeId: parentId!, ...row } as never });
      break;
    }
    case 'production': {
      const content = await db.content.findFirst({ where: { id: parentId!, deletedAt: null }, include: { contentType: true } });
      if (!content) throw notFound('Title');
      await db.$transaction(async (tx) => {
        let code = String(row.code ?? '').trim();
        if (!code) {
          const source = await tx.source.findFirst({ where: { id: row.sourceId as string } });
          code = productionIdFrom(source?.mediaIdGeneration === 'custom' ? source.customPattern : '', {
            typeCode: content.contentType.code, contentCode: content.code, chapter: row.chapter as number, next: content.nextProductionId,
          });
          await tx.content.update({ where: { id: content.id }, data: { nextProductionId: { increment: 1 } } });
        }
        await tx.production.create({ data: { id: newId, contentId: content.id, ...row, code } as never });
      });
      break;
    }
    case 'segmentation': {
      if (!(await db.production.findFirst({ where: { id: parentId!, deletedAt: null } }))) throw notFound('Item');
      await db.segmentation.create({ data: { id: newId, productionId: parentId!, ...row } as never });
      break;
    }
    case 'segment': {
      if (!(await db.segmentation.findFirst({ where: { id: parentId!, deletedAt: null } }))) throw notFound('Cut');
      await db.segment.create({ data: { id: newId, segmentationId: parentId!, ...row } as never });
      break;
    }
    case 'rotation-list':
      await db.rotationList.create({ data: { id: newId, ...row } as never });
      break;
    case 'list-item':
      throw new HttpError(400, 'Add items to a rotation list from the catalog.');
    case 'graphic-source':
      await db.graphicSource.create({ data: { id: newId, ...row } as never });
      break;
    case 'graphic-template':
      await db.graphicTemplate.create({ data: { id: newId, ...row } as never });
      break;
    case 'graphic-object':
      await db.graphicObject.create({ data: { id: newId, ...row } as never });
      break;
  }
  return { id: newId };
}

// ---------------------------------------------------------------- save

const STALE = () => new HttpError(409, 'Someone else saved this item first. Reload it and make your change again.');

/** Saves an item's fields with its version: a different version is refused, nothing written. */
export async function saveItem(level: CatalogLevel, itemId: string, body: unknown): Promise<{ version: number }> {
  const version = z.object({ version: z.number().int() }).parse(body).version;
  const f = FIELD_SCHEMAS[level].parse(body) as Record<string, unknown>;
  await checkRefs(level, f);
  const row = data(level, f as never);
  const next = { ...row, version: { increment: 1 } } as never;
  const where = { id: itemId, version, deletedAt: null };
  let n = 0;
  switch (level) {
    case 'content-type':
      n = (await db.contentType.updateMany({ where, data: next })).count;
      break;
    case 'content':
      n = (await db.content.updateMany({ where, data: next })).count;
      break;
    case 'production':
      n = (await db.production.updateMany({ where, data: next })).count;
      break;
    case 'segmentation':
      n = (await db.segmentation.updateMany({ where, data: next })).count;
      break;
    case 'segment':
      await segmentOfTenant(itemId);
      n = (await db.segment.updateMany({ where, data: next })).count;
      break;
    case 'rotation-list':
      n = (await db.rotationList.updateMany({ where, data: next })).count;
      break;
    case 'list-item':
      await listItemOfTenant(itemId);
      n = (await db.rotationListItem.updateMany({ where: { id: itemId }, data: row })).count;
      return { version: 1 };
    case 'graphic-source':
      n = (await db.graphicSource.updateMany({ where, data: next })).count;
      break;
    case 'graphic-template':
      n = (await db.graphicTemplate.updateMany({ where, data: next })).count;
      break;
    case 'graphic-object':
      n = (await db.graphicObject.updateMany({ where, data: next })).count;
      break;
  }
  if (!n) {
    await getItem(level, itemId); // 404 when it is gone
    throw STALE();
  }
  return { version: version + 1 };
}
