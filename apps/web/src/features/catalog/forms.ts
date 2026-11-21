// The fields of each catalog form, in groups (catalog-page.md "Form panel"; data model §4b).

import { GRAPHIC_END_TYPES, GRAPHIC_FREQUENCIES, GRAPHIC_LAYERS, GRAPHIC_START_TYPES, hasSpecialCharacters, type CatalogLevel } from '@9eye/core';
import type { CatalogLookups } from '@/lib/types';
import { countryNames } from './countries';

type Opt = { value: string; label: string };

export type FieldDef =
  | { k: 'text'; key: string; label: string; req?: boolean; mono?: boolean; hint?: string; hintTone?: 'amber' }
  | { k: 'area'; key: string; label: string; mono?: boolean; rows?: number }
  | { k: 'int'; key: string; label: string; req?: boolean; nullable?: boolean }
  | { k: 'tc'; key: string; label: string; req?: boolean; nullable?: boolean; hint?: string; hintTone?: 'amber' }
  | { k: 'select'; key: string; label: string; req?: boolean; options: Opt[]; nullable?: boolean }
  | { k: 'switch'; key: string; label: string }
  | { k: 'chips'; key: string; label: string; options: Opt[]; hint?: string }
  | { k: 'color'; key: string; label: string; req?: boolean }
  | { k: 'date'; key: string; label: string }
  | { k: 'read'; label: string; value: string | null; req?: boolean; mono?: boolean; hint?: string; actions?: string[] }
  | { k: 'custom'; key: string; label: string };

export interface GroupDef {
  label: string;
  open: boolean;
  fields: FieldDef[];
}

const yesNo = (v: unknown) => (v ? 'Yes' : 'No');
const NO_MAM = ['View proxy', 'Go to the asset', 'Resync'];

function media(v: Record<string, unknown>, withStatus: boolean): GroupDef {
  return {
    label: 'Media',
    open: false,
    fields: [
      ...(withStatus ? [{ k: 'select', key: 'mediaStatus', label: 'Media status', nullable: true, options: [{ value: 'ready', label: 'Ready' }, { value: 'not-ready', label: 'Not ready' }] } as FieldDef] : []),
      { k: 'read', label: 'Media available', value: yesNo(v.mediaAvailable) },
      { k: 'read', label: 'Proxy available', value: yesNo(v.proxyAvailable), actions: NO_MAM, hint: 'Play, proxy and resync need a connected MAM.' },
      { k: 'switch', key: 'publishedExternally', label: 'Published externally' },
      { k: 'text', key: 'externalId', label: 'External id', mono: true },
      { k: 'text', key: 'thumbnail', label: 'Thumbnail' },
      ...(withStatus ? [{ k: 'area', key: 'additionalData', label: 'Additional data', mono: true, rows: 3 } as FieldDef] : []),
    ],
  };
}

const SWITCHES = (pairs: [string, string][]): FieldDef[] => pairs.map(([key, label]) => ({ k: 'switch', key, label }));

/** The groups of a level's form for the values shown (an item, or a new one). */
export function formGroups(level: CatalogLevel, v: Record<string, unknown>, lk: CatalogLookups, creating: boolean, parentName: string | null): GroupDef[] {
  const sources: Opt[] = lk.sources.map((s) => ({ value: s.id, label: s.name }));
  const channels: Opt[] = lk.channels.map((c) => ({ value: c.id, label: c.name }));
  const countries: Opt[] = countryNames().map((c) => ({ value: c, label: c }));
  const actions: Opt[] = lk.secondaryActions.map((a) => ({ value: a.id, label: a.name }));
  const logos = (n: number): Opt[] => lk.logos.filter((l) => l.typeNumber === n).map((l) => ({ value: l.id, label: l.name }));
  const str = (k: string) => (v[k] == null ? '' : String(v[k]));
  switch (level) {
    case 'content-type':
      return [
        {
          label: 'Category',
          open: true,
          fields: [
            { k: 'text', key: 'name', label: 'Name', req: true },
            { k: 'text', key: 'code', label: 'Id', req: true, mono: true },
            { k: 'color', key: 'color', label: 'Color', req: true },
            { k: 'select', key: 'family', label: 'Type', req: true, options: [{ value: 'program', label: 'Program' }, { value: 'filling', label: 'Filling' }, { value: 'advert', label: 'Advertisement' }] },
          ],
        },
        {
          label: 'Grid',
          open: true,
          fields: SWITCHES([['showInGrid', 'Show in grid'], ['showTitleInGrid', 'Show title in grid'], ['showSegmentInGrid', 'Show part in grid'], ['showChapterInGrid', 'Show chapter in grid'], ['hasLogo', 'Has logo'], ['contractFree', 'Deal free']]),
        },
        {
          label: 'EPG and press',
          open: false,
          fields: SWITCHES([
            ['showInEpg', 'Show in EPG'], ['epgNameFromBlock', 'EPG name from the block'], ['epgNameFromContent', 'EPG name from the title'],
            ['epgShortFromContent', 'EPG short description from the title'], ['epgShortFromProduction', 'EPG short description from the item'],
            ['epgDescFromContent', 'EPG description from the title'], ['epgDescFromProduction', 'EPG description from the item'], ['showInPress', 'Show in press'],
          ]),
        },
      ];
    case 'content':
      return [
        {
          label: 'Title',
          open: true,
          fields: [
            { k: 'text', key: 'title', label: 'Title', req: true },
            { k: 'text', key: 'originalTitle', label: 'Original title' },
            { k: 'read', label: 'Category', value: creating ? parentName : str('contentTypeName'), req: true },
            { k: 'text', key: 'code', label: 'Id', req: true, mono: true, ...(hasSpecialCharacters(str('code')) ? { hint: 'The Id has special characters.', hintTone: 'amber' as const } : {}) },
            { k: 'int', key: 'nextProductionId', label: 'Next item id', req: true },
            { k: 'text', key: 'season', label: 'Season' },
            { k: 'tc', key: 'lengthFrames', label: 'Duration' },
            { k: 'int', key: 'segmentCount', label: 'Number of parts' },
            { k: 'select', key: 'sourceId', label: 'Source', options: sources, nullable: true },
          ],
        },
        { label: 'Dates', open: true, fields: [{ k: 'date', key: 'validFrom', label: 'Valid from' }, { k: 'date', key: 'validTo', label: 'To' }] },
        {
          label: 'Description',
          open: false,
          fields: [
            { k: 'text', key: 'genres', label: 'Genres' }, { k: 'text', key: 'directors', label: 'Directors' }, { k: 'text', key: 'nationalities', label: 'Nationalities' },
            { k: 'text', key: 'languages', label: 'Languages' }, { k: 'chips', key: 'countries', label: 'Countries', options: countries },
            { k: 'area', key: 'synopsis', label: 'Synopsis' }, { k: 'area', key: 'epgDescription', label: 'EPG description' }, { k: 'area', key: 'notes', label: 'Notes' },
          ],
        },
        {
          label: 'Logos',
          open: false,
          fields: [
            { k: 'select', key: 'ageLogoId', label: 'Age logo', options: logos(1), nullable: true },
            { k: 'select', key: 'channelLogoId', label: 'Channel logo', options: logos(2), nullable: true },
            ...[1, 2, 3, 4].map((i): FieldDef => ({ k: 'select', key: `logo${i}Id`, label: `Logo ${i}`, options: logos(2 + i), nullable: true })),
          ],
        },
        {
          label: 'Channels and companies',
          open: false,
          fields: [
            { k: 'chips', key: 'channelIds', label: 'Channels', options: channels, hint: 'Empty = every channel' },
            { k: 'chips', key: 'companies', label: 'Companies', options: lk.companies.map((c) => ({ value: c, label: c })) },
            { k: 'chips', key: 'secondaryActionIds', label: 'Secondary actions', options: actions },
          ],
        },
      ];
    case 'production': {
      const source = lk.sources.find((s) => s.id === v.sourceId);
      const idHint = hasSpecialCharacters(str('code'))
        ? { hint: 'The Id has special characters.', hintTone: 'amber' as const }
        : creating && !str('code')
          ? { hint: `Left empty, the Id is made from the source${source?.pattern ? `'s pattern ${source.pattern}` : ''}.` }
          : source?.pattern
            ? { hint: `Id pattern of the source ${source.name}: ${source.pattern}` }
            : {};
      return [
        {
          label: 'Item',
          open: true,
          fields: [
            { k: 'text', key: 'title', label: 'Title', req: true },
            { k: 'text', key: 'originalTitle', label: 'Original title' },
            { k: 'read', label: 'Title', value: creating ? parentName : str('contentTitle'), req: true },
            { k: 'text', key: 'code', label: 'Id', mono: true, ...idHint },
            { k: 'int', key: 'chapter', label: 'Chapter', req: true },
            { k: 'switch', key: 'isDefaultChapter', label: 'Is default chapter' },
            { k: 'tc', key: 'lengthFrames', label: 'Duration', ...(v.lengthFrames == null && !v.isTemplate && !creating ? { hint: 'No length in Media', hintTone: 'amber' as const } : {}) },
            { k: 'select', key: 'sourceId', label: 'Source', req: true, options: sources },
            { k: 'int', key: 'segmentCount', label: 'Number of parts', req: true },
          ],
        },
        { label: 'Dates', open: true, fields: [{ k: 'date', key: 'starts', label: 'Starts' }, { k: 'date', key: 'expires', label: 'Expires' }] },
        ...(lk.customFields.length ? [{ label: 'Custom fields', open: true, fields: lk.customFields.map((c): FieldDef => ({ k: 'custom', key: c.key, label: c.label })) }] : []),
        {
          label: 'Description',
          open: false,
          fields: [
            { k: 'text', key: 'genres', label: 'Genres' }, { k: 'text', key: 'thematics', label: 'Thematics' }, { k: 'text', key: 'directors', label: 'Directors' },
            { k: 'text', key: 'actors', label: 'Actors' }, { k: 'text', key: 'nationalities', label: 'Nationalities' }, { k: 'text', key: 'languages', label: 'Languages' },
            { k: 'chips', key: 'countries', label: 'Countries', options: countries }, { k: 'area', key: 'synopsis', label: 'Synopsis' },
            { k: 'area', key: 'epgDescription', label: 'EPG description' }, { k: 'area', key: 'notes', label: 'Notes' },
          ],
        },
        {
          label: 'Channels and actions',
          open: false,
          fields: [
            { k: 'chips', key: 'channelIds', label: 'Channels', options: channels, hint: 'Empty = every channel' },
            { k: 'chips', key: 'secondaryActionIds', label: 'Secondary actions', options: actions },
          ],
        },
        media(v, true),
      ];
    }
    case 'segmentation':
      return [
        {
          label: 'Cut',
          open: true,
          fields: [
            { k: 'int', key: 'code', label: 'Id', req: true },
            { k: 'text', key: 'name', label: 'Name', req: true },
            { k: 'read', label: 'Item', value: creating ? parentName : str('productionTitle'), req: true },
          ],
        },
        media(v, false),
      ];
    case 'segment':
      return [
        {
          label: 'Part',
          open: true,
          fields: [
            { k: 'int', key: 'code', label: 'Id', req: true },
            { k: 'read', label: 'Cut', value: creating ? parentName : str('segmentationName'), req: true },
            { k: 'select', key: 'sourceId', label: 'Source', req: true, options: sources },
            { k: 'text', key: 'mediaId', label: 'Media id', mono: true },
            { k: 'tc', key: 'tcInFrames', label: 'TC in' },
            { k: 'tc', key: 'tcOutFrames', label: 'TC out' },
            { k: 'tc', key: 'lengthFrames', label: 'Duration' },
            { k: 'area', key: 'notes', label: 'Notes' },
          ],
        },
        media(v, false),
      ];
    case 'rotation-list':
      return [
        {
          label: 'Rotation list',
          open: true,
          fields: [
            { k: 'text', key: 'name', label: 'Name', req: true },
            { k: 'read', label: 'Last item inserted', value: creating ? null : v.lastItemPosition == null ? null : `${v.lastItemName ? `${String(v.lastItemName)} ` : ''}(#${String(v.lastItemPosition)})` },
            { k: 'int', key: 'insertionDaysInterval', label: 'Insertion days interval' },
          ],
        },
        {
          label: 'Rules',
          open: true,
          fields: SWITCHES([['allowSameDayRepeat', 'Allow repetition on the same day'], ['randomInsert', 'Random insert'], ['applyChannelRestrictions', 'Apply channel restrictions'], ['allowProductionRepeats', 'Allow item repeats'], ['allowOverlap', 'Allow overlap']]),
        },
      ];
    case 'list-item':
      return [
        {
          label: 'List item',
          open: true,
          fields: [
            { k: 'read', label: 'Name', value: str('name') },
            { k: 'read', label: 'Item', value: str('productionTitle') },
            { k: 'read', label: 'Cut', value: v.segmentationName ? str('segmentationName') : null },
            { k: 'int', key: 'position', label: 'Order', req: true },
            { k: 'read', label: 'Inserted at', value: v.insertedAt ? str('insertedAt').slice(0, 16).replace('T', ' ') : null, mono: true },
          ],
        },
      ];
    case 'graphic-source':
      return [{ label: 'Graphic source', open: true, fields: [{ k: 'text', key: 'name', label: 'Name', req: true }, { k: 'text', key: 'code', label: 'Id', req: true, mono: true }, { k: 'select', key: 'channelId', label: 'Channel', req: true, options: channels }] }];
    case 'graphic-template': {
      const objects = lk.graphicObjects.filter((o) => o.sourceId === v.sourceId).map((o) => ({ value: o.id, label: o.name }));
      return [
        {
          label: 'Graphic template',
          open: true,
          fields: [
            { k: 'text', key: 'name', label: 'Name', req: true },
            { k: 'select', key: 'sourceId', label: 'Source', req: true, options: lk.graphicSources.map((g) => ({ value: g.id, label: g.name })) },
            { k: 'select', key: 'objectId', label: 'Graphic object', options: objects, nullable: true },
            { k: 'area', key: 'description', label: 'Description' },
          ],
        },
        { label: 'Start', open: true, fields: [{ k: 'select', key: 'startType', label: 'Start type', req: true, options: [...GRAPHIC_START_TYPES] }, { k: 'tc', key: 'startOffsetFrames', label: 'Start offset', req: true, nullable: false }, { k: 'tc', key: 'startTcInFrames', label: 'Start TC in', req: true, nullable: false }] },
        { label: 'End', open: true, fields: [{ k: 'select', key: 'endType', label: 'End type', req: true, options: [...GRAPHIC_END_TYPES] }, { k: 'tc', key: 'endDurationFrames', label: 'End duration', req: true, nullable: false }, { k: 'tc', key: 'endTcOutFrames', label: 'End TC out', req: true, nullable: false }] },
        {
          label: 'Frequency and layer',
          open: false,
          fields: [
            { k: 'select', key: 'frequency', label: 'Frequency type', req: true, options: [...GRAPHIC_FREQUENCIES] },
            { k: 'tc', key: 'repeatIntervalFrames', label: 'Repetition interval', req: true, nullable: false },
            { k: 'int', key: 'repeatCount', label: 'Repetition number', req: true },
            { k: 'select', key: 'layer', label: 'Graphic layer', options: GRAPHIC_LAYERS.map((l) => ({ value: l, label: l === 'auto' ? 'Auto' : l })) },
          ],
        },
      ];
    }
    case 'graphic-object':
      return [
        {
          label: 'Graphic object',
          open: true,
          fields: [
            { k: 'text', key: 'name', label: 'Name', req: true },
            { k: 'text', key: 'code', label: 'Code', req: true, mono: true },
            { k: 'select', key: 'sourceId', label: 'Source', req: true, options: lk.graphicSources.map((g) => ({ value: g.id, label: g.name })) },
            { k: 'select', key: 'layer', label: 'Graphic layer', req: true, options: GRAPHIC_LAYERS.map((l) => ({ value: l, label: l === 'auto' ? 'Auto' : l })) },
          ],
        },
      ];
  }
}

/** The values of a new item (before the user types). */
export function newValues(level: CatalogLevel, lk: CatalogLookups, ctx: { parentId: string | null; nextChapter: number; nextCode: number }): Record<string, unknown> {
  const source = lk.sources.find((s) => /server/i.test(s.name)) ?? lk.sources[0];
  switch (level) {
    case 'content-type':
      return { name: '', code: '', color: '#9b9b9b', family: 'program' };
    case 'content':
      return { title: '', code: '', nextProductionId: 1, segmentCount: 1, sourceId: source?.id ?? null, countries: [], channelIds: [], companies: [], secondaryActionIds: [], validFrom: null, validTo: null, lengthFrames: null, season: null };
    case 'production':
      return { title: '', code: '', chapter: ctx.nextChapter, isDefaultChapter: false, lengthFrames: null, sourceId: source?.id ?? null, segmentCount: 1, starts: null, expires: null, customValues: {}, countries: [], channelIds: [], secondaryActionIds: [], mediaStatus: null };
    case 'segmentation':
      return { code: ctx.nextCode, name: '' };
    case 'segment':
      return { code: ctx.nextCode, sourceId: source?.id ?? null, mediaId: '', tcInFrames: null, tcOutFrames: null, lengthFrames: null };
    case 'rotation-list':
      return { name: '', insertionDaysInterval: 0, randomInsert: true };
    case 'list-item':
      return {};
    case 'graphic-source':
      return { name: '', code: '', channelId: lk.channels[0]?.id ?? null };
    case 'graphic-template':
      return {
        name: '', sourceId: ctx.parentId, objectId: null, description: '', startType: 'from-start', startOffsetFrames: 0, startTcInFrames: 0, endType: 'automatic',
        endDurationFrames: 0, endTcOutFrames: 0, frequency: 'once', repeatIntervalFrames: 0, repeatCount: 0, layer: 'auto',
      };
    case 'graphic-object':
      return { name: '', code: '', sourceId: ctx.parentId, layer: 'auto' };
  }
}

/** The name field of a level (copied with "(copy)" by Create from template). */
export const NAME_KEY: Record<CatalogLevel, string | null> = {
  'content-type': 'name', content: 'title', production: 'title', segmentation: 'name', segment: null, 'rotation-list': 'name', 'list-item': null,
  'graphic-source': 'name', 'graphic-template': 'name', 'graphic-object': 'name',
};
