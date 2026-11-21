import { keepPreviousData, useQuery, type QueryClient } from '@tanstack/react-query';
import type { CatalogLevel, SearchCondition } from '@9eye/core';
import { api, currentCompany } from '@/lib/api';
import type { CatalogColumnResult, CatalogItem, CatalogLookups, CatalogRelations } from '@/lib/types';

export const catalogKeys = {
  all: () => ['catalog-page', currentCompany()] as const,
  lookups: () => ['catalog-page', currentCompany(), 'lookups'] as const,
  column: (level: CatalogLevel, params: string) => ['catalog-page', currentCompany(), 'column', level, params] as const,
  columnLevel: (level: CatalogLevel) => ['catalog-page', currentCompany(), 'column', level] as const,
  item: (level: CatalogLevel | null, id: string | null) => ['catalog-page', currentCompany(), 'item', level, id] as const,
  relations: (level: CatalogLevel | null, id: string | null) => ['catalog-page', currentCompany(), 'relations', level, id] as const,
};

/** After any catalog change: the page and the shared catalog picker read again. */
export const refreshCatalog = (qc: QueryClient) =>
  qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith('catalog-') });

export const useLookups = () => useQuery({ queryKey: catalogKeys.lookups(), queryFn: () => api<CatalogLookups>('GET', '/catalog/lookups') });

export interface ColumnParams {
  parentId: string | null;
  q: string;
  conditions: SearchCondition[];
  sort: string | null;
  dir: 'asc' | 'desc';
  expired: boolean;
}

export function columnUrl(level: CatalogLevel, p: ColumnParams): string {
  const qs = new URLSearchParams();
  if (p.parentId) qs.set('parent', p.parentId);
  if (p.q.trim()) qs.set('q', p.q.trim());
  const conds = p.conditions.filter((c) => c.value.trim() || c.op === 'empty');
  if (conds.length) qs.set('conditions', JSON.stringify(conds));
  if (p.sort) qs.set('sort', p.sort);
  qs.set('dir', p.dir);
  if (p.expired) qs.set('expired', '1');
  return `/catalog/columns/${level}?${qs.toString()}`;
}

export const useColumn = (level: CatalogLevel, p: ColumnParams, enabled: boolean) => {
  const url = columnUrl(level, p);
  return useQuery({ queryKey: catalogKeys.column(level, url), queryFn: () => api<CatalogColumnResult>('GET', url), enabled, placeholderData: keepPreviousData });
};

export const useItem = (level: CatalogLevel | null, id: string | null) =>
  useQuery({ queryKey: catalogKeys.item(level, id), queryFn: () => api<CatalogItem>('GET', `/catalog/items/${level}/${id}`), enabled: !!level && !!id });

export const useRelations = (level: CatalogLevel | null, id: string | null) =>
  useQuery({ queryKey: catalogKeys.relations(level, id), queryFn: () => api<CatalogRelations>('GET', `/catalog/relations/${level}/${id}`), enabled: !!level && !!id });
