// The Catalog page's operations (catalog-page.md "Actions" and "Dialogs"), all-or-nothing: delete
// (refused while anything uses the items), bulk edit, create series, create / regenerate a
// segmentation, rotation lists (clone, add productions, shuffle), relations, and the lists the
// forms pick from.

import {
  BULK_EDIT_MAX,
  BULK_FIELDS,
  SERIES_MAX,
  productionIdFrom,
  relationTabs,
  seriesTitles,
  splitSegments,
  uuidv7,
  type CatalogLevel,
  type RelationKind,
} from '@9eye/core';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { currentTenantId, db, fromIsoDate, platformDb, type Tx } from '../db';
import { HttpError, notFound } from '../errors';
import { catalogContext } from './catalogBrowse';
import { listItemOfTenant, segmentOfTenant } from './catalogItems';

const id = z.uuid();

// ---------------------------------------------------------------- what is under an item, what uses it

interface Tree {
  contents: string[];
  productions: string[];
  segmentations: string[];
  segments: string[];
}

/** Everything under the given items (an item counts as under itself). */
async function treeOf(level: CatalogLevel, ids: string[]): Promise<Tree> {
  const t: Tree = { contents: [], productions: [], segmentations: [], segments: [] };
  if (level === 'content-type') t.contents = (await db.content.findMany({ where: { contentTypeId: { in: ids }, deletedAt: null }, select: { id: true } })).map((r) => r.id);
  if (level === 'content') t.contents = ids;
  if (level === 'content-type' || level === 'content') {
    t.productions = (await db.production.findMany({ where: { contentId: { in: t.contents }, deletedAt: null }, select: { id: true } })).map((r) => r.id);
  }
  if (level === 'production') t.productions = ids;
  if (['content-type', 'content', 'production'].includes(level)) {
    t.segmentations = (await db.segmentation.findMany({ where: { productionId: { in: t.productions }, deletedAt: null }, select: { id: true } })).map((r) => r.id);
  }
  if (level === 'segmentation') t.segmentations = ids;
  if (['content-type', 'content', 'production', 'segmentation'].includes(level)) {
    t.segments = (await db.segment.findMany({ where: { segmentationId: { in: t.segmentations }, deletedAt: null }, select: { id: true } })).map((r) => r.id);
  }
  if (level === 'segment') t.segments = ids;
  return t;
}

const USED_ORDERS = 'Used in plans or playlists';
const USED_LISTS = 'Used in rotation lists';
const USED_JINGLE = 'Used as a sting in relations';
const USED_BLOCKS = 'Used by block types';
const USED_GRAPHICS = 'Used in graphics relations';
const USED_TEMPLATES = 'Used by graphic templates';

/** Productions used by orders (not deleted), by rotation lists, or as a jingle. */
async function productionUse(productionIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!productionIds.length) return out;
  for (const r of await db.orderItem.findMany({ where: { productionId: { in: productionIds }, order: { deletedAt: null, tenantId: currentTenantId() } }, select: { productionId: true } })) {
    out.set(r.productionId, USED_ORDERS);
  }
  for (const r of await db.rotationListItem.findMany({ where: { productionId: { in: productionIds }, list: { deletedAt: null, tenantId: currentTenantId() } }, select: { productionId: true } })) {
    if (!out.has(r.productionId)) out.set(r.productionId, USED_LISTS);
  }
  const set = new Set(productionIds);
  for (const r of await db.catalogRelation.findMany({ where: { kind: 'linear' } })) {
    const p = String((r.params as { productionId?: string }).productionId ?? '');
    if (set.has(p) && !out.has(p)) out.set(p, USED_JINGLE);
  }
  return out;
}

const TABLE: Partial<Record<CatalogLevel, string>> = {
  'content-type': 'contentType', content: 'content', production: 'production', segmentation: 'segmentation', segment: 'segment',
  'rotation-list': 'rotationList', 'graphic-source': 'graphicSource', 'graphic-template': 'graphicTemplate', 'graphic-object': 'graphicObject',
};

/** Names of items of a level (only this company's). */
async function namesOf(level: CatalogLevel, ids: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  const put = (rows: { id: string; name?: string; title?: string }[]) => rows.forEach((r) => m.set(r.id, r.name ?? r.title ?? ''));
  const where = { id: { in: ids } };
  if (level === 'content-type') put(await db.contentType.findMany({ where: { ...where, deletedAt: null } }));
  if (level === 'content') put(await db.content.findMany({ where: { ...where, deletedAt: null } }));
  if (level === 'production') put(await db.production.findMany({ where: { ...where, deletedAt: null } }));
  if (level === 'segmentation') put(await db.segmentation.findMany({ where: { ...where, deletedAt: null } }));
  if (level === 'segment') for (const x of ids) m.set(x, `Part ${(await segmentOfTenant(x)).code}`);
  if (level === 'rotation-list') put(await db.rotationList.findMany({ where: { ...where, deletedAt: null } }));
  if (level === 'list-item') for (const x of ids) m.set(x, (await listItemOfTenant(x)).name);
  if (level === 'graphic-source') put(await db.graphicSource.findMany({ where: { ...where, deletedAt: null } }));
  if (level === 'graphic-template') put(await db.graphicTemplate.findMany({ where: { ...where, deletedAt: null } }));
  if (level === 'graphic-object') put(await db.graphicObject.findMany({ where: { ...where, deletedAt: null } }));
  return m;
}

export interface DeleteRow {
  id: string;
  name: string;
  /** Why it cannot be deleted; null = it can. */
  usedBy: string | null;
}

/** What a delete would do: each ticked item, and whether anything uses it or what is under it. */
export async function deleteCheck(level: CatalogLevel, ids: string[]): Promise<DeleteRow[]> {
  const names = await namesOf(level, ids);
  const missing = ids.filter((x) => !names.has(x));
  if (missing.length) throw new HttpError(404, 'Some of the ticked items no longer exist. Refresh the column.');
  const out: DeleteRow[] = [];
  for (const itemId of ids) {
    let usedBy: string | null = null;
    if (['content-type', 'content', 'production', 'segmentation', 'segment'].includes(level)) {
      const tree = await treeOf(level, [itemId]);
      let prods = tree.productions;
      if (level === 'segmentation') prods = (await db.segmentation.findMany({ where: { id: itemId }, select: { productionId: true } })).map((s) => s.productionId);
      if (level === 'segment') prods = [(await segmentOfTenant(itemId)).segmentation.productionId];
      const use = await productionUse(prods);
      const uses = [...use.values()];
      // a segmentation or segment counts as used when its production is in an order (airings place segments)
      usedBy = level === 'segmentation' || level === 'segment' ? (uses.includes(USED_ORDERS) ? USED_ORDERS : null) : (uses[0] ?? null);
      if (!usedBy && level === 'segmentation' && (await db.rotationListItem.count({ where: { segmentationId: itemId, list: { deletedAt: null } } }))) usedBy = USED_LISTS;
    }
    if (level === 'rotation-list') {
      const n = (await db.blockType.count({ where: { rotationListId: itemId, deletedAt: null } })) + (await db.templateBlock.count({ where: { rotationListId: itemId, template: { tenantId: currentTenantId(), deletedAt: null } } }));
      if (n) usedBy = USED_BLOCKS;
    }
    if (level === 'graphic-template' || level === 'graphic-source') {
      const templates = level === 'graphic-template' ? [itemId] : (await db.graphicTemplate.findMany({ where: { sourceId: itemId, deletedAt: null }, select: { id: true } })).map((t) => t.id);
      const rel = await db.catalogRelation.findMany({ where: { kind: 'graphics' } });
      if (rel.some((r) => templates.includes(String((r.params as { graphicTemplateId?: string }).graphicTemplateId)))) usedBy = USED_GRAPHICS;
    }
    if (level === 'graphic-object' && (await db.graphicTemplate.count({ where: { objectId: itemId, deletedAt: null } }))) usedBy = USED_TEMPLATES;
    out.push({ id: itemId, name: names.get(itemId) ?? '', usedBy });
  }
  return out;
}

/** Deletes the ticked items and everything under them — or nothing, when any of them is used. */
export async function deleteItems(level: CatalogLevel, ids: string[]): Promise<{ deleted: number }> {
  const rows = await deleteCheck(level, ids);
  const used = rows.filter((r) => r.usedBy);
  if (used.length) {
    throw new HttpError(409, 'Nothing was deleted: some of the items are used. Remove the airings or events that use them first.', used.map((r) => ({ code: 'used', message: `${r.name}: ${r.usedBy}` })));
  }
  const now = new Date();
  await db.$transaction(async (tx) => {
    const soft = { deletedAt: now };
    if (['content-type', 'content', 'production', 'segmentation', 'segment'].includes(level)) {
      const tree = await treeOf(level, ids);
      if (level === 'content-type') await tx.contentType.updateMany({ where: { id: { in: ids } }, data: soft });
      await tx.content.updateMany({ where: { id: { in: tree.contents } }, data: soft });
      await tx.production.updateMany({ where: { id: { in: tree.productions } }, data: soft });
      await tx.segmentation.updateMany({ where: { id: { in: tree.segmentations } }, data: soft });
      await tx.segment.updateMany({ where: { id: { in: tree.segments } }, data: soft });
      await tx.catalogRelation.deleteMany({ where: { itemId: { in: [...ids, ...tree.contents, ...tree.productions, ...tree.segmentations, ...tree.segments] } } });
    }
    if (level === 'rotation-list') await tx.rotationList.updateMany({ where: { id: { in: ids } }, data: soft });
    if (level === 'list-item') await tx.rotationListItem.deleteMany({ where: { id: { in: ids } } });
    if (level === 'graphic-source') {
      await tx.graphicTemplate.updateMany({ where: { sourceId: { in: ids } }, data: soft });
      await tx.graphicObject.updateMany({ where: { sourceId: { in: ids } }, data: soft });
      await tx.graphicSource.updateMany({ where: { id: { in: ids } }, data: soft });
    }
    if (level === 'graphic-template') await tx.graphicTemplate.updateMany({ where: { id: { in: ids } }, data: soft });
    if (level === 'graphic-object') await tx.graphicObject.updateMany({ where: { id: { in: ids } }, data: soft });
  });
  return { deleted: ids.length };
}

// ---------------------------------------------------------------- bulk edit

export const bulkBody = z.object({
  ids: z.array(id).min(1).max(1000),
  changes: z.array(z.object({ field: z.string().max(100), op: z.enum(['set', 'clear']), value: z.string().max(4000).default('') })).min(1).max(40),
});

/** Sets or clears fields on up to BULK_EDIT_MAX contents or productions, all-or-nothing. */
export async function bulkEdit(level: 'content' | 'production', body: z.infer<typeof bulkBody>): Promise<{ updated: number }> {
  if (body.ids.length > BULK_EDIT_MAX) throw new HttpError(400, `You have ticked ${body.ids.length} items. Bulk edit takes at most ${BULK_EDIT_MAX}; tick fewer.`);
  const custom = level === 'production' ? await db.customField.findMany({ where: { entity: 'production' } }) : [];
  const allowed = new Set([...BULK_FIELDS[level], ...custom.map((c) => c.label)]);
  const problems: string[] = [];
  const set: Record<string, unknown> = {};
  const customSet: Record<string, string | null> = {};
  for (const c of body.changes) {
    if (!allowed.has(c.field)) {
      problems.push(`${c.field} cannot be bulk edited.`);
      continue;
    }
    const v = c.value.trim();
    const clear = c.op === 'clear';
    const cf = custom.find((x) => x.label === c.field);
    if (cf) {
      customSet[cf.key] = clear ? null : v;
      continue;
    }
    const dateOf = (col: string) => {
      if (clear) set[col] = null;
      else if (/^\d{4}-\d{2}-\d{2}$/.test(v)) set[col] = fromIsoDate(v);
      else problems.push(`${c.field}: use YYYY-MM-DD.`);
    };
    switch (c.field) {
      case 'Genres': set.genres = clear ? '' : v; break;
      case 'Thematics': set.thematics = clear ? '' : v; break;
      case 'Notes': set.notes = clear ? '' : v; break;
      case 'Season': set.season = clear ? null : v; break;
      case 'Starts': dateOf('starts'); break;
      case 'Expires': dateOf('expires'); break;
      case 'Valid from': dateOf('validFrom'); break;
      case 'To': dateOf('validTo'); break;
      case 'Number of parts': {
        const n = Number(v);
        if (clear) set.segmentCount = 1;
        else if (Number.isInteger(n) && n >= 1 && n <= 500) set.segmentCount = n;
        else problems.push('Number of parts: a whole number from 1.');
        break;
      }
      case 'Source': {
        if (clear) {
          if (level === 'production') problems.push('An item needs a source.');
          else set.sourceId = null;
          break;
        }
        const s = await db.source.findFirst({ where: { OR: [{ name: { equals: v, mode: 'insensitive' } }, { code: { equals: v, mode: 'insensitive' } }] } });
        if (s) set.sourceId = s.id;
        else problems.push(`Source "${v}" does not exist.`);
        break;
      }
      case 'Channels': {
        if (clear) {
          set.channelIds = [];
          break;
        }
        const wanted = v.split(',').map((x) => x.trim()).filter(Boolean);
        const rows = await db.channel.findMany({ where: { deletedAt: null } });
        const found = wanted.map((w) => rows.find((r) => r.name.trim().toLowerCase() === w.toLowerCase()));
        if (found.some((f) => !f)) problems.push(`Channels: ${wanted.filter((_, i) => !found[i]).join(', ')} not found.`);
        else set.channelIds = found.map((f) => f!.id);
        break;
      }
      case 'Companies': set.companies = clear ? [] : v.split(',').map((x) => x.trim()).filter(Boolean); break;
      case 'Media status': {
        if (clear) set.mediaStatus = null;
        else if (/^not/i.test(v)) set.mediaStatus = 'not-ready';
        else if (/^ready/i.test(v)) set.mediaStatus = 'ready';
        else problems.push('Media status: Ready or Not ready.');
        break;
      }
      case 'Age logo':
      case 'Logo 1': {
        const col = c.field === 'Age logo' ? 'ageLogoId' : 'logo1Id';
        if (clear) {
          set[col] = null;
          break;
        }
        const logo = await db.logo.findFirst({ where: { name: { equals: v, mode: 'insensitive' }, logoType: { number: c.field === 'Age logo' ? 1 : 3 } } });
        if (logo) set[col] = logo.id;
        else problems.push(`${c.field} "${v}" does not exist.`);
        break;
      }
    }
  }
  if (problems.length) throw new HttpError(400, problems[0], problems.map((message) => ({ code: 'input', message })));
  const ids = [...new Set(body.ids)];
  await db.$transaction(async (tx) => {
    if (level === 'content') {
      const n = await tx.content.updateMany({ where: { id: { in: ids }, deletedAt: null, tenantId: currentTenantId() }, data: { ...set, version: { increment: 1 } } });
      if (n.count !== ids.length) throw new HttpError(409, 'Some of the ticked titles no longer exist. Nothing was changed.');
      return;
    }
    const rows = await tx.production.findMany({ where: { id: { in: ids }, deletedAt: null, tenantId: currentTenantId() } });
    if (rows.length !== ids.length) throw new HttpError(409, 'Some of the ticked items no longer exist. Nothing was changed.');
    for (const r of rows) {
      const cv = { ...(r.customValues as Record<string, string>) };
      for (const [k, v] of Object.entries(customSet)) {
        if (v === null) delete cv[k];
        else cv[k] = v;
      }
      await tx.production.update({ where: { id: r.id }, data: { ...set, customValues: cv, version: { increment: 1 } } as never });
    }
  });
  return { updated: ids.length };
}

// ---------------------------------------------------------------- series and segmentations

export const seriesBody = z.object({
  title: z.string().trim().min(1, 'Title is required').max(400),
  first: z.number().int().min(0).max(1_000_000),
  count: z.number().int().min(1).max(SERIES_MAX),
  lengthFrames: z.number().int().min(0).nullable(),
  segments: z.number().int().min(1).max(50),
  sourceId: id,
});

/** Segments of a new or regenerated segmentation (equal parts; no TCs when the length is unknown). */
function segmentRows(segmentationId: string, sourceId: string, mediaId: string, lengthFrames: number | null, count: number): Prisma.SegmentCreateManyInput[] {
  if (lengthFrames === null || lengthFrames === 0) {
    return Array.from({ length: count }, (_, i) => ({ id: uuidv7(), segmentationId, code: i + 1, sourceId, mediaId, tcInFrames: null, tcOutFrames: null, lengthFrames: null }));
  }
  return splitSegments(lengthFrames, count).map((s, i) => ({ id: uuidv7(), segmentationId, code: i + 1, sourceId, mediaId, tcInFrames: s.tcIn, tcOutFrames: s.tcOut, lengthFrames: s.length }));
}

/** Creates N numbered productions in a content, each with one segmentation. Refused when an episode number exists. */
export async function createSeries(contentId: string, body: z.infer<typeof seriesBody>): Promise<{ created: number }> {
  const content = await db.content.findFirst({ where: { id: contentId, deletedAt: null }, include: { contentType: true } });
  if (!content) throw notFound('Title');
  const source = await db.source.findFirst({ where: { id: body.sourceId } });
  if (!source) throw new HttpError(400, 'The source does not exist.');
  const titles = seriesTitles(body.title, body.first, body.count);
  const chapters = titles.map((_, i) => body.first + i);
  const taken = await db.production.findMany({ where: { contentId, deletedAt: null, chapter: { in: chapters }, isTemplate: false }, select: { chapter: true } });
  if (taken.length) {
    const list = taken.map((t) => t.chapter).sort((a, b) => (a ?? 0) - (b ?? 0));
    throw new HttpError(409, `Episodes ${list.join(', ')} already exist in ${content.title}. Nothing was created.`);
  }
  const pattern = source.mediaIdGeneration === 'custom' ? source.customPattern : '';
  await db.$transaction(async (tx) => {
    let next = content.nextProductionId;
    const prods: Prisma.ProductionCreateManyInput[] = [];
    const segms: Prisma.SegmentationCreateManyInput[] = [];
    const segs: Prisma.SegmentCreateManyInput[] = [];
    titles.forEach((title, i) => {
      const code = productionIdFrom(pattern, { typeCode: content.contentType.code, contentCode: content.code, chapter: chapters[i], next });
      next++;
      const pid = uuidv7();
      prods.push({ id: pid, tenantId: currentTenantId(), contentId, title, code, chapter: chapters[i], lengthFrames: body.lengthFrames || null, sourceId: source.id, segmentCount: body.segments });
      const sid = uuidv7();
      segms.push({ id: sid, tenantId: currentTenantId(), productionId: pid, code: 1, name: `${code}-1` });
      segs.push(...segmentRows(sid, source.id, code, body.lengthFrames, body.segments));
    });
    await tx.production.createMany({ data: prods });
    await tx.segmentation.createMany({ data: segms });
    await tx.segment.createMany({ data: segs });
    await tx.content.update({ where: { id: contentId }, data: { nextProductionId: next } });
  });
  return { created: titles.length };
}

export const segmentationBody = z.object({
  name: z.string().trim().min(1, 'Name is required').max(400),
  sourceId: id,
  segments: z.number().int().min(1).max(50),
  lengthFrames: z.number().int().min(0).nullable(),
});

export async function createSegmentation(productionId: string, body: z.infer<typeof segmentationBody>): Promise<{ id: string }> {
  const prod = await db.production.findFirst({ where: { id: productionId, deletedAt: null } });
  if (!prod) throw notFound('Item');
  if (!(await db.source.findFirst({ where: { id: body.sourceId } }))) throw new HttpError(400, 'The source does not exist.');
  const last = await db.segmentation.findFirst({ where: { productionId, deletedAt: null }, orderBy: { code: 'desc' } });
  const sid = uuidv7();
  await db.$transaction(async (tx) => {
    await tx.segmentation.create({ data: { id: sid, tenantId: currentTenantId(), productionId, code: (last?.code ?? 0) + 1, name: body.name } });
    await tx.segment.createMany({ data: segmentRows(sid, body.sourceId, prod.code, body.lengthFrames, body.segments) });
  });
  return { id: sid };
}

/** Replaces the segments of a segmentation with N equal ones. */
export async function regenerateSegmentation(segmentationId: string, body: z.infer<typeof segmentationBody> & { version: number }): Promise<{ version: number }> {
  const segm = await db.segmentation.findFirst({ where: { id: segmentationId, deletedAt: null }, include: { production: true } });
  if (!segm) throw notFound('Cut');
  if (!(await db.source.findFirst({ where: { id: body.sourceId } }))) throw new HttpError(400, 'The source does not exist.');
  await db.$transaction(async (tx) => {
    const n = await tx.segmentation.updateMany({ where: { id: segmentationId, version: body.version }, data: { name: body.name, version: { increment: 1 } } });
    if (!n.count) throw new HttpError(409, 'Someone else changed this cut first. Reload it and try again.');
    await tx.segment.updateMany({ where: { segmentationId, deletedAt: null }, data: { deletedAt: new Date() } });
    await tx.segment.createMany({ data: segmentRows(segmentationId, body.sourceId, segm.production.code, body.lengthFrames, body.segments) });
  });
  return { version: body.version + 1 };
}

// ---------------------------------------------------------------- rotation lists

async function listOf(listId: string) {
  const l = await db.rotationList.findFirst({ where: { id: listId, deletedAt: null }, include: { items: { orderBy: [{ position: 'asc' }, { name: 'asc' }] } } });
  if (!l) throw notFound('Rotation list');
  return l;
}

/** A copy of a list with its items, named "<name> (Clone)", "(Clone1)", … */
export async function cloneList(listId: string): Promise<{ id: string; name: string }> {
  const l = await listOf(listId);
  const names = new Set((await db.rotationList.findMany({ where: { deletedAt: null }, select: { name: true } })).map((x) => x.name));
  let name = `${l.name} (Clone)`;
  for (let i = 1; names.has(name); i++) name = `${l.name} (Clone${i})`;
  const newId = uuidv7();
  const { id: _i, tenantId: _t, importRef: _r, createdAt: _c, updatedAt: _u, deletedAt: _d, items, version: _v, name: _n, ...settings } = l;
  await db.$transaction(async (tx) => {
    await tx.rotationList.create({ data: { id: newId, tenantId: currentTenantId(), name, ...settings } });
    if (items.length) {
      await tx.rotationListItem.createMany({
        data: items.map((it) => ({ id: uuidv7(), listId: newId, productionId: it.productionId, segmentationId: it.segmentationId, name: it.name, position: it.position, insertedAt: it.insertedAt })),
      });
    }
  });
  return { id: newId, name };
}

/** Adds productions at the end of a list; refused when one is in it already. */
export async function addListItems(listId: string, productionIds: string[]): Promise<{ added: number }> {
  const l = await listOf(listId);
  const unique = [...new Set(productionIds)];
  const prods = await db.production.findMany({ where: { id: { in: unique }, deletedAt: null }, include: { segmentations: { where: { deletedAt: null }, orderBy: { code: 'asc' }, take: 1 } } });
  if (prods.length !== unique.length) throw new HttpError(404, 'Some of the picked items no longer exist. Nothing was added.');
  const inList = prods.filter((p) => l.items.some((i) => i.productionId === p.id));
  if (inList.length) throw new HttpError(409, `${inList.map((p) => p.title).join(', ')} ${inList.length === 1 ? 'is' : 'are'} in the list already. Nothing was added.`);
  let pos = l.items.reduce((m, i) => Math.max(m, i.position), 0);
  const byId = new Map(prods.map((p) => [p.id, p]));
  await db.rotationListItem.createMany({
    data: unique.map((pid) => {
      const p = byId.get(pid)!;
      return { id: uuidv7(), listId, productionId: p.id, segmentationId: p.segmentations[0]?.id ?? null, name: p.title, position: ++pos };
    }),
  });
  await db.rotationList.update({ where: { id: listId }, data: { version: { increment: 1 } } });
  return { added: unique.length };
}

/** Puts the list's items in a random order (positions 1 … N). */
export async function shuffleList(listId: string, random: () => number = Math.random): Promise<{ items: number }> {
  const l = await listOf(listId);
  const order = l.items.map((i) => i.id);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  await db.$transaction(async (tx) => {
    for (const [i, itemId] of order.entries()) await tx.rotationListItem.update({ where: { id: itemId }, data: { position: i + 1 } });
    await tx.rotationList.update({ where: { id: listId }, data: { version: { increment: 1 } } });
  });
  return { items: order.length };
}

// ---------------------------------------------------------------- relations

const segmentsRule = z.enum(['all', 'first', 'last', 'first-last']);
const PARAMS = {
  linear: z.object({ jingle: z.enum(['pre', 'post']), segments: segmentsRule, productionId: id }),
  graphics: z.object({
    graphicTemplateId: id, segments: segmentsRule, startType: z.enum(['from-start', 'at-tc', 'manual', 'to-end']), startOffsetFrames: z.number().int().min(0),
    tcInFrames: z.number().int().min(0), endType: z.enum(['automatic', 'duration', 'until-end', 'manual']), durationFrames: z.number().int().min(0),
    tcOutFrames: z.number().int().min(0), frequency: z.enum(['once', 'n-times', 'until-end']), intervalFrames: z.number().int().min(0),
    repetitions: z.number().int().min(0).max(100000), layer: z.enum(['auto', '1', '2', '3', '4']),
  }),
  'time-window': z.object({ timeWindowId: id, rule: z.enum(['allowed', 'rejected']) }),
  'product-code': z.object({ productCodeId: id }),
} satisfies Record<RelationKind, z.ZodType>;

export const relationsBody = z.object({
  kinds: z.array(z.enum(['linear', 'graphics', 'time-window', 'product-code'])).min(1).max(4),
  rows: z.array(z.object({ kind: z.enum(['linear', 'graphics', 'time-window', 'product-code']), channelId: id.nullable().default(null), params: z.unknown() })).max(500),
});

export interface RelationRow {
  id: string | null;
  kind: RelationKind;
  channelId: string | null;
  params: Record<string, unknown>;
  inherited: boolean;
  /** Where an inherited row comes from: "Content · Harbor Nights". */
  from: string | null;
}

const LEVEL_LABEL: Record<string, string> = { 'content-type': 'Category', content: 'Title', production: 'Item', segmentation: 'Cut', segment: 'Part' };

/** The item's parents, nearest last: content type → content → production → segmentation. */
async function parentsOf(level: CatalogLevel, itemId: string): Promise<{ level: CatalogLevel; id: string; name: string; advert: boolean }[]> {
  const chain: { level: CatalogLevel; id: string; name: string; advert: boolean }[] = [];
  let productionId: string | null = null;
  let contentId: string | null = null;
  if (level === 'segment') {
    const s = await segmentOfTenant(itemId);
    chain.unshift({ level: 'segmentation', id: s.segmentationId, name: s.segmentation.name, advert: false });
    productionId = s.segmentation.productionId;
  }
  if (level === 'segmentation') {
    const s = await db.segmentation.findFirst({ where: { id: itemId, deletedAt: null } });
    if (!s) throw notFound('Cut');
    productionId = s.productionId;
  }
  if (productionId) {
    const p = await db.production.findFirstOrThrow({ where: { id: productionId } });
    chain.unshift({ level: 'production', id: p.id, name: p.title, advert: false });
    contentId = p.contentId;
  }
  if (level === 'production') {
    const p = await db.production.findFirst({ where: { id: itemId, deletedAt: null } });
    if (!p) throw notFound('Item');
    contentId = p.contentId;
  }
  if (level === 'content') contentId = itemId;
  let typeId: string | null = null;
  if (contentId) {
    const c = await db.content.findFirst({ where: { id: contentId, deletedAt: null }, include: { contentType: true } });
    if (!c) throw notFound('Title');
    if (level !== 'content') chain.unshift({ level: 'content', id: c.id, name: c.title, advert: c.contentType.family === 'advert' });
    typeId = c.contentTypeId;
  }
  if (level === 'content-type') typeId = null;
  if (typeId) {
    const t = await db.contentType.findFirstOrThrow({ where: { id: typeId } });
    chain.unshift({ level: 'content-type', id: t.id, name: t.name, advert: t.family === 'advert' });
  }
  return chain;
}

/** The Relations of an item: which tabs it has, its own rows and the ones it inherits, and the names they use. */
export async function getRelations(level: CatalogLevel, itemId: string) {
  if (level === 'content-type' && !(await db.contentType.findFirst({ where: { id: itemId, deletedAt: null } }))) throw notFound('Category');
  const parents = await parentsOf(level, itemId);
  const advert = parents.some((p) => p.advert) || (level === 'content-type' && (await db.contentType.findFirst({ where: { id: itemId } }))?.family === 'advert');
  const tabs = relationTabs(level, !!advert);
  const kinds = tabs.filter((t): t is RelationKind => t !== 'rights' && t !== 'history');
  const rows: RelationRow[] = [];
  for (const p of parents) {
    for (const r of await db.catalogRelation.findMany({ where: { itemId: p.id, kind: { in: kinds } }, orderBy: { position: 'asc' } })) {
      rows.push({ id: r.id, kind: r.kind as RelationKind, channelId: r.channelId, params: r.params as Record<string, unknown>, inherited: true, from: `${LEVEL_LABEL[p.level]} · ${p.name}` });
    }
  }
  for (const r of await db.catalogRelation.findMany({ where: { itemId, kind: { in: kinds } }, orderBy: { position: 'asc' } })) {
    rows.push({ id: r.id, kind: r.kind as RelationKind, channelId: r.channelId, params: r.params as Record<string, unknown>, inherited: false, from: null });
  }
  // names of what the rows point at
  const want = (k: string) => rows.map((r) => r.params[k]).filter((x): x is string => typeof x === 'string');
  const names: Record<string, string> = {};
  for (const p of await db.production.findMany({ where: { id: { in: want('productionId') } } })) names[p.id] = p.title;
  for (const g of await db.graphicTemplate.findMany({ where: { id: { in: want('graphicTemplateId') } } })) names[g.id] = g.name;
  for (const w of await db.timeWindow.findMany({ where: { id: { in: want('timeWindowId') } } })) names[w.id] = w.name;
  for (const c of await db.productCode.findMany({ where: { id: { in: want('productCodeId') } } })) names[c.id] = c.name;
  return { tabs, rows, names };
}

/** Replaces the item's own rows of the given kinds, all-or-nothing. */
export async function saveRelations(level: CatalogLevel, itemId: string, body: z.infer<typeof relationsBody>): Promise<{ saved: number }> {
  const { tabs } = await getRelations(level, itemId);
  const problems: string[] = [];
  for (const k of body.kinds) if (!tabs.includes(k)) problems.push(`This item has no ${k} relations.`);
  const rows = body.rows.map((r) => {
    if (!body.kinds.includes(r.kind)) problems.push(`A ${r.kind} row was sent without its kind.`);
    const parsed = PARAMS[r.kind].safeParse(r.params);
    if (!parsed.success) problems.push(`A ${r.kind} row is not complete.`);
    return { ...r, params: (parsed.success ? parsed.data : {}) as Record<string, string> };
  });
  const exists = async (what: string, ids: string[], count: (ids: string[]) => Promise<number>) => {
    const u = [...new Set(ids)];
    if (u.length && (await count(u)) !== u.length) problems.push(`A ${what} no longer exists.`);
  };
  await exists('jingle', rows.map((r) => r.params.productionId).filter(Boolean), (x) => db.production.count({ where: { id: { in: x }, deletedAt: null } }));
  await exists('graphic', rows.map((r) => r.params.graphicTemplateId).filter(Boolean), (x) => db.graphicTemplate.count({ where: { id: { in: x }, deletedAt: null } }));
  await exists('time window', rows.map((r) => r.params.timeWindowId).filter(Boolean), (x) => db.timeWindow.count({ where: { id: { in: x } } }));
  await exists('product code', rows.map((r) => r.params.productCodeId).filter(Boolean), (x) => db.productCode.count({ where: { id: { in: x } } }));
  await exists('channel', rows.map((r) => r.channelId).filter((x): x is string => !!x), (x) => db.channel.count({ where: { id: { in: x }, deletedAt: null } }));
  if (problems.length) throw new HttpError(400, problems[0], [...new Set(problems)].map((message) => ({ code: 'input', message })));
  await db.$transaction(async (tx: Tx) => {
    await tx.catalogRelation.deleteMany({ where: { itemId, kind: { in: body.kinds } } });
    if (rows.length) {
      await tx.catalogRelation.createMany({
        data: rows.map((r, position) => ({ id: uuidv7(), tenantId: currentTenantId(), kind: r.kind, level, itemId, channelId: r.channelId, position, params: r.params as Prisma.InputJsonValue })),
      });
    }
  });
  return { saved: rows.length };
}

// ---------------------------------------------------------------- what the forms pick from

export async function catalogLookups() {
  const { rateCode, today } = await catalogContext();
  const tenant = await platformDb.tenant.findUniqueOrThrow({ where: { id: currentTenantId() } });
  const [sources, logos, actions, channels, customFields, windows, codes, gSources, gTemplates, gObjects, companyRows] = await Promise.all([
    db.source.findMany({ orderBy: { name: 'asc' } }),
    db.logo.findMany({ include: { logoType: true }, orderBy: { name: 'asc' } }),
    db.secondaryAction.findMany({ orderBy: { name: 'asc' } }),
    db.channel.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' }, select: { id: true, name: true, weekStart: true } }),
    db.customField.findMany({ where: { entity: 'production' }, orderBy: [{ position: 'asc' }, { key: 'asc' }] }),
    db.timeWindow.findMany({ orderBy: { name: 'asc' } }),
    db.productCode.findMany({ orderBy: { name: 'asc' } }),
    db.graphicSource.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } }),
    db.graphicTemplate.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } }),
    db.graphicObject.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } }),
    db.$queryRaw<{ name: string }[]>`SELECT DISTINCT unnest(companies) AS name FROM content WHERE tenant_id = ${currentTenantId()}::uuid`,
  ]);
  // the week of the date fields: the one most of the company's channels use
  const weeks = new Map<number, number>();
  for (const c of channels) weeks.set(c.weekStart, (weeks.get(c.weekStart) ?? 0) + 1);
  const weekStart = [...weeks.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 1;
  return {
    frameRate: rateCode, today, weekStart, companyName: tenant.name, bulkMax: BULK_EDIT_MAX,
    sources: sources.map((s) => ({ id: s.id, name: s.name, code: s.code, pattern: s.mediaIdGeneration === 'custom' ? s.customPattern : '' })),
    logos: logos.map((l) => ({ id: l.id, name: l.name, typeNumber: l.logoType.number })),
    secondaryActions: actions.map((a) => ({ id: a.id, name: a.name })),
    channels: channels.map((c) => ({ id: c.id, name: c.name.trim() })),
    customFields: customFields.map((c) => ({ key: c.key, label: c.label })),
    timeWindows: windows.map((w) => ({ id: w.id, name: w.name, color: w.color, lengthFrames: w.lengthFrames })),
    productCodes: codes.map((c) => ({ id: c.id, name: c.name })),
    graphicSources: gSources.map((g) => ({ id: g.id, name: g.name })),
    graphicTemplates: gTemplates.map((g) => ({
      id: g.id, name: g.name, sourceId: g.sourceId, startType: g.startType, startOffsetFrames: g.startOffsetFrames, startTcInFrames: g.startTcInFrames,
      endType: g.endType, endDurationFrames: g.endDurationFrames, endTcOutFrames: g.endTcOutFrames, frequency: g.frequency,
      repeatIntervalFrames: g.repeatIntervalFrames, repeatCount: g.repeatCount, layer: g.layer,
    })),
    graphicObjects: gObjects.map((g) => ({ id: g.id, name: g.name, sourceId: g.sourceId })),
    companies: [...new Set([tenant.name, ...companyRows.map((r) => r.name)])].sort(),
  };
}

/** The next free episode number of a content (series dialog), and the content's productions' highest chapter. */
export async function nextEpisode(contentId: string): Promise<{ next: number }> {
  const c = await db.content.findFirst({ where: { id: contentId, deletedAt: null } });
  if (!c) throw notFound('Title');
  const top = await db.production.aggregate({ where: { contentId, deletedAt: null, isTemplate: false }, _max: { chapter: true } });
  return { next: (top._max.chapter ?? 0) + 1 };
}

