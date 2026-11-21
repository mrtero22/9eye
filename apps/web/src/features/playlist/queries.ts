import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { PlaylistKindName, WeekRunPlan } from '@9eye/core';
import { api, currentCompany } from '@/lib/api';
import { keys } from '@/lib/queries';
import type { TemplateSummary } from '@/lib/types';
import type { Day, RotationListRef, Week, WeekRunBody } from './model';

export { keys, useChannels } from '@/lib/queries';

export const weekKeys = {
  /** Every list of weeks: invalidate after a week is created, renamed or deleted. */
  all: () => ['weeks', currentCompany()] as const,
  year: (channelId: string | null, kind: PlaylistKindName, year: number) => ['weeks', currentCompany(), channelId, kind, year] as const,
  check: (channelId: string, body: WeekRunBody) => ['weeks-check', currentCompany(), channelId, body] as const,
};

/** The weeks of one playlist whose first day is in the year. */
export const useWeeks = (channelId: string | null, kind: PlaylistKindName, year: number) =>
  useQuery({
    queryKey: weekKeys.year(channelId, kind, year),
    queryFn: () => api<Week[]>('GET', `/channels/${channelId}/weeks?kind=${kind}&from=${year}-01-01&to=${year}-12-31`),
    enabled: !!channelId,
  });

/** What Create weeks would do with these choices (nothing is written). */
export const useWeekCheck = (channelId: string, body: WeekRunBody, enabled: boolean) =>
  useQuery({
    queryKey: weekKeys.check(channelId, body),
    queryFn: () => api<WeekRunPlan>('POST', `/channels/${channelId}/weeks/check`, body),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 0,
  });

export const dayKeys = {
  /** Every day that is open or cached: invalidate after a day or a week changes. */
  all: () => ['day', currentCompany()] as const,
  one: (channelId: string, kind: PlaylistKindName, date: string) => ['day', currentCompany(), channelId, kind, date] as const,
};

export const useDay = (channelId: string, kind: PlaylistKindName, date: string, enabled = true) =>
  useQuery({ queryKey: dayKeys.one(channelId, kind, date), queryFn: () => api<Day>('GET', `/channels/${channelId}/days/${date}?kind=${kind}`), placeholderData: keepPreviousData, enabled });

export const useChannelTemplates = (channelId: string | null, enabled = true) =>
  useQuery({ queryKey: keys.templates(channelId), queryFn: () => api<TemplateSummary[]>('GET', `/channels/${channelId}/templates`), enabled: !!channelId && enabled });

/** The company's rotation lists (filling a day's gaps). */
export const useRotationLists = (enabled: boolean) =>
  useQuery({ queryKey: ['rotation-lists', currentCompany()] as const, queryFn: () => api<RotationListRef[]>('GET', '/rotation-lists'), enabled });
