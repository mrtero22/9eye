import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { keys } from '@/lib/queries';
import type { BlockGroup, BlockType, BreakList, TemplateFull, TemplateSummary } from '@/lib/types';

export { keys, useChannels } from '@/lib/queries';

export const useTemplates = (channelId: string | null) =>
  useQuery({ queryKey: keys.templates(channelId), queryFn: () => api<TemplateSummary[]>('GET', `/channels/${channelId}/templates`), enabled: !!channelId });

export const useTemplateFull = (id: string | null) =>
  useQuery({ queryKey: keys.template(id), queryFn: () => api<TemplateFull>('GET', `/templates/${id}`), enabled: !!id });

export const useBlockTypes = () => useQuery({ queryKey: keys.blockTypes(), queryFn: () => api<BlockType[]>('GET', '/block-types') });

export const useBlockGroups = () => useQuery({ queryKey: keys.blockGroups(), queryFn: () => api<BlockGroup[]>('GET', '/block-groups') });

export const useBreakLists = (channelId: string | null, enabled: boolean) =>
  useQuery({ queryKey: keys.breakLists(channelId), queryFn: () => api<BreakList[]>('GET', `/channels/${channelId}/break-lists`), enabled: !!channelId && enabled });
