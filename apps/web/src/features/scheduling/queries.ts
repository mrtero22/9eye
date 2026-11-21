import { useQuery } from '@tanstack/react-query';
import { api, currentCompany } from '@/lib/api';
import type { ChannelWeek, CompactTemplate, OrderFull, OrderList } from '@/lib/types';

export { useChannels } from '@/lib/queries';

export const orderKeys = {
  all: () => ['orders', currentCompany()] as const,
  list: (channelId: string | null) => ['orders', currentCompany(), 'list', channelId] as const,
  one: (id: string | null) => ['orders', currentCompany(), 'one', id] as const,
  week: (channelId: string | null, from: string | null) => ['orders', currentCompany(), 'week', channelId, from] as const,
  template: (channelId: string | null, from: string | null) => ['orders', currentCompany(), 'template', channelId, from] as const,
  occupied: (id: string | null) => ['orders', currentCompany(), 'occupied', id] as const,
  targets: (id: string | null) => ['orders', currentCompany(), 'targets', id] as const,
};

export const useOrderList = (channelId: string | null) =>
  useQuery({ queryKey: orderKeys.list(channelId), queryFn: () => api<OrderList>('GET', `/channels/${channelId}/orders`), enabled: !!channelId });

export const useOrder = (id: string | null) => useQuery({ queryKey: orderKeys.one(id), queryFn: () => api<OrderFull>('GET', `/orders/${id}`), enabled: !!id });

export const useChannelWeek = (channelId: string | null, from: string | null) =>
  useQuery({ queryKey: orderKeys.week(channelId, from), queryFn: () => api<ChannelWeek>('GET', `/channels/${channelId}/schedule-week?from=${from}`), enabled: !!channelId && !!from, placeholderData: (prev) => prev });

export const useMainTemplate = (channelId: string | null, from: string | null) =>
  useQuery({ queryKey: orderKeys.template(channelId, from), queryFn: () => api<CompactTemplate | null>('GET', `/channels/${channelId}/main-template?from=${from}`), enabled: !!channelId && !!from });

export const useOccupied = (id: string | null, enabled: boolean) =>
  useQuery({
    queryKey: orderKeys.occupied(id),
    queryFn: () => api<{ channelId: string; date: string; blockTypeId: string; orderName: string }[]>('GET', `/orders/${id}/occupied`),
    enabled: !!id && enabled,
  });
