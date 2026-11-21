// Query keys and queries shared by several pages. Every key carries the company.

import { useQuery } from '@tanstack/react-query';
import { api, currentCompany } from './api';
import type { Channel } from './types';

export const keys = {
  channels: () => ['channels', currentCompany()] as const,
  templates: (channelId: string | null) => ['templates', currentCompany(), channelId] as const,
  template: (id: string | null) => ['template', currentCompany(), id] as const,
  allTemplates: () => ['template', currentCompany()] as const,
  blockTypes: () => ['block-types', currentCompany()] as const,
  blockGroups: () => ['block-groups', currentCompany()] as const,
  breakLists: (channelId: string | null) => ['break-lists', currentCompany(), channelId] as const,
  channelUsage: (channelId: string | null) => ['channel-usage', currentCompany(), channelId] as const,
  breakPositions: () => ['break-positions', currentCompany()] as const,
  clients: () => ['commercial-clients', currentCompany()] as const,
  contracts: () => ['commercial-contracts', currentCompany()] as const,
  contract: (id: string | null) => ['commercial-contracts', currentCompany(), id] as const,
  commercialOrder: (id: string) => ['commercial-order', currentCompany(), id] as const,
  commercialWeek: (id: string, from: string) => ['commercial-order', currentCompany(), id, 'week', from] as const,
  roles: () => ['roles', currentCompany()] as const,
  users: () => ['users', currentCompany()] as const,
  companies: () => ['admin-companies', currentCompany()] as const,
  connections: () => ['connections', currentCompany()] as const,
  catalogTypes: (families: string) => ['catalog-types', currentCompany(), families] as const,
  catalogContents: (typeId: string | null) => ['catalog-contents', currentCompany(), typeId] as const,
  catalogProductions: (contentId: string | null) => ['catalog-productions', currentCompany(), contentId] as const,
  catalogSearch: (q: string, families: string) => ['catalog-search', currentCompany(), q, families] as const,
  /** Everything an order page reads: invalidate after any order change. */
  orders: () => ['orders', currentCompany()] as const,
  /** The person's own AI tokens, in every company (not one company's). */
  myAiAccess: () => ['my-ai-access'] as const,
  aiPolicy: () => ['ai-policy', currentCompany()] as const,
  aiTokens: () => ['ai-tokens', currentCompany()] as const,
  activity: (filters: string) => ['activity', currentCompany(), filters] as const,
  /** Agents (decision 0024): the overview (agents, rooms, waiting count), one agent, a conversation. */
  agents: () => ['agents', currentCompany()] as const,
  agent: (id: string) => ['agents', currentCompany(), 'agent', id] as const,
  agentChat: (id: string) => ['agents', currentCompany(), 'chat', id] as const,
  agentRuns: (id: string) => ['agents', currentCompany(), 'runs', id] as const,
  agentRoom: (id: string) => ['agents', currentCompany(), 'room', id] as const,
  agentChanges: (status: string) => ['agents', currentCompany(), 'changes', status] as const,
  aiProviders: () => ['ai-providers', currentCompany()] as const,
};

export const useChannels = () => useQuery({ queryKey: keys.channels(), queryFn: () => api<Channel[]>('GET', '/channels') });
