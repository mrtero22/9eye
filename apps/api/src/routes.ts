// HTTP API. Every route below /api except health and sign-in needs a signed-in person (decision 0021);
// all but the company list then run for one company, each behind its role rule (src/rules.ts) and
// with its changes in the audit log (decision 0023).

import { Router } from 'express';
import { z } from 'zod';
import { addDays } from '@9eye/core';
import { reachesChannel } from './access';
import { recordChanges } from './audit';
import { db, fromIsoDate, platformDb } from './db';
import { companyPolicy, companyTokens, makeToken, myAiAccess, revokeInCompany, revokeMine, savePolicy } from './services/aiAccess';
import { authRouter, requireSession, signedInUser } from './auth';
import { accessOfRequest, guarded } from './rules';
import { agentRoutes } from './agents/routes';
import { tenantMiddleware } from './tenant';
import { channelDto } from './services/dto';
import { cloneTemplate, createTemplate, deleteTemplate, getTemplateFull, listTemplates, saveTemplate } from './services/templates';
import { checkWeeks, createWeeks, deleteWeek, getWeek, listWeeks, renameWeek } from './services/weeks';
import { catalogRows, getDay, rotationLists, runStep, saveDay, setPublished } from './services/days';
import { exportDay } from './services/exports';
import { createBlockTypes, createBlockTypesBulk, deleteBlockType, listBlockGroups, listBlockTypes, updateBlockType } from './services/blockTypes';
import { createBreakList, deleteBreakList, listBreakLists, updateBreakList } from './services/breakLists';
import { listBreakPositions, saveBreakPositions } from './services/breakPositions';
import { bookSpots, commercialWeek, getCommercialOrder, saveCommercialOrder, saveCommercialWeek } from './services/commercialOrders';
import {
  CLIENT_TYPES,
  createClient,
  createContract,
  createContractOrders,
  deleteClient,
  deleteCommercialOrder,
  deleteContract,
  getContract,
  listClients,
  listContracts,
  updateClient,
  updateContract,
} from './services/commercials';
import { channelUsage, createChannel, getChannel, updateChannel } from './services/channels';
import { FAMILIES, listContentTypes, listContents, listProductions, searchCatalog, type Family } from './services/catalog';
import { listColumn } from './services/catalogBrowse';
import { createItem, getItem, saveItem } from './services/catalogItems';
import {
  addListItems,
  bulkBody,
  bulkEdit,
  catalogLookups,
  cloneList,
  createSegmentation,
  createSeries,
  deleteCheck,
  deleteItems,
  getRelations,
  nextEpisode,
  regenerateSegmentation,
  relationsBody,
  saveRelations,
  segmentationBody,
  seriesBody,
  shuffleList,
} from './services/catalogOps';
import {
  channelWeek,
  createOrder,
  deleteOrder,
  duplicate,
  getOrderFull,
  listOrders,
  mainTemplateDto,
  moveAirings,
  moveTargets,
  occupiedCells,
  saveOrder,
  split,
} from './services/orders';
import { CATALOG_LEVELS, ORDER_MODES, type CatalogLevel } from '@9eye/core';
import {
  changeMemberRole,
  createCompany,
  createRole,
  deleteConnection,
  inviteUser,
  listCompanies,
  listConnections,
  listRoles,
  listUsers,
  removeMember,
  saveConnection,
  updateRole,
} from './services/admin';

const id = z.uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'use #rrggbb');
const weekdays = z.array(z.boolean()).length(7);

const blockBody = z.object({
  id,
  weekday: z.number().int().min(0).max(6),
  blockTypeId: id,
  startFrames: z.number().int(),
  lengthFrames: z.number().int(),
  fillGaps: z.boolean(),
  opensWithBreak: z.boolean(),
  note: z.string().max(4000),
  rotationListId: id.nullable(),
  limitsPerContentType: z.array(z.unknown()).max(100),
  breaks: z.array(id).max(200),
});

const saveBody = z.object({
  version: z.number().int(),
  name: z.string().max(200),
  validFrom: isoDate,
  validTo: isoDate,
  activeWeekdays: weekdays,
  blocks: z.array(blockBody).max(10000),
});

const nameDates = z.object({ name: z.string().max(200), validFrom: isoDate, validTo: isoDate });

const playlistKind = z.enum(['main', 'ads']);
const weekRunBody = z.object({
  kinds: z.array(playlistKind).max(2),
  fromWeek: isoDate,
  toWeek: isoDate,
  templates: z.object({ main: id.nullable().optional(), ads: id.nullable().optional() }).optional(),
  activeWeekdays: weekdays.nullable().optional(),
});
const weekRange = z.object({ kind: playlistKind, from: isoDate, to: isoDate });

const dayRowBody = z.object({
  id,
  kind: z.string().max(40),
  title: z.string().max(400),
  lengthFrames: z.number().int(),
  productionId: id.nullable(),
  segmentId: id.nullable(),
  tcInFrames: z.number().int(),
  tcOutFrames: z.number().int(),
  fixed: z.boolean(),
  hold: z.boolean(),
  autoAdjust: z.boolean(),
  note: z.string().max(8000),
  breakTypeId: id.nullable(),
  relatedEventId: id.nullable(),
  orderId: id.nullable(),
  rotationListId: id.nullable(),
  /** Ads playlist: the booked spot the row airs. */
  airingItemId: id.nullable().default(null),
});
const saveDayBody = z.object({
  version: z.number().int(),
  blocks: z.array(z.object({ id, rows: z.array(dayRowBody).max(5000) })).max(500),
});
const runDayBody = saveDayBody.extend({
  step: z.enum(['programs', 'breaks', 'rotation', 'commercials']),
  mode: z.enum(['all', 'missing']),
  listId: id.nullable().optional(),
  blockIds: z.array(id).max(500).nullable().optional(),
});

const blockTypeFields = z.object({
  color: hexColor,
  textColor: hexColor,
  lengthFrames: z.number().int(),
  validFrom: isoDate,
  validTo: isoDate,
  validWeekdays: weekdays,
  fillGaps: z.boolean(),
  opensWithBreak: z.boolean(),
  note: z.string().max(4000),
});

const channelBody = z.object({
  version: z.number().int(),
  name: z.string().max(200),
  code: z.string().max(100),
  frameRate: z.string().max(20),
  dayStartFrames: z.number().int(),
  weekStart: z.number().int(),
  timeZone: z.string().max(100).nullable(),
  dateLocale: z.string().max(40),
  hasAds: z.boolean(),
  ageLogoPosition: z.string().max(20).nullable().optional(),
  defaultBreakListId: id.nullable().optional(),
  shortestBreakFrames: z.number().int().optional(),
  defaultExport: z.string().max(40).nullable().optional(),
  allowedExports: z.array(z.string().max(40)).max(50).optional(),
  epgTypes: z.array(z.string().max(40)).max(20).optional(),
  bxfTimesUtc: z.boolean().optional(),
  reconcileTolerance: z.number().int().optional(),
});

const newChannelBody = z.object({
  name: z.string().max(200),
  code: z.string().max(100),
  frameRate: z.string().max(20),
  dayStartFrames: z.number().int(),
  weekStart: z.number().int(),
  hasAds: z.boolean(),
});

const roleBody = z.object({
  version: z.number().int(),
  grants: z.array(z.object({ module: z.string().max(40), action: z.string().max(40) })).max(100),
  allChannels: z.boolean(),
  channelIds: z.array(id).max(1000),
});

const connectionBody = z.object({
  kind: z.string().max(40),
  adapter: z.string().max(40),
  detail: z.string().max(400),
  address: z.string().max(400),
  userName: z.string().max(200),
  credentials: z.string().max(4000).optional(),
});

/** "program,filling" → families (all when none given). */
const catalogLevel = z.enum(CATALOG_LEVELS as [CatalogLevel, ...CatalogLevel[]]);
const searchConditions = z
  .string()
  .max(8000)
  .optional()
  .transform((v, ctx) => {
    if (!v) return [];
    try {
      return z.array(z.object({ field: z.string().max(100), op: z.enum(['contains', 'is', 'empty', 'between']), value: z.string().max(400) })).max(20).parse(JSON.parse(v));
    } catch {
      ctx.addIssue({ code: 'custom', message: 'conditions are not valid' });
      return z.NEVER;
    }
  });

const familiesOf = (v: unknown): Family[] => {
  const xs = String(v ?? '').split(',').map((x) => x.trim()).filter((x): x is Family => (FAMILIES as string[]).includes(x));
  return xs.length ? xs : FAMILIES;
};

const timeWindow = z.object({ weekdays: weekdays, fromFrames: z.number().int(), toFrames: z.number().int() });
const timeWindows = z.object({ allowed: z.array(timeWindow).max(50), rejected: z.array(timeWindow).max(50) });
const limits = { maxAirings: z.number().int().nullable(), totalAirings: z.number().int().nullable(), timeWindows };
const orderMode = z.enum(ORDER_MODES as [string, ...string[]]);

const orderBody = z.object({
  version: z.number().int(),
  name: z.string().max(200),
  mode: orderMode,
  status: z.enum(['confirmed', 'draft']),
  startDate: isoDate,
  endDate: isoDate,
  color: hexColor,
  firstItemId: id.nullable(),
  reuseInLoop: z.boolean(),
  ...limits,
  channels: z.array(z.object({ channelId: id, templateId: id })).min(1).max(50),
  items: z.array(z.object({ id, productionId: id, lengthFrames: z.number().int().nullable() })).max(5000),
  airings: z
    .array(
      z.object({
        id,
        channelId: id,
        date: isoDate,
        blockTypeId: id,
        passes: z.number().int(),
        repeatOfId: id.nullable(),
        repeatIndex: z.number().int(),
        blockColor: hexColor.nullable(),
        items: z.array(z.object({ itemId: id, passes: z.number().int(), jingle: z.enum(['pre', 'post']).nullable() })).max(500),
      }),
    )
    .max(100000),
});

const newOrderBody = z.object({
  name: z.string().max(200),
  mode: orderMode,
  channelIds: z.array(id).min(1).max(50),
  startDate: isoDate,
  endDate: isoDate,
  productionIds: z.array(id).max(5000),
  firstProductionId: id.nullable(),
  reuseInLoop: z.boolean(),
  ...limits,
});

const breakListBody = z.object({ name: z.string().max(120), positions: z.array(z.number().int().min(0).max(500)).max(200) });

const text = (max: number) => z.string().max(max);
const clientBody = z.object({
  name: text(500),
  type: z.enum(CLIENT_TYPES),
  country: text(100),
  address: text(1000),
  billingAddress: text(1000),
  web: text(300),
  email: text(320),
  phone: text(100),
  fax: text(100),
  vatNumber: text(100),
  notes: text(4000),
  toleranceSeconds: z.number().int().min(0).max(86400).nullable(),
});
const contractBody = z.object({
  clientId: id,
  name: text(500),
  startDate: isoDate,
  endDate: isoDate,
  currency: z.string().max(3),
  totalAgreed: z.number().min(0).max(999999999999),
  notes: text(4000),
  channelIds: z.array(id).max(200),
});

const breakPositionsBody = z.object({
  rows: z
    .array(
      z.object({
        id: id.nullable(),
        version: z.number().int().nullable(),
        name: z.string().max(500),
        isDefault: z.boolean(),
        color: hexColor.nullable(),
        priceModifier: z.number().min(-100).max(10000),
        contentTypeIds: z.array(id).max(500),
      }),
    )
    .max(200),
  deletedIds: z.array(id).max(200),
});

export function apiRouter(): Router {
  const r = Router();

  r.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  r.use('/auth', authRouter());

  r.use(requireSession);

  // The companies the person can open: every company for a platform admin, else their active memberships.
  r.get('/tenants', async (_req, res) => {
    const user = signedInUser(res);
    const rows = await platformDb.tenant.findMany({
      where: user.platformAdmin ? {} : { memberships: { some: { userId: user.id, status: 'active' } } },
      orderBy: { name: 'asc' },
    });
    res.json(rows.map((t) => ({ id: t.id, name: t.name, slug: t.slug })));
  });

  // The person's own AI tokens, in every company they can open (decision 0023, ai-access-page.md).
  r.get('/me/ai-access', async (_req, res) => {
    res.json(await myAiAccess(signedInUser(res)));
  });

  r.post('/me/ai-tokens', async (req, res) => {
    // limits: the same as the company, read only, or its own table (decision 0025); `access` is the
    // older form ("read" → read only, "edit" → the same as the company)
    const body = z
      .object({
        company: z.string().max(100),
        name: z.string().max(200),
        days: z.number().int(),
        limits: z.discriminatedUnion('kind', [z.object({ kind: z.literal('same') }), z.object({ kind: z.literal('read') }), z.object({ kind: z.literal('custom'), table: z.record(z.string(), z.record(z.string(), z.string())) })]).optional(),
        access: z.enum(['read', 'edit']).optional(),
      })
      .parse(req.body);
    const limits = body.limits ?? (body.access === 'read' ? { kind: 'read' as const } : { kind: 'same' as const });
    res.status(201).json(await makeToken(signedInUser(res), { company: body.company, name: body.name, days: body.days, limits }));
  });

  r.delete('/me/ai-tokens/:id', async (req, res) => {
    await revokeMine(signedInUser(res), id.parse(req.params.id));
    res.status(204).end();
  });

  r.use(tenantMiddleware);
  // Every change below that succeeds goes to the audit log; every route needs its rule (src/rules.ts).
  r.use(recordChanges);
  const g = guarded(r);

  g.get('/channels', async (_req, res) => {
    const rows = await db.channel.findMany({
      where: { deletedAt: null },
      include: { playlists: { include: { _count: { select: { templates: { where: { deletedAt: null } } } } } } },
      orderBy: { name: 'asc' },
    });
    const a = accessOfRequest(res);
    res.json(rows.filter((c) => reachesChannel(a, c.id)).map(channelDto));
  });

  g.post('/channels', async (req, res) => {
    res.status(201).json(await createChannel(newChannelBody.parse(req.body)));
  });

  g.get('/channels/:id/usage', async (req, res) => {
    res.json(await channelUsage(id.parse(req.params.id)));
  });

  g.get('/channels/:id', async (req, res) => {
    res.json(await getChannel(id.parse(req.params.id)));
  });

  g.put('/channels/:id', async (req, res) => {
    res.json(await updateChannel(id.parse(req.params.id), channelBody.parse(req.body)));
  });

  g.get('/channels/:id/templates', async (req, res) => {
    res.json(await listTemplates(id.parse(req.params.id)));
  });

  g.post('/templates', async (req, res) => {
    const body = nameDates.extend({ playlistId: id }).parse(req.body);
    res.status(201).json(await createTemplate(body));
  });

  g.get('/templates/:id', async (req, res) => {
    res.json(await getTemplateFull(id.parse(req.params.id)));
  });

  g.put('/templates/:id', async (req, res) => {
    res.json(await saveTemplate(id.parse(req.params.id), saveBody.parse(req.body)));
  });

  g.post('/templates/:id/clone', async (req, res) => {
    res.status(201).json(await cloneTemplate(id.parse(req.params.id), nameDates.parse(req.body)));
  });

  g.delete('/templates/:id', async (req, res) => {
    await deleteTemplate(id.parse(req.params.id));
    res.status(204).end();
  });

  g.get('/channels/:id/weeks', async (req, res) => {
    const q = weekRange.parse(req.query);
    res.json(await listWeeks(id.parse(req.params.id), q.kind, q.from, q.to));
  });

  // What Create weeks would do, without writing anything.
  g.post('/channels/:id/weeks/check', async (req, res) => {
    res.json(await checkWeeks(id.parse(req.params.id), weekRunBody.parse(req.body)));
  });

  g.post('/channels/:id/weeks', async (req, res) => {
    res.status(201).json(await createWeeks(id.parse(req.params.id), weekRunBody.parse(req.body), signedInUser(res).id));
  });

  g.get('/weeks/:id', async (req, res) => {
    res.json(await getWeek(id.parse(req.params.id)));
  });

  g.patch('/weeks/:id', async (req, res) => {
    const body = z.object({ name: z.string().max(200), version: z.number().int() }).parse(req.body);
    res.json(await renameWeek(id.parse(req.params.id), body, signedInUser(res).id));
  });

  g.delete('/weeks/:id', async (req, res) => {
    await deleteWeek(id.parse(req.params.id));
    res.status(204).end();
  });

  // One day playlist: every block and row at the time it really starts.
  g.get('/channels/:id/days/:date', async (req, res) => {
    const q = z.object({ kind: playlistKind }).parse(req.query);
    res.json(await getDay(id.parse(req.params.id), q.kind, isoDate.parse(req.params.date)));
  });

  // A day's playout file, made from its saved main playlist (Playout XML so far).
  g.get('/channels/:id/days/:date/export', async (req, res) => {
    const q = z.object({ format: z.string().min(1).max(40) }).parse(req.query);
    res.json(await exportDay(id.parse(req.params.id), isoDate.parse(req.params.date), q.format));
  });

  // Catalog items as playlist rows, before they are saved in a day.
  g.post('/days/catalog-rows', async (req, res) => {
    const body = z.object({ productionIds: z.array(id).max(500) }).parse(req.body);
    res.json(await catalogRows(body.productionIds));
  });

  g.put('/days/:id', async (req, res) => {
    res.json(await saveDay(id.parse(req.params.id), saveDayBody.parse(req.body)));
  });

  // Fill a day from what exists: one step on the draft (nothing is saved).
  g.post('/days/:id/run', async (req, res) => {
    res.json(await runStep(id.parse(req.params.id), runDayBody.parse(req.body)));
  });

  // The rotation lists a day can be filled from.
  g.get('/rotation-lists', async (_req, res) => {
    res.json(await rotationLists());
  });

  g.post('/days/:id/publish', async (req, res) => {
    const body = z.object({ version: z.number().int() }).parse(req.body);
    res.json(await setPublished(id.parse(req.params.id), { publish: true, version: body.version }));
  });

  g.post('/days/:id/unpublish', async (req, res) => {
    const body = z.object({ version: z.number().int() }).parse(req.body);
    res.json(await setPublished(id.parse(req.params.id), { publish: false, version: body.version }));
  });

  g.get('/block-types', async (_req, res) => {
    const a = accessOfRequest(res);
    res.json((await listBlockTypes()).filter((t) => reachesChannel(a, t.channelId)));
  });

  g.get('/block-groups', async (_req, res) => {
    res.json(await listBlockGroups());
  });

  g.post('/block-types', async (req, res) => {
    const body = blockTypeFields
      .extend({
        playlistId: id,
        groupId: id.optional(),
        newGroupName: z.string().trim().min(1).max(120).optional(),
        names: z.array(z.string().max(120)).min(1).max(200),
      })
      .parse(req.body);
    res.status(201).json(await createBlockTypes(body));
  });

  g.post('/block-types/bulk', async (req, res) => {
    const body = z
      .object({
        playlistId: id,
        items: z.array(blockTypeFields.extend({ groupId: id, name: z.string().max(120) })).max(2000),
      })
      .parse(req.body);
    res.status(201).json(await createBlockTypesBulk(body));
  });

  g.patch('/block-types/:id', async (req, res) => {
    const body = blockTypeFields
      .partial()
      .extend({ name: z.string().max(120).optional(), groupId: id.optional(), newGroupName: z.string().trim().min(1).max(120).optional() })
      .parse(req.body);
    res.json(await updateBlockType(id.parse(req.params.id), body));
  });

  g.delete('/block-types/:id', async (req, res) => {
    await deleteBlockType(id.parse(req.params.id));
    res.status(204).end();
  });

  g.get('/channels/:id/break-lists', async (req, res) => {
    res.json(await listBreakLists(id.parse(req.params.id)));
  });

  g.post('/channels/:id/break-lists', async (req, res) => {
    res.status(201).json(await createBreakList(id.parse(req.params.id), breakListBody.parse(req.body)));
  });

  g.patch('/break-lists/:id', async (req, res) => {
    res.json(await updateBreakList(id.parse(req.params.id), breakListBody.partial().parse(req.body)));
  });

  g.delete('/break-lists/:id', async (req, res) => {
    await deleteBreakList(id.parse(req.params.id));
    res.status(204).end();
  });

  // ------------------------------------------------------------ catalog (read by the shared catalog picker)

  g.get('/catalog/types', async (req, res) => {
    res.json(await listContentTypes(familiesOf(req.query.families)));
  });

  g.get('/catalog/types/:id/contents', async (req, res) => {
    res.json(await listContents(id.parse(req.params.id)));
  });

  g.get('/catalog/contents/:id/productions', async (req, res) => {
    res.json(await listProductions(id.parse(req.params.id)));
  });

  g.get('/catalog/search', async (req, res) => {
    res.json(await searchCatalog(z.string().max(200).parse(req.query.q ?? ''), familiesOf(req.query.families)));
  });

  // ------------------------------------------------------------ Catalog page (catalog-page.md)

  g.get('/catalog/lookups', async (_req, res) => {
    res.json(await catalogLookups());
  });

  g.get('/catalog/columns/:level', async (req, res) => {
    const level = catalogLevel.parse(req.params.level);
    const q = z
      .object({
        parent: id.optional(), q: z.string().max(200).default(''), conditions: searchConditions, sort: z.string().max(60).optional(),
        dir: z.enum(['asc', 'desc']).default('asc'), expired: z.enum(['0', '1']).default('0'),
      })
      .parse(req.query);
    res.json(await listColumn(level, { parentId: q.parent ?? null, q: q.q, conditions: q.conditions, sort: q.sort ?? null, dir: q.dir, expired: q.expired === '1' }));
  });

  g.get('/catalog/items/:level/:id', async (req, res) => {
    res.json(await getItem(catalogLevel.parse(req.params.level), id.parse(req.params.id)));
  });

  g.post('/catalog/items/:level', async (req, res) => {
    const parent = z.object({ parentId: id.nullable().default(null) }).parse(req.body ?? {}).parentId;
    res.status(201).json(await createItem(catalogLevel.parse(req.params.level), parent, req.body));
  });

  g.put('/catalog/items/:level/:id', async (req, res) => {
    res.json(await saveItem(catalogLevel.parse(req.params.level), id.parse(req.params.id), req.body));
  });

  g.post('/catalog/delete-check/:level', async (req, res) => {
    res.json(await deleteCheck(catalogLevel.parse(req.params.level), z.object({ ids: z.array(id).min(1).max(1000) }).parse(req.body).ids));
  });

  g.post('/catalog/delete/:level', async (req, res) => {
    res.json(await deleteItems(catalogLevel.parse(req.params.level), z.object({ ids: z.array(id).min(1).max(1000) }).parse(req.body).ids));
  });

  g.post('/catalog/bulk-edit/:level', async (req, res) => {
    res.json(await bulkEdit(z.enum(['content', 'production']).parse(req.params.level), bulkBody.parse(req.body)));
  });

  g.get('/catalog/contents/:id/next-episode', async (req, res) => {
    res.json(await nextEpisode(id.parse(req.params.id)));
  });

  g.post('/catalog/contents/:id/series', async (req, res) => {
    res.status(201).json(await createSeries(id.parse(req.params.id), seriesBody.parse(req.body)));
  });

  g.post('/catalog/productions/:id/segmentations', async (req, res) => {
    res.status(201).json(await createSegmentation(id.parse(req.params.id), segmentationBody.parse(req.body)));
  });

  g.post('/catalog/segmentations/:id/regenerate', async (req, res) => {
    res.json(await regenerateSegmentation(id.parse(req.params.id), segmentationBody.extend({ version: z.number().int() }).parse(req.body)));
  });

  g.post('/catalog/rotation-lists/:id/clone', async (req, res) => {
    res.status(201).json(await cloneList(id.parse(req.params.id)));
  });

  g.post('/catalog/rotation-lists/:id/items', async (req, res) => {
    res.status(201).json(await addListItems(id.parse(req.params.id), z.object({ productionIds: z.array(id).min(1).max(2000) }).parse(req.body).productionIds));
  });

  g.post('/catalog/rotation-lists/:id/shuffle', async (req, res) => {
    res.json(await shuffleList(id.parse(req.params.id)));
  });

  g.get('/catalog/relations/:level/:id', async (req, res) => {
    res.json(await getRelations(catalogLevel.parse(req.params.level), id.parse(req.params.id)));
  });

  g.put('/catalog/relations/:level/:id', async (req, res) => {
    res.json(await saveRelations(catalogLevel.parse(req.params.level), id.parse(req.params.id), relationsBody.parse(req.body)));
  });

  // ------------------------------------------------------------ orders (Scheduling page)

  g.get('/channels/:id/orders', async (req, res) => {
    res.json(await listOrders(id.parse(req.params.id)));
  });

  g.get('/channels/:id/schedule-week', async (req, res) => {
    res.json(await channelWeek(id.parse(req.params.id), isoDate.parse(req.query.from)));
  });

  g.get('/channels/:id/main-template', async (req, res) => {
    const from = isoDate.parse(req.query.from);
    res.json(await mainTemplateDto(id.parse(req.params.id), from, isoDate.optional().parse(req.query.to) ?? from));
  });

  g.post('/orders', async (req, res) => {
    const body = newOrderBody.parse(req.body);
    res.status(201).json(await createOrder({ ...body, mode: body.mode as never }));
  });

  g.get('/orders/:id', async (req, res) => {
    res.json(await getOrderFull(id.parse(req.params.id)));
  });

  g.put('/orders/:id', async (req, res) => {
    const body = orderBody.parse(req.body);
    res.json(await saveOrder(id.parse(req.params.id), { ...body, mode: body.mode as never }));
  });

  g.delete('/orders/:id', async (req, res) => {
    await deleteOrder(id.parse(req.params.id));
    res.status(204).end();
  });

  g.get('/orders/:id/occupied', async (req, res) => {
    res.json(await occupiedCells(id.parse(req.params.id)));
  });

  g.post('/orders/:id/duplicate', async (req, res) => {
    res.status(201).json(await duplicate(id.parse(req.params.id), z.object({ name: z.string().max(200) }).parse(req.body).name));
  });

  g.post('/orders/:id/split', async (req, res) => {
    res.status(201).json(await split(id.parse(req.params.id), z.object({ version: z.number().int(), date: isoDate, name: z.string().max(200) }).parse(req.body)));
  });

  g.get('/orders/:id/move-targets', async (req, res) => {
    res.json(await moveTargets(id.parse(req.params.id)));
  });

  g.post('/orders/:id/move', async (req, res) => {
    const body = z.object({ version: z.number().int(), itemIds: z.array(id).min(1).max(5000), targetId: id, targetVersion: z.number().int() }).parse(req.body);
    res.json(await moveAirings(id.parse(req.params.id), body));
  });

  // ------------------------------------------------------------ admin: organisation and output

  // Only the companies the person can open (a platform admin: all). Making one: platform admins only.
  g.get('/admin/companies', async (_req, res) => {
    const user = signedInUser(res);
    const mine = user.platformAdmin
      ? null
      : new Set((await platformDb.membership.findMany({ where: { userId: user.id, status: 'active' }, select: { tenantId: true } })).map((m) => m.tenantId));
    res.json((await listCompanies()).filter((c) => !mine || mine.has(c.id)));
  });

  g.post('/admin/companies', async (req, res) => {
    res.status(201).json(await createCompany(z.object({ name: z.string().max(200), slug: z.string().max(100) }).parse(req.body)));
  });

  g.get('/admin/roles', async (_req, res) => {
    res.json(await listRoles());
  });

  g.post('/admin/roles', async (req, res) => {
    const roleId = await createRole(z.object({ name: z.string().max(200), description: z.string().max(400) }).parse(req.body));
    res.status(201).json({ id: roleId });
  });

  g.put('/admin/roles/:id', async (req, res) => {
    await updateRole(z.string().max(60).parse(req.params.id), roleBody.parse(req.body));
    res.status(204).end();
  });

  // ------------------------------------------------------------ commercials (Orders page)

  g.get('/commercials/clients', async (_req, res) => {
    res.json(await listClients());
  });

  g.post('/commercials/clients', async (req, res) => {
    res.status(201).json(await createClient(clientBody.parse(req.body)));
  });

  g.put('/commercials/clients/:id', async (req, res) => {
    await updateClient(id.parse(req.params.id), clientBody.extend({ version: z.number().int() }).parse(req.body));
    res.status(204).end();
  });

  g.delete('/commercials/clients/:id', async (req, res) => {
    await deleteClient(id.parse(req.params.id));
    res.status(204).end();
  });

  g.get('/commercials/contracts', async (_req, res) => {
    res.json(await listContracts());
  });

  g.post('/commercials/contracts', async (req, res) => {
    res.status(201).json(await createContract(contractBody.parse(req.body)));
  });

  g.get('/commercials/contracts/:id', async (req, res) => {
    res.json(await getContract(id.parse(req.params.id)));
  });

  g.put('/commercials/contracts/:id', async (req, res) => {
    await updateContract(id.parse(req.params.id), contractBody.extend({ version: z.number().int() }).parse(req.body));
    res.status(204).end();
  });

  g.delete('/commercials/contracts/:id', async (req, res) => {
    await deleteContract(id.parse(req.params.id));
    res.status(204).end();
  });

  g.post('/commercials/contracts/:id/orders', async (req, res) => {
    res.status(201).json(await createContractOrders(id.parse(req.params.id), z.object({ channelIds: z.array(id).max(200), startDate: isoDate }).parse(req.body)));
  });

  g.delete('/commercials/orders/:id', async (req, res) => {
    await deleteCommercialOrder(id.parse(req.params.id));
    res.status(204).end();
  });

  g.get('/commercials/orders/:id', async (req, res) => {
    res.json(await getCommercialOrder(id.parse(req.params.id)));
  });

  g.put('/commercials/orders/:id', async (req, res) => {
    const body = z
      .object({
        version: z.number().int(),
        name: z.string().max(300),
        status: z.enum(['confirmed', 'draft']),
        startDate: isoDate,
        endDate: isoDate,
        items: z.array(z.object({ id: id.nullable(), productionId: id })).max(200),
      })
      .parse(req.body);
    res.json(await saveCommercialOrder(id.parse(req.params.id), body));
  });

  g.get('/commercials/orders/:id/week', async (req, res) => {
    res.json(await commercialWeek(id.parse(req.params.id), isoDate.parse(req.query.from)));
  });

  const booking = z.object({ date: isoDate, blockTypeId: id, breakTypeId: id, orderItemId: id, positionId: id.nullable(), passes: z.number().int().min(1).max(99) });
  g.put('/commercials/orders/:id/week', async (req, res) => {
    const body = z.object({ version: z.number().int(), from: isoDate, to: isoDate, bookings: z.array(booking).max(20000) }).parse(req.body);
    res.json(await saveCommercialWeek(id.parse(req.params.id), body));
  });

  g.post('/commercials/orders/:id/book', async (req, res) => {
    const body = z
      .object({
        version: z.number().int(),
        from: isoDate,
        to: isoDate,
        breakTypeIds: z.array(id).max(1000),
        weekdays: z.array(z.boolean()).length(7),
        itemIds: z.array(id).max(200),
        spread: z.enum(['rotate', 'same']),
        positionId: id.nullable(),
        passes: z.number().int().min(1).max(99),
        apply: z.boolean(),
      })
      .parse(req.body);
    res.json(await bookSpots(id.parse(req.params.id), body));
  });

  g.get('/admin/break-positions', async (_req, res) => {
    res.json(await listBreakPositions());
  });

  g.put('/admin/break-positions', async (req, res) => {
    res.json(await saveBreakPositions(breakPositionsBody.parse(req.body)));
  });

  g.get('/admin/users', async (_req, res) => {
    res.json(await listUsers());
  });

  g.post('/admin/users', async (req, res) => {
    const userId = await inviteUser(z.object({ name: z.string().max(200), email: z.string().max(320), roleId: id }).parse(req.body));
    res.status(201).json({ id: userId });
  });

  g.patch('/admin/users/:id', async (req, res) => {
    await changeMemberRole(id.parse(req.params.id), z.object({ roleId: id }).parse(req.body).roleId);
    res.status(204).end();
  });

  g.delete('/admin/users/:id', async (req, res) => {
    await removeMember(id.parse(req.params.id));
    res.status(204).end();
  });

  g.get('/admin/connections', async (_req, res) => {
    res.json(await listConnections());
  });

  g.post('/admin/connections', async (req, res) => {
    res.status(201).json({ id: await saveConnection(null, connectionBody.parse(req.body)) });
  });

  g.put('/admin/connections/:id', async (req, res) => {
    res.json({ id: await saveConnection(id.parse(req.params.id), connectionBody.parse(req.body)) });
  });

  g.delete('/admin/connections/:id', async (req, res) => {
    await deleteConnection(id.parse(req.params.id));
    res.status(204).end();
  });

  // Agents and the company's AI provider keys (decision 0024).
  agentRoutes(g);

  // What AI apps may do in this company, and its tokens (decision 0023, ai-access-page.md).
  g.get('/admin/ai-access', async (_req, res) => {
    res.json(await companyPolicy(res.locals.tenant.id));
  });

  g.put('/admin/ai-access', async (req, res) => {
    const body = z.object({ on: z.boolean(), table: z.record(z.string(), z.record(z.string(), z.enum(['on', 'ask', 'off']))), maxDays: z.number().int() }).parse(req.body);
    res.json(await savePolicy(res.locals.tenant.id, body));
  });

  g.get('/admin/ai-tokens', async (_req, res) => {
    res.json(await companyTokens(res.locals.tenant.id));
  });

  g.delete('/admin/ai-tokens/:id', async (req, res) => {
    await revokeInCompany(res.locals.tenant.id, id.parse(req.params.id));
    res.status(204).end();
  });

  // The audit log, newest first (decision 0023): `before` = the createdAt of the last event shown;
  // `person` = a person's id, `day` = YYYY-MM-DD (UTC).
  g.get('/admin/activity', async (req, res) => {
    const q = z
      .object({
        before: z.iso.datetime().optional(), limit: z.coerce.number().int().min(1).max(200).default(50), via: z.enum(['web', 'mcp']).optional(),
        person: id.optional(), day: isoDate.optional(),
      })
      .parse(req.query);
    const ends = [q.before ? new Date(q.before) : null, q.day ? fromIsoDate(addDays(q.day, 1)) : null].filter((d): d is Date => !!d);
    const created = { ...(q.day ? { gte: fromIsoDate(q.day) } : {}), ...(ends.length ? { lt: new Date(Math.min(...ends.map((d) => d.getTime()))) } : {}) };
    const rows = await db.auditEvent.findMany({
      where: { ...(Object.keys(created).length ? { createdAt: created } : {}), ...(q.via ? { via: q.via } : {}), ...(q.person ? { userId: q.person } : {}) },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit,
    });
    const tokenIds = [...new Set(rows.flatMap((e) => (e.tokenId ? [e.tokenId] : [])))];
    const tokens = new Map((await platformDb.accessToken.findMany({ where: { id: { in: tokenIds } }, select: { id: true, name: true } })).map((t) => [t.id, t.name]));
    res.json(
      rows.map((e) => ({
        id: e.id, at: e.createdAt.toISOString(), person: e.user ? { id: e.user.id, name: e.user.name, email: e.user.email } : null, via: e.via, tokenId: e.tokenId,
        tokenName: e.tokenId ? (tokens.get(e.tokenId) ?? null) : null, action: e.action, targetId: e.targetId, channelIds: e.channelIds, ok: e.ok,
        status: e.status, message: e.message, input: e.input, hasUndo: !!e.after,
      })),
    );
  });

  g.done();
  return r;
}
