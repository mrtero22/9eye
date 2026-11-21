// Catalog rules shared by the API and the Catalog page (data model §4b).

export const BULK_EDIT_MAX = 50;
export const SERIES_MAX = 200;
export const SEGMENTS_MAX = 50;
/** Rows a column shows at once; the footer says how many there are. */
export const COLUMN_ROWS = 160;

export type CatalogLevel =
  | 'content-type'
  | 'content'
  | 'production'
  | 'segmentation'
  | 'segment'
  | 'rotation-list'
  | 'list-item'
  | 'graphic-source'
  | 'graphic-template'
  | 'graphic-object';

export const CATALOG_LEVELS: CatalogLevel[] = [
  'content-type', 'content', 'production', 'segmentation', 'segment', 'rotation-list', 'list-item', 'graphic-source', 'graphic-template', 'graphic-object',
];

/** The level a level's rows hang under (null = top level). */
export const PARENT_LEVEL: Record<CatalogLevel, CatalogLevel | null> = {
  'content-type': null,
  content: 'content-type',
  production: 'content',
  segmentation: 'production',
  segment: 'segmentation',
  'rotation-list': null,
  'list-item': 'rotation-list',
  'graphic-source': null,
  'graphic-template': 'graphic-source',
  'graphic-object': 'graphic-source',
};

/** Titles of a new series: the episode number is added to the title. */
export function seriesTitles(title: string, first: number, count: number): string[] {
  return Array.from({ length: Math.max(0, Math.min(count, SERIES_MAX)) }, (_, i) => `${title.trim()} - ${first + i}`);
}

/** N equal segments over a length (frames): TC in, TC out and length of each, back to back. */
export function splitSegments(totalFrames: number, count: number): { tcIn: number; tcOut: number; length: number }[] {
  const n = Math.max(1, Math.min(Math.trunc(count) || 1, SEGMENTS_MAX));
  const total = Math.max(0, Math.trunc(totalFrames));
  return Array.from({ length: n }, (_, i) => {
    const tcIn = Math.floor((total * i) / n);
    const tcOut = Math.floor((total * (i + 1)) / n);
    return { tcIn, tcOut, length: tcOut - tcIn };
  });
}

export const DEFAULT_ID_PATTERN = '%T-%C-%A';

/**
 * A new production's Id from its source's pattern. Tokens: %T the content type's Id, %C the
 * content's Id, %P the episode number (chapter), %A the content's next production number (six
 * digits). Everything else is kept as typed.
 */
export function productionIdFrom(pattern: string, ctx: { typeCode: string; contentCode: string; chapter: number | null; next: number }): string {
  return (pattern || DEFAULT_ID_PATTERN).replace(/%([TCPA])/g, (_, t: string) =>
    t === 'T' ? ctx.typeCode : t === 'C' ? ctx.contentCode : t === 'P' ? String(ctx.chapter ?? '') : String(ctx.next).padStart(6, '0'),
  );
}

/** Characters an Id should not have (the form warns, it does not refuse). */
export const hasSpecialCharacters = (id: string) => /[^A-Za-z0-9 _\-.[\]()]/.test(id);

// ---------------------------------------------------------------- advanced search

export type SearchOp = 'contains' | 'is' | 'empty' | 'between';
export const SEARCH_OPS: { value: SearchOp; label: string }[] = [
  { value: 'contains', label: 'Contains' },
  { value: 'is', label: 'Is' },
  { value: 'empty', label: 'Is empty' },
  { value: 'between', label: 'Between' },
];

export interface SearchCondition {
  field: string;
  op: SearchOp;
  value: string;
}

/** "a .. b", "a – b", "a to b" → [a, b]; one value → [a, a]. */
export function betweenValues(text: string): [string, string] {
  const parts = text.split(/\s*(?:\.\.|–|—|\bto\b)\s*/i).map((x) => x.trim()).filter(Boolean);
  if (parts.length >= 2) return [parts[0], parts[1]];
  return [parts[0] ?? '', parts[0] ?? ''];
}

// ---------------------------------------------------------------- relations

export type RelationKind = 'linear' | 'graphics' | 'time-window' | 'product-code';
export type RelationTab = RelationKind | 'rights' | 'history';
export type SegmentRule = 'all' | 'first' | 'last' | 'first-last';

export const SEGMENT_RULES: { value: SegmentRule; label: string }[] = [
  { value: 'all', label: 'All parts' },
  { value: 'first', label: 'First part' },
  { value: 'last', label: 'Last part' },
  { value: 'first-last', label: 'First and last' },
];

/** The Relations tabs of an item. Product codes only for advertising. */
export function relationTabs(level: CatalogLevel, advert: boolean): RelationTab[] {
  const tabs: RelationTab[] = [];
  if (level === 'content' || level === 'production') tabs.push('linear', 'graphics');
  if (['content-type', 'content', 'production', 'segmentation', 'segment'].includes(level)) tabs.push('time-window');
  if ((level === 'content' || level === 'production') && advert) tabs.push('product-code');
  if (level === 'production') tabs.push('rights', 'history');
  return tabs;
}

export const GRAPHIC_START_TYPES = [
  { value: 'from-start', label: 'Time from start' },
  { value: 'at-tc', label: 'At TC' },
  { value: 'manual', label: 'Manual order' },
  { value: 'to-end', label: 'Time to end' },
] as const;
export const GRAPHIC_END_TYPES = [
  { value: 'automatic', label: 'Automatic' },
  { value: 'duration', label: 'Duration' },
  { value: 'until-end', label: 'Until end' },
  { value: 'manual', label: 'Manual' },
] as const;
export const GRAPHIC_FREQUENCIES = [
  { value: 'once', label: 'Once' },
  { value: 'n-times', label: 'N times' },
  { value: 'until-end', label: 'Until end' },
] as const;
export const GRAPHIC_LAYERS = ['auto', '1', '2', '3', '4'] as const;

/** Fields of the advanced search per level (custom fields of productions are added per company). */
export const SEARCH_FIELDS: Record<CatalogLevel, string[]> = {
  'content-type': ['Name', 'Id', 'Type', 'Show in grid'],
  content: ['Title', 'Original title', 'Id', 'Season', 'Genres', 'Valid from', 'To', 'Source'],
  production: ['Title', 'Original title', 'Id', 'Chapter', 'Duration', 'Starts', 'Expires', 'Genres', 'Media status', 'Additional data'],
  segmentation: ['Name', 'Id'],
  segment: ['Id', 'TC in', 'TC out', 'Duration', 'Media id'],
  'rotation-list': ['Name'],
  'list-item': ['Name', 'Order'],
  'graphic-source': ['Name', 'Id', 'Channel'],
  'graphic-template': ['Name', 'Start type'],
  'graphic-object': ['Name', 'Code'],
};

/** Fields a column can be ordered by; the first is the default. */
export const SORT_FIELDS: Record<CatalogLevel, string[]> = {
  'content-type': ['Name', 'Id', 'Type', 'Created date'],
  content: ['Title', 'Id', 'Season', 'Created date'],
  production: ['Chapter', 'Title', 'Id', 'Duration', 'Created date'],
  segmentation: ['Id', 'Name'],
  segment: ['Id', 'TC in', 'Duration'],
  'rotation-list': ['Name', 'Created date'],
  'list-item': ['Order', 'Name'],
  'graphic-source': ['Name', 'Id'],
  'graphic-template': ['Name'],
  'graphic-object': ['Name', 'Code'],
};

/** Fields bulk edit can set or clear (the production's custom fields are added per company). */
export const BULK_FIELDS: { content: string[]; production: string[] } = {
  content: ['Genres', 'Season', 'Source', 'Valid from', 'To', 'Channels', 'Companies', 'Age logo', 'Logo 1', 'Notes'],
  production: ['Genres', 'Thematics', 'Starts', 'Expires', 'Source', 'Number of parts', 'Channels', 'Media status', 'Notes'],
};
