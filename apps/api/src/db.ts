// Database access. Tenant isolation is enforced here, in one place (decision 0007): every query on a
// tenant-owned model gets the current company's id added, and fails when there is none.
// (Postgres row-level security comes later as a second guard.)

import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaClient } from '@prisma/client';

const tenantStore = new AsyncLocalStorage<{ tenantId: string }>();

export function withTenant<T>(tenantId: string, fn: () => T): T {
  return tenantStore.run({ tenantId }, fn);
}

export function currentTenantId(): string {
  const store = tenantStore.getStore();
  if (!store) throw new Error('No company selected for this database call');
  return store.tenantId;
}

/**
 * Models that carry tenant_id. Their children (template blocks, linked breaks, order channels and
 * items, airing items, segments, rotation list items, time-window ranges, playlist blocks and
 * events) are reached through them.
 */
const TENANT_MODELS = new Set([
  'Channel', 'ChannelPlaylist', 'BlockGroup', 'BlockType', 'Template', 'BreakList', 'BreakPosition', 'Role', 'Membership', 'Connection',
  'ContentType', 'Content', 'Production', 'Order', 'Airing',
  'Segmentation', 'Source', 'LogoType', 'Logo', 'SecondaryAction', 'CustomField', 'RotationList',
  'GraphicSource', 'GraphicObject', 'GraphicTemplate', 'TimeWindow', 'ProductCode', 'CatalogRelation',
  'Week', 'DayPlaylist', 'Client', 'Contract', 'AuditEvent',
  // agents (decision 0024); their memory and skill history are reached through the agent
  'AiProvider', 'Agent', 'AgentRoom', 'AgentMessage', 'AgentRun', 'AgentChange', 'AgentRoutine',
]);

/** Unscoped client: platform tables (tenant) and maintenance scripts only. */
export const platformDb = new PrismaClient();

export const db = platformDb.$extends({
  name: 'tenant-isolation',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!model || !TENANT_MODELS.has(model)) return query(args);
        const tenantId = currentTenantId();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const a: any = args ?? {};
        switch (operation) {
          case 'create':
            a.data = { ...a.data, tenantId };
            break;
          case 'createMany':
          case 'createManyAndReturn':
            a.data = (Array.isArray(a.data) ? a.data : [a.data]).map((d: object) => ({ ...d, tenantId }));
            break;
          case 'upsert':
            a.where = { ...a.where, tenantId };
            a.create = { ...a.create, tenantId };
            break;
          default:
            a.where = { ...a.where, tenantId };
        }
        return query(a);
      },
    },
  },
});

export type Db = typeof db;
export type Tx = Parameters<Parameters<Db['$transaction']>[0]>[0];

export const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);
export const fromIsoDate = (s: string) => new Date(`${s}T00:00:00Z`);
