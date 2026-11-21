// The Media page's modes (the Catalog page until 2026-11-16) and the columns of each (catalog-page.md "Layout").

import type { CatalogLevel } from '@9eye/core';
import type { RowSwatch } from '@/ui';

export type Mode = 'catalog' | 'graphics' | 'lists';

export const MODES: { value: Mode; label: string }[] = [
  { value: 'catalog', label: 'Media' },
  { value: 'graphics', label: 'Graphics' },
  { value: 'lists', label: 'Rotation lists' },
];

export const MODE_LEVELS: Record<Mode, CatalogLevel[]> = {
  catalog: ['content-type', 'content', 'production', 'segmentation', 'segment'],
  graphics: ['graphic-source', 'graphic-template', 'graphic-object'],
  lists: ['rotation-list', 'list-item'],
};

/** The form shown first when a mode opens. */
export const MODE_FOCUS: Record<Mode, CatalogLevel> = { catalog: 'production', graphics: 'graphic-template', lists: 'rotation-list' };

export interface LevelInfo {
  title: string;
  /** "content type" — for "Delete 2 content types". */
  one: string;
  entity: string;
  createLabel: string;
  /** Contents and productions can hide expired items. */
  expiredFilter: boolean;
  /** Selected rows show Relations. */
  relations: boolean;
  /** What to select first (the parent level), null = top level. */
  needs: string | null;
  empty: string;
}

export const LEVELS: Record<CatalogLevel, LevelInfo> = {
  'content-type': { title: 'Categories', one: 'category', entity: 'Category', createLabel: 'Create', expiredFilter: false, relations: true, needs: null, empty: 'No categories' },
  content: { title: 'Titles', one: 'title', entity: 'Title', createLabel: 'Create', expiredFilter: true, relations: true, needs: 'Select a category', empty: 'No titles' },
  production: { title: 'Items', one: 'item', entity: 'Item', createLabel: 'Create item', expiredFilter: true, relations: true, needs: 'Select a title', empty: 'No items' },
  segmentation: { title: 'Cuts', one: 'cut', entity: 'Cut', createLabel: 'Create', expiredFilter: false, relations: true, needs: 'Select an item', empty: 'No cuts' },
  segment: { title: 'Parts', one: 'part', entity: 'Part', createLabel: 'Create part', expiredFilter: false, relations: true, needs: 'Select a cut', empty: 'No parts' },
  'rotation-list': { title: 'Rotation lists', one: 'rotation list', entity: 'Rotation list', createLabel: 'Create rotation list', expiredFilter: false, relations: false, needs: null, empty: 'No rotation lists' },
  'list-item': { title: 'List items', one: 'item', entity: 'List item', createLabel: 'Add items', expiredFilter: false, relations: false, needs: 'Select a rotation list', empty: 'This list is empty' },
  'graphic-source': { title: 'Graphic sources', one: 'graphic source', entity: 'Graphic source', createLabel: 'Create', expiredFilter: false, relations: false, needs: null, empty: 'No graphic sources' },
  'graphic-template': { title: 'Graphic templates', one: 'graphic template', entity: 'Graphic template', createLabel: 'Create', expiredFilter: false, relations: false, needs: 'Select a graphic source', empty: 'No graphic templates' },
  'graphic-object': { title: 'Graphic objects', one: 'graphic object', entity: 'Graphic object', createLabel: 'Create', expiredFilter: false, relations: false, needs: 'Select a graphic source', empty: 'No graphic objects' },
};

export const swatchOf = (level: CatalogLevel, color: string | null): RowSwatch =>
  level === 'rotation-list' || level === 'list-item' ? { token: 'filler' } : level.startsWith('graphic') ? { token: 'jingle' } : { color };

export const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
