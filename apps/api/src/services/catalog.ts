// The catalog as the shared catalog picker reads it (data model §4a): content types of the allowed
// families → contents of a type → productions of a content, and a search over titles and house IDs.

import { db, toIsoDate } from '../db';
import { notFound } from '../errors';

export type Family = 'program' | 'filling' | 'advert';
export const FAMILIES: Family[] = ['program', 'filling', 'advert'];

export interface ContentTypeDto {
  id: string;
  name: string;
  family: Family;
  color: string | null;
  contentCount: number;
}

export interface ContentDto {
  id: string;
  title: string;
  code: string;
  contentTypeId: string;
  /** Productions without the template production. */
  productionCount: number;
}

export interface ProductionDto {
  id: string;
  contentId: string;
  title: string;
  code: string;
  chapter: number | null;
  isTemplate: boolean;
  lengthFrames: number | null;
  starts: string | null;
  expires: string | null;
  mediaStatus: 'ready' | 'not-ready' | null;
}

export interface SearchHitDto extends ProductionDto {
  contentTitle: string;
  contentTypeId: string;
  typeName: string;
}

const prodDto = (p: {
  id: string; contentId: string; title: string; code: string; chapter: number | null; isTemplate: boolean; lengthFrames: number | null;
  starts: Date | null; expires: Date | null; mediaStatus: string | null;
}): ProductionDto => ({
  id: p.id, contentId: p.contentId, title: p.title, code: p.code, chapter: p.chapter, isTemplate: p.isTemplate, lengthFrames: p.lengthFrames,
  starts: p.starts ? toIsoDate(p.starts) : null, expires: p.expires ? toIsoDate(p.expires) : null,
  mediaStatus: p.mediaStatus === 'ready' || p.mediaStatus === 'not-ready' ? p.mediaStatus : null,
});

export async function listContentTypes(families: Family[]): Promise<ContentTypeDto[]> {
  const rows = await db.contentType.findMany({
    where: { deletedAt: null, family: { in: families } },
    include: { _count: { select: { contents: { where: { deletedAt: null } } } } },
    orderBy: { name: 'asc' },
  });
  return rows.map((t) => ({ id: t.id, name: t.name, family: t.family as Family, color: t.color, contentCount: t._count.contents }));
}

export async function listContents(contentTypeId: string): Promise<ContentDto[]> {
  const type = await db.contentType.findFirst({ where: { id: contentTypeId, deletedAt: null } });
  if (!type) throw notFound('Category');
  const rows = await db.content.findMany({
    where: { contentTypeId, deletedAt: null },
    include: { _count: { select: { productions: { where: { deletedAt: null, isTemplate: false } } } } },
    orderBy: { title: 'asc' },
  });
  return rows.map((c) => ({ id: c.id, title: c.title, code: c.code, contentTypeId: c.contentTypeId, productionCount: c._count.productions }));
}

/** Episode order: by chapter (none last), then title. */
const byEpisode = <T extends { chapter: number | null; title: string }>(a: T, b: T) =>
  (a.chapter ?? Number.MAX_SAFE_INTEGER) - (b.chapter ?? Number.MAX_SAFE_INTEGER) || a.title.localeCompare(b.title);

export async function listProductions(contentId: string): Promise<{ content: ContentDto & { typeName: string }; productions: ProductionDto[] }> {
  const c = await db.content.findFirst({
    where: { id: contentId, deletedAt: null },
    include: { contentType: true, productions: { where: { deletedAt: null } } },
  });
  if (!c) throw notFound('Title');
  const productions = c.productions.sort(byEpisode).map(prodDto);
  return {
    content: { id: c.id, title: c.title, code: c.code, contentTypeId: c.contentTypeId, productionCount: productions.filter((p) => !p.isTemplate).length, typeName: c.contentType.name },
    productions,
  };
}

/** Contents whose title matches, then productions whose title or house ID matches (templates left out). */
export async function searchCatalog(q: string, families: Family[]): Promise<{ contents: (ContentDto & { typeName: string })[]; productions: SearchHitDto[] }> {
  const text = q.trim();
  if (!text) return { contents: [], productions: [] };
  const like = { contains: text, mode: 'insensitive' as const };
  const contents = await db.content.findMany({
    where: { deletedAt: null, title: like, contentType: { family: { in: families }, deletedAt: null } },
    include: { contentType: true, _count: { select: { productions: { where: { deletedAt: null, isTemplate: false } } } } },
    orderBy: { title: 'asc' },
    take: 30,
  });
  const prods = await db.production.findMany({
    where: { deletedAt: null, isTemplate: false, OR: [{ title: like }, { code: like }], content: { deletedAt: null, contentType: { family: { in: families }, deletedAt: null } } },
    include: { content: { include: { contentType: true } } },
    orderBy: [{ title: 'asc' }],
    take: 300,
  });
  return {
    contents: contents.map((c) => ({ id: c.id, title: c.title, code: c.code, contentTypeId: c.contentTypeId, productionCount: c._count.productions, typeName: c.contentType.name })),
    productions: prods.sort((a, b) => a.content.title.localeCompare(b.content.title) || byEpisode(a, b)).map((p) => ({
      ...prodDto(p), contentTitle: p.content.title, contentTypeId: p.content.contentTypeId, typeName: p.content.contentType.name,
    })),
  };
}
