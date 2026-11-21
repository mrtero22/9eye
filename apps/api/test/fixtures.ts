import { FRAME_RATES, minutesToFrames, uuidv7 } from '@9eye/core';
import { createHash } from 'node:crypto';
import { SESSION_COOKIE } from '../src/auth';
import { db, fromIsoDate, platformDb, withTenant } from '../src/db';

const R = FRAME_RATES['25'];
export const min = (m: number) => minutesToFrames(m, R);
export const ALL = [true, true, true, true, true, true, true];

export async function resetDb() {
  await platformDb.$executeRawUnsafe(
    'TRUNCATE agent_message, playlist_event, playlist_block, playlist, week, airing_item, airing, order_item, order_channel, "order", contract_channel, contract, client, rotation_list_item, rotation_list, catalog_relation, segment, segmentation, production, content, content_type, source, logo, logo_type, secondary_action, custom_field, graphic_template, graphic_object, graphic_source, time_window_range, time_window, product_code, linked_break, template_block, template, break_list, break_position, block_type, block_group, channel_playlist, role_grant, role_scope, membership, role, connection, app_user, channel, tenant CASCADE',
  );
}

/** Test requests are signed in as the platform admin "Local user" (decision 0021). */
const TEST_TOKEN = 'api-test-session';
export const auth = (slug: string) => ({ 'X-Tenant': slug, Cookie: `${SESSION_COOKIE}=${TEST_TOKEN}` });

async function ensureTestSession() {
  const user = await platformDb.user.upsert({
    where: { email: 'local.user@localhost' },
    update: {},
    create: { id: uuidv7(), email: 'local.user@localhost', name: 'Local user', platformAdmin: true },
  });
  const tokenHash = createHash('sha256').update(TEST_TOKEN).digest('hex');
  await platformDb.session.upsert({ where: { tokenHash }, update: {}, create: { id: uuidv7(), userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 86_400_000) } });
}

export interface Fixture {
  tenantId: string;
  slug: string;
  channelId: string;
  mainPlaylistId: string;
  adsPlaylistId: string | null;
  groupId: string;
  types: Record<string, string>;
  breaks: Record<string, string>;
  mainTemplateId: string;
  adsTemplateId: string | null;
}

/**
 * A company with one channel (25 fps, week from Saturday, day from 06:00). With ads: an ads template
 * with, per hour, Billboard 1 hh:00 (5 min) and Ad Pod hh:30 (18 min) at their running place (:00, :10).
 */
export async function makeCompany(slug: string, opts: { ads?: boolean } = {}): Promise<Fixture> {
  const withAds = opts.ads ?? true;
  await ensureTestSession();
  const tenant = await platformDb.tenant.create({ data: { id: uuidv7(), name: slug, slug } });
  return withTenant(tenant.id, async () => {
    const channel = await db.channel.create({
      data: { id: uuidv7(), name: `${slug.toUpperCase()} TV`, code: slug.toUpperCase(), frameRate: '25', dayStartFrames: min(360), weekStart: 6 } as never,
    });
    const main = await db.channelPlaylist.create({ data: { id: uuidv7(), channelId: channel.id, kind: 'main' } as never });
    const ads = withAds ? await db.channelPlaylist.create({ data: { id: uuidv7(), channelId: channel.id, kind: 'ads' } as never }) : null;
    const group = await db.blockGroup.create({ data: { id: uuidv7(), name: 'Series', color: '#d0021b' } as never });
    const breakGroup = await db.blockGroup.create({ data: { id: uuidv7(), name: 'Breaks', color: '#4a90e2' } as never });
    const mkType = async (playlistId: string, groupId: string, name: string, minutes: number, validWeekdays = ALL) => {
      const t = await db.blockType.create({
        data: {
          id: uuidv7(), playlistId, groupId, name, color: '#d0021b', textColor: '#ffffff', lengthFrames: min(minutes),
          validFrom: fromIsoDate('2024-01-06'), validTo: fromIsoDate('2099-12-25'), validWeekdays,
        } as never,
      });
      return t.id;
    };
    const types: Record<string, string> = {
      run1: await mkType(main.id, group.id, 'Run Block 1', 60),
      run2: await mkType(main.id, group.id, 'Run Block 2', 60),
      half: await mkType(main.id, group.id, 'Half Block', 30),
      fri: await mkType(main.id, group.id, 'Friday Only', 60, [false, false, false, false, false, true, false]),
    };
    const breaks: Record<string, string> = {};
    let adsTemplateId: string | null = null;
    if (ads) {
      for (let h = 0; h < 24; h++) {
        const hh = String((6 + h) % 24).padStart(2, '0');
        breaks[`Billboard 1 ${hh}`] = await mkType(ads.id, breakGroup.id, `Billboard 1 ${hh}:00`, 5);
        breaks[`AB ${hh}`] = await mkType(ads.id, breakGroup.id, `Ad Pod ${hh}:30`, 18);
      }
      adsTemplateId = uuidv7();
      await db.template.create({
        data: { id: adsTemplateId, playlistId: ads.id, name: 'ADS', validFrom: fromIsoDate('2024-01-06'), validTo: fromIsoDate('2099-12-25'), activeWeekdays: ALL } as never,
      });
      const rows = [];
      for (let d = 0; d < 7; d++) {
        for (let h = 0; h < 24; h++) {
          const hh = String((6 + h) % 24).padStart(2, '0');
          rows.push({ id: uuidv7(), templateId: adsTemplateId, weekday: d, blockTypeId: breaks[`Billboard 1 ${hh}`], startFrames: min(h * 60), lengthFrames: min(5), fillGaps: false, opensWithBreak: false });
          rows.push({ id: uuidv7(), templateId: adsTemplateId, weekday: d, blockTypeId: breaks[`AB ${hh}`], startFrames: min(h * 60 + 10), lengthFrames: min(18), fillGaps: false, opensWithBreak: false });
        }
      }
      await platformDb.templateBlock.createMany({ data: rows });
    }
    const mainTemplateId = uuidv7();
    await db.template.create({
      data: { id: mainTemplateId, playlistId: main.id, name: 'MAIN', validFrom: fromIsoDate('2024-03-23'), validTo: fromIsoDate('2099-05-29'), activeWeekdays: ALL } as never,
    });
    return { tenantId: tenant.id, slug, channelId: channel.id, mainPlaylistId: main.id, adsPlaylistId: ads?.id ?? null, groupId: group.id, types, breaks, mainTemplateId, adsTemplateId };
  });
}

export function block(weekday: number, typeId: string, startMin: number, lengthMin = 60, breaks: string[] = []) {
  return {
    id: uuidv7(),
    weekday,
    blockTypeId: typeId,
    startFrames: min(startMin),
    lengthFrames: min(lengthMin),
    fillGaps: true,
    opensWithBreak: true,
    note: '',
    rotationListId: null,
    limitsPerContentType: [],
    breaks,
  };
}

/** A second channel of the company with no templates and no block types. */
export async function makeEmptyChannel(f: Fixture, name: string, opts: { ads?: boolean } = {}) {
  return withTenant(f.tenantId, async () => {
    const id = uuidv7();
    await db.channel.create({ data: { id, name, code: name.replace(/\W/g, '').toUpperCase(), frameRate: '25', dayStartFrames: min(360), weekStart: 6 } as never });
    await db.channelPlaylist.create({ data: { id: uuidv7(), channelId: id, kind: 'main' } as never });
    if (opts.ads) await db.channelPlaylist.create({ data: { id: uuidv7(), channelId: id, kind: 'ads' } as never });
    return id;
  });
}

export interface CatalogFixture {
  seriesType: string;
  identType: string;
  harbor: string;
  bright: string;
  idents: string;
  /** Harbor Nights episodes 1–6 (episode 3 has no length); [0] is episode 1. */
  harborEps: string[];
  brightEps: string[];
  identItems: string[];
  harborTemplate: string;
}

/** A small catalog: two series (with a template production) and an ident set. */
export async function makeCatalog(f: Fixture): Promise<CatalogFixture> {
  return withTenant(f.tenantId, async () => {
    const type = async (name: string, family: string) => (await db.contentType.create({ data: { id: uuidv7(), name, family, color: null } as never })).id;
    const content = async (contentTypeId: string, title: string) => (await db.content.create({ data: { id: uuidv7(), contentTypeId, title, code: title.slice(0, 4).toUpperCase() } as never })).id;
    const prod = async (contentId: string, title: string, chapter: number | null, lengthMin: number | null, isTemplate = false) =>
      (await db.production.create({ data: { id: uuidv7(), contentId, title, code: `${title.slice(0, 3).toUpperCase()}-${chapter ?? 0}`, chapter, isTemplate, lengthFrames: lengthMin === null ? null : min(lengthMin), mediaStatus: 'ready' } as never })).id;
    const seriesType = await type('TV Series Drama', 'program');
    const identType = await type('Idents', 'filling');
    const harbor = await content(seriesType, 'Harbor Nights');
    const bright = await content(seriesType, 'Bright Lanes');
    const idents = await content(identType, 'Lumen Plus');
    const harborTemplate = await prod(harbor, '[TEMPLATE]-Harbor Nights', 0, null, true);
    const harborEps: string[] = [];
    for (let i = 1; i <= 6; i++) harborEps.push(await prod(harbor, `Harbor Nights - ${i}`, i, i === 3 ? null : 45));
    const brightEps: string[] = [];
    for (let i = 1; i <= 3; i++) brightEps.push(await prod(bright, `Bright Lanes - ${i}`, i, 40));
    const identItems: string[] = [];
    for (let i = 1; i <= 3; i++) identItems.push(await prod(idents, `LumenPlus_Ident_${i}`, null, 0.25));
    return { seriesType, identType, harbor, bright, idents, harborEps, brightEps, identItems, harborTemplate };
  });
}

/** Main-template blocks on every weekday: Run Block 1 06:00–07:00, Run Block 2 07:00–08:00, Half Block 08:00–08:30. */
export async function fillMainTemplate(f: Fixture) {
  const rows = [];
  for (let d = 0; d < 7; d++) {
    rows.push({ id: uuidv7(), templateId: f.mainTemplateId, weekday: d, blockTypeId: f.types.run1, startFrames: 0, lengthFrames: min(60), fillGaps: true, opensWithBreak: false });
    rows.push({ id: uuidv7(), templateId: f.mainTemplateId, weekday: d, blockTypeId: f.types.run2, startFrames: min(60), lengthFrames: min(60), fillGaps: true, opensWithBreak: false });
    rows.push({ id: uuidv7(), templateId: f.mainTemplateId, weekday: d, blockTypeId: f.types.half, startFrames: min(120), lengthFrames: min(30), fillGaps: true, opensWithBreak: false });
  }
  await platformDb.templateBlock.createMany({ data: rows });
}

export interface CatalogExtras {
  server: string;
  live: string;
  ageLogo: string;
  seriesLogo: string;
  action: string;
  /** Harbor Nights 1: one segmentation with 3 segments. */
  harborSegm: string;
  harborSegs: string[];
  list: string;
  listItems: string[];
  graphicSource: string;
  graphicTemplate: string;
  kids: string;
  prime: string;
}

/** The rest of a catalog (data model §4b): sources, logos, custom fields, a segmentation, a rotation list, graphics, time windows. */
export async function makeCatalogExtras(f: Fixture, cat: CatalogFixture): Promise<CatalogExtras> {
  return withTenant(f.tenantId, async () => {
    const server = (await db.source.create({ data: { id: uuidv7(), name: 'SERVER', code: 'SVR', mediaIdGeneration: 'custom', customPattern: 'TV S-%A - %P' } as never })).id;
    const live = (await db.source.create({ data: { id: uuidv7(), name: 'LIVE', code: 'LIV', isLive: true } as never })).id;
    const ageType = (await db.logoType.create({ data: { id: uuidv7(), name: 'Age logo', number: 1 } as never })).id;
    const logo1Type = (await db.logoType.create({ data: { id: uuidv7(), name: 'Logo 1', number: 3 } as never })).id;
    const ageLogo = (await db.logo.create({ data: { id: uuidv7(), logoTypeId: ageType, name: '12', code: '12' } as never })).id;
    const seriesLogo = (await db.logo.create({ data: { id: uuidv7(), logoTypeId: logo1Type, name: 'SERIES', code: 'SERIES' } as never })).id;
    const action = (await db.secondaryAction.create({ data: { id: uuidv7(), name: 'Test', code: 'T' } as never })).id;
    await db.customField.create({ data: { id: uuidv7(), entity: 'production', key: 'STAR', label: 'STAR', position: 0 } as never });
    await db.customField.create({ data: { id: uuidv7(), entity: 'production', key: 'GRAPHICS', label: 'GRAPHICS', position: 1 } as never });
    await db.production.update({ where: { id: cat.harborEps[0] }, data: { sourceId: server, customValues: { STAR: 'WAGNER MOURA' } } });
    const harborSegm = (await db.segmentation.create({ data: { id: uuidv7(), productionId: cat.harborEps[0], code: 1, name: 'HAR-1-1' } as never })).id;
    const harborSegs: string[] = [];
    for (let i = 0; i < 3; i++) {
      const s = uuidv7();
      await platformDb.segment.create({ data: { id: s, segmentationId: harborSegm, code: i + 1, sourceId: server, mediaId: 'HAR-1', tcInFrames: min(15 * i), tcOutFrames: min(15 * (i + 1)), lengthFrames: min(15) } });
      harborSegs.push(s);
    }
    const list = (await db.rotationList.create({ data: { id: uuidv7(), name: 'Lumen Fillers', lastItemPosition: 2, randomInsert: true } as never })).id;
    const listItems: string[] = [];
    for (const [i, p] of cat.identItems.entries()) {
      const it = uuidv7();
      await platformDb.rotationListItem.create({ data: { id: it, listId: list, productionId: p, name: `LumenPlus_Ident_${i + 1}`, position: i + 1 } });
      listItems.push(it);
    }
    const graphicSource = (await db.graphicSource.create({ data: { id: uuidv7(), name: 'PRISM SD', code: '2', channelId: f.channelId } as never })).id;
    const graphicTemplate = (await db.graphicTemplate.create({
      data: { id: uuidv7(), sourceId: graphicSource, name: '10 SEC BEFORE THE END', startType: 'to-end', startOffsetFrames: 1000, endType: 'duration', endDurationFrames: 750 } as never,
    })).id;
    const kids = (await db.timeWindow.create({ data: { id: uuidv7(), name: 'Kids', color: '#f8e71c', lengthFrames: min(300) } as never })).id;
    const prime = (await db.timeWindow.create({ data: { id: uuidv7(), name: 'Family Prime Time', color: '#7ed321', lengthFrames: min(180) } as never })).id;
    return { server, live, ageLogo, seriesLogo, action, harborSegm, harborSegs, list, listItems, graphicSource, graphicTemplate, kids, prime };
  });
}

/** An order of the company with the given productions as items (to make them "used"). */
export async function makeOrderUsing(f: Fixture, productionIds: string[]) {
  return withTenant(f.tenantId, async () => {
    const orderId = uuidv7();
    await db.order.create({ data: { id: orderId, name: 'Harbor - Lumen Plus', mode: 'series', status: 'confirmed', startDate: fromIsoDate('2026-10-17'), endDate: fromIsoDate('2026-12-31'), color: '#0284c7' } as never });
    await platformDb.orderItem.createMany({ data: productionIds.map((productionId, position) => ({ id: uuidv7(), orderId, position, productionId })) });
    return orderId;
  });
}
