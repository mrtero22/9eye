// A throw-away company for the browser tests, written straight into the development database and
// removed afterwards. Channels: E2E TV (main + ads, 25 fps, week from Saturday), E2E PUBLIC (main
// only, week from Monday), E2E DF (29.97 drop-frame, week from Sunday), E2E EMPTY (nothing in it),
// E2E SCHED (day from 09:00, week from Saturday, one-hour blocks and three orders: Scheduling).

import {
  FRAME_RATES,
  addDays,
  broadcastToday,
  copyWeek,
  framesPerDay,
  minutesToFrames,
  uuidv7,
  weekStartOn,
  type AiringDraft,
  type FrameRateCode,
  type OrderDraft,
  type TemplateDay,
} from '@9eye/core';
import { PrismaClient } from '@prisma/client';
import type { Page } from '@playwright/test';
import { createHash, randomBytes, scryptSync } from 'node:crypto';

export const SLUG = 'e2e-test';
const ALL = [true, true, true, true, true, true, true];
const day = (s: string) => new Date(`${s}T00:00:00Z`);

let db: PrismaClient | null = null;
function client() {
  if (!db) {
    process.loadEnvFile(new URL('../../../.env', import.meta.url).pathname);
    db = new PrismaClient();
  }
  return db;
}

export async function removeCompany() {
  const p = client();
  // the test people (sign-in) and the ones the tests invite
  await p.$executeRaw`DELETE FROM app_user WHERE email LIKE '%@e2e.example'`;
  const t = await p.tenant.findUnique({ where: { slug: SLUG } });
  if (!t) return;
  await p.$transaction([
    // a week takes its day playlists, their blocks and rows with it
    p.$executeRaw`DELETE FROM week WHERE tenant_id = ${t.id}::uuid`,
    // agents (decision 0024): before the roles they act with; runs, changes and memory go with the agent
    p.$executeRaw`DELETE FROM agent_message WHERE tenant_id = ${t.id}::uuid`,
    p.$executeRaw`DELETE FROM agent_change WHERE tenant_id = ${t.id}::uuid`,
    p.$executeRaw`DELETE FROM agent WHERE tenant_id = ${t.id}::uuid`,
    p.$executeRaw`DELETE FROM agent_room WHERE tenant_id = ${t.id}::uuid`,
    p.$executeRaw`DELETE FROM ai_provider WHERE tenant_id = ${t.id}::uuid`,
    p.$executeRaw`DELETE FROM airing_item WHERE airing_id IN (SELECT id FROM airing WHERE tenant_id = ${t.id}::uuid)`,
    p.$executeRaw`UPDATE airing SET repeat_of_id = NULL WHERE tenant_id = ${t.id}::uuid`,
    p.$executeRaw`DELETE FROM airing WHERE tenant_id = ${t.id}::uuid`,
    p.$executeRaw`DELETE FROM order_item WHERE order_id IN (SELECT id FROM "order" WHERE tenant_id = ${t.id}::uuid)`,
    p.$executeRaw`DELETE FROM order_channel WHERE order_id IN (SELECT id FROM "order" WHERE tenant_id = ${t.id}::uuid)`,
    p.$executeRaw`DELETE FROM "order" WHERE tenant_id = ${t.id}::uuid`,
    p.$executeRaw`DELETE FROM contract WHERE tenant_id = ${t.id}::uuid`,
    p.$executeRaw`DELETE FROM client WHERE tenant_id = ${t.id}::uuid`,
    p.$executeRaw`DELETE FROM rotation_list_item WHERE list_id IN (SELECT id FROM rotation_list WHERE tenant_id = ${t.id}::uuid)`,
    p.$executeRaw`DELETE FROM rotation_list WHERE tenant_id = ${t.id}::uuid`,
    p.$executeRaw`DELETE FROM catalog_relation WHERE tenant_id = ${t.id}::uuid`,
    p.$executeRaw`DELETE FROM segment WHERE segmentation_id IN (SELECT id FROM segmentation WHERE tenant_id = ${t.id}::uuid)`,
    p.$executeRaw`DELETE FROM segmentation WHERE tenant_id = ${t.id}::uuid`,
    p.$executeRaw`DELETE FROM production WHERE tenant_id = ${t.id}::uuid`,
    p.$executeRaw`DELETE FROM content WHERE tenant_id = ${t.id}::uuid`,
    p.$executeRaw`DELETE FROM content_type WHERE tenant_id = ${t.id}::uuid`,
    p.$executeRaw`DELETE FROM source WHERE tenant_id = ${t.id}::uuid`,
    p.$executeRaw`DELETE FROM logo WHERE tenant_id = ${t.id}::uuid`,
    p.$executeRaw`DELETE FROM logo_type WHERE tenant_id = ${t.id}::uuid`,
    p.$executeRaw`DELETE FROM secondary_action WHERE tenant_id = ${t.id}::uuid`,
    p.$executeRaw`DELETE FROM custom_field WHERE tenant_id = ${t.id}::uuid`,
    p.$executeRaw`DELETE FROM graphic_template WHERE tenant_id = ${t.id}::uuid`,
    p.$executeRaw`DELETE FROM graphic_object WHERE tenant_id = ${t.id}::uuid`,
    p.$executeRaw`DELETE FROM graphic_source WHERE tenant_id = ${t.id}::uuid`,
    p.$executeRaw`DELETE FROM time_window_range WHERE time_window_id IN (SELECT id FROM time_window WHERE tenant_id = ${t.id}::uuid)`,
    p.$executeRaw`DELETE FROM time_window WHERE tenant_id = ${t.id}::uuid`,
    p.$executeRaw`DELETE FROM product_code WHERE tenant_id = ${t.id}::uuid`,
    p.$executeRaw`DELETE FROM linked_break WHERE block_id IN (SELECT b.id FROM template_block b JOIN template t ON t.id = b.template_id WHERE t.tenant_id = ${t.id}::uuid)`,
    p.$executeRaw`DELETE FROM template_block WHERE template_id IN (SELECT id FROM template WHERE tenant_id = ${t.id}::uuid)`,
    p.$executeRaw`DELETE FROM template WHERE tenant_id = ${t.id}::uuid`,
    p.$executeRaw`DELETE FROM break_list WHERE tenant_id = ${t.id}::uuid`,
    p.$executeRaw`DELETE FROM break_position WHERE tenant_id = ${t.id}::uuid`,
    p.$executeRaw`DELETE FROM block_type WHERE tenant_id = ${t.id}::uuid`,
    p.$executeRaw`DELETE FROM block_group WHERE tenant_id = ${t.id}::uuid`,
    p.$executeRaw`DELETE FROM membership WHERE tenant_id = ${t.id}::uuid`,
    p.$executeRaw`DELETE FROM role WHERE tenant_id = ${t.id}::uuid`,
    p.$executeRaw`DELETE FROM connection WHERE tenant_id = ${t.id}::uuid`,
    p.$executeRaw`DELETE FROM channel_playlist WHERE tenant_id = ${t.id}::uuid`,
    p.$executeRaw`DELETE FROM channel WHERE tenant_id = ${t.id}::uuid`,
    p.$executeRaw`DELETE FROM tenant WHERE id = ${t.id}::uuid`,
  ]);
}

// ---------------------------------------------------------------- sign-in (decision 0021)

export const TESTER = { email: 'e2e.tester@e2e.example', name: 'E2E tester' };
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** A platform admin who signs in with a password (removed with the company). */
export async function makePerson(email: string, name: string, password: string) {
  const salt = randomBytes(16);
  const key = scryptSync(password.normalize('NFKC'), salt, 64, { N: 16384, r: 8, p: 1 });
  await client().user.create({
    data: { id: uuidv7(), email, name, platformAdmin: true, passwordHash: `scrypt$16384$8$1$${salt.toString('base64')}$${key.toString('base64')}` },
  });
}

/** Signs the browser in as the platform admin "E2E tester": a two-hour session written into the database. */
export async function signIn(page: Page) {
  const p = client();
  const user = await p.user.upsert({ where: { email: TESTER.email }, update: {}, create: { id: uuidv7(), ...TESTER, platformAdmin: true } });
  const token = randomBytes(32).toString('base64url');
  await p.session.create({ data: { id: uuidv7(), userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 2 * 3_600_000) } });
  await page.context().addCookies([{ name: 'nineeye_session', value: token, url: 'http://127.0.0.1:4101' }]);
}

/** Ends every session of the test people, as if they ran out. */
export async function endSessions() {
  await client().$executeRaw`DELETE FROM session WHERE user_id IN (SELECT id FROM app_user WHERE email LIKE '%@e2e.example')`;
}

/**
 * Fills E2E TV's main playlist of one Saturday as the editor will (rows written straight into the
 * database): block 1 (06:00, breaks Billboard 1 and Ad Pod) gets a programme in two parts around the Ad Pod
 * break with two spots under it and a note, and runs over; block 2 (07:00) gets half an hour.
 */
export async function fillDay(date: string) {
  const p = client();
  const t = await p.tenant.findUniqueOrThrow({ where: { slug: SLUG } });
  const tenantId = t.id;
  const channel = await p.channel.findFirstOrThrow({ where: { tenantId, name: 'E2E TV' }, include: { playlists: true } });
  const main = channel.playlists.find((x) => x.kind === 'main')!;
  const dayRow = await p.dayPlaylist.findFirstOrThrow({
    where: { playlistId: main.id, date: day(date) },
    include: { blocks: { orderBy: { startFrames: 'asc' }, include: { events: { orderBy: { sequence: 'asc' } } } } },
  });
  const r = FRAME_RATES['25'];
  const min = (m: number) => minutesToFrames(m, r);
  const typeId = uuidv7();
  const contentId = uuidv7();
  const ep = [uuidv7(), uuidv7(), uuidv7()];
  await p.contentType.create({ data: { id: typeId, tenantId, name: 'Fitness shows', family: 'program', color: '#64748b' } });
  await p.content.create({ data: { id: contentId, tenantId, contentTypeId: typeId, title: 'Strong Fit', code: 'SF' } });
  await p.production.createMany({
    data: [
      { id: ep[0], tenantId, contentId, title: 'Strong Fit - 255', code: 'SF-255', chapter: 255, lengthFrames: min(65), mediaStatus: 'ready', additionalData: 'M:\\FTP\\Strong Fit\\SF-255.mp4', notes: 'Program' },
      { id: ep[1], tenantId, contentId, title: 'Strong Fit - 256', code: 'SF-256', chapter: 256, lengthFrames: min(30), mediaStatus: 'not-ready' },
    ],
  });
  const [b1, b2] = dayRow.blocks;
  const [, adBox, gap1] = b1.events;
  await p.playlistEvent.update({ where: { id: gap1.id }, data: { sequence: 20 } });
  await p.playlistEvent.update({ where: { id: adBox.id }, data: { sequence: 3 } });
  await p.playlistEvent.update({ where: { id: b2.events[0].id }, data: { sequence: 20 } });
  await p.playlistEvent.createMany({
    data: [
      { id: uuidv7(), blockId: b1.id, sequence: 1, kind: 'program', title: 'Strong Fit - 255', lengthFrames: min(20), productionId: ep[0], tcOutFrames: min(20) },
      { id: uuidv7(), blockId: b1.id, sequence: 2, kind: 'note', title: 'Check the subtitles' },
      { id: uuidv7(), blockId: b1.id, sequence: 4, kind: 'ident', title: 'Ident_E2E_27_May', lengthFrames: 15 * 25, relatedEventId: adBox.id },
      { id: uuidv7(), blockId: b1.id, sequence: 5, kind: 'commercial', title: 'Instagram_Social', lengthFrames: 7 * 25, relatedEventId: adBox.id },
      { id: uuidv7(), blockId: b1.id, sequence: 6, kind: 'program', title: 'Strong Fit - 255', lengthFrames: min(45), productionId: ep[0], tcInFrames: min(20), tcOutFrames: min(65) },
      { id: uuidv7(), blockId: b2.id, sequence: 0, kind: 'program', title: 'Strong Fit - 256', lengthFrames: min(30), productionId: ep[1], tcOutFrames: min(30) },
    ],
  });
}

/**
 * What E2E TV's Saturday is filled from (part 3), written straight into the database once its week
 * exists: Lumen Story 1 (three 15-minute segments) placed by a confirmed series order in Run Block 1
 * with its repeat in Run Block 2, a draft order in Run Block 2; spots in the ads playlist's Billboard 1 06:00
 * (two) and Ad Pod 06:30 (one); the rotation list "E2E Fillers" (2:00, 1:00, 0:30), the channel's
 * default list.
 */
export async function prepareFill(date: string) {
  const p = client();
  const t = await p.tenant.findUniqueOrThrow({ where: { slug: SLUG } });
  const tenantId = t.id;
  const channel = await p.channel.findFirstOrThrow({ where: { tenantId, name: 'E2E TV' }, include: { playlists: true } });
  const ads = channel.playlists.find((x) => x.kind === 'ads')!;
  const template = await p.template.findFirstOrThrow({ where: { tenantId, name: 'E2E MAIN' } });
  const type = async (name: string) => (await p.blockType.findFirstOrThrow({ where: { tenantId, name } })).id;
  const R = FRAME_RATES['25'];
  const sec = (s: number) => s * 25;
  const ct = async (name: string, family: string) => {
    const id = uuidv7();
    await p.contentType.create({ data: { id, tenantId, name, family } });
    return id;
  };
  const content = async (contentTypeId: string, title: string) => {
    const id = uuidv7();
    await p.content.create({ data: { id, tenantId, contentTypeId, title, code: title.slice(0, 4).toUpperCase() } });
    return id;
  };
  const prod = async (contentId: string, title: string, frames: number, chapter: number | null = null) => {
    const id = uuidv7();
    await p.production.create({ data: { id, tenantId, contentId, title, code: title.slice(0, 6).toUpperCase(), chapter, lengthFrames: frames } });
    return id;
  };
  const drama = await content(await ct('Drama series', 'program'), 'Lumen Story');
  const ep1 = await prod(drama, 'Lumen Story - 1', minutesToFrames(45, R), 1);
  const ep2 = await prod(drama, 'Lumen Story - 2', minutesToFrames(45, R), 2);
  const segm = uuidv7();
  await p.segmentation.create({ data: { id: segm, tenantId, productionId: ep1, code: 1, name: 'RS-1' } });
  await p.segment.createMany({ data: [0, 1, 2].map((i) => ({ id: uuidv7(), segmentationId: segm, code: i + 1, tcInFrames: minutesToFrames(15 * i, R), tcOutFrames: minutesToFrames(15 * (i + 1), R), lengthFrames: minutesToFrames(15, R) })) });
  const spots = await content(await ct('Spots', 'advert'), 'E2E Spots');
  const alpha = await prod(spots, 'Spot_Alpha', sec(30));
  const beta = await prod(spots, 'Spot_Beta', sec(20));
  const fill = await content(await ct('Fillers', 'filling'), 'E2E Fillers');
  const fillers = [await prod(fill, 'Filler_A', sec(120)), await prod(fill, 'Filler_B', sec(60)), await prod(fill, 'Filler_C', sec(30))];
  const list = uuidv7();
  await p.rotationList.create({ data: { id: list, tenantId, name: 'E2E Fillers' } });
  await p.rotationListItem.createMany({ data: fillers.map((productionId, i) => ({ id: uuidv7(), listId: list, productionId, name: `Filler_${'ABC'[i]}`, position: i + 1 })) });
  await p.channel.update({ where: { id: channel.id }, data: { defaultRotationListName: 'E2E Fillers' } });

  const order = async (name: string, status: string, productions: string[]) => {
    const id = uuidv7();
    await p.order.create({ data: { id, tenantId, name, mode: 'series', status, startDate: day('2030-05-01'), endDate: day('2030-07-31'), color: '#0284c7' } });
    await p.orderChannel.create({ data: { id: uuidv7(), orderId: id, channelId: channel.id, templateId: template.id, position: 0 } });
    const items = productions.map((productionId, position) => ({ id: uuidv7(), orderId: id, position, productionId }));
    await p.orderItem.createMany({ data: items });
    const air = async (blockType: string, itemId: string | null, repeatOfId: string | null = null) => {
      const airingId = uuidv7();
      await p.airing.create({ data: { id: airingId, tenantId, orderId: id, channelId: channel.id, date: day(date), blockTypeId: await type(blockType), passes: repeatOfId ? 0 : 1, repeatOfId } });
      if (itemId) await p.airingItem.create({ data: { id: uuidv7(), airingId, position: 0, orderItemId: itemId } });
      return airingId;
    };
    return { items: items.map((i) => i.id), air };
  };
  const story = await order('Lumen Story - E2E', 'confirmed', [ep1, ep2]);
  const first = await story.air('Run Block 1', story.items[0]);
  await story.air('Run Block 2', null, first);
  const draft = await order('Draft plan - E2E', 'draft', [ep2]);
  await draft.air('Run Block 2', draft.items[0]);

  const adsDay = await p.dayPlaylist.findFirstOrThrow({ where: { playlistId: ads.id, date: day(date) }, include: { blocks: true } });
  const sp1Type = await type('Billboard 1 06:00');
  const abType = await type('Ad Pod 06:30');
  const spBlock = adsDay.blocks.find((b) => b.blockTypeId === sp1Type)!;
  const abBlock = adsDay.blocks.find((b) => b.blockTypeId === abType)!;
  const spot = (blockId: string, sequence: number, title: string, productionId: string, seconds: number) => ({ id: uuidv7(), blockId, sequence, kind: 'commercial', title, productionId, lengthFrames: sec(seconds), tcOutFrames: sec(seconds) });
  await p.playlistEvent.createMany({ data: [spot(spBlock.id, 0, 'Spot_Alpha', alpha, 30), spot(spBlock.id, 1, 'Spot_Beta', beta, 20), spot(abBlock.id, 0, 'Spot_Beta', beta, 20)] });
}

/** Marks the test company's day playlists of one date as published. */
export async function publishDay(date: string) {
  const p = client();
  const t = await p.tenant.findUniqueOrThrow({ where: { slug: SLUG } });
  await p.dayPlaylist.updateMany({ where: { tenantId: t.id, date: day(date) }, data: { published: true } });
}

export async function disconnect() {
  await db?.$disconnect();
  db = null;
}

export async function makeCompany() {
  await removeCompany();
  const p = client();
  const tenantId = uuidv7();
  await p.tenant.create({ data: { id: tenantId, name: 'E2E Test Company', slug: SLUG } });
  const series = uuidv7();
  const breaksGroup = uuidv7();
  await p.blockGroup.createMany({
    data: [
      { id: series, tenantId, name: 'Series', color: '#d0021b' },
      { id: breaksGroup, tenantId, name: 'Breaks', color: '#4a90e2' },
    ],
  });

  async function channel(name: string, code: string, rate: FrameRateCode, weekStart: number, withAds: boolean) {
    const r = FRAME_RATES[rate];
    const id = uuidv7();
    await p.channel.create({ data: { id, tenantId, name, code, frameRate: rate, dayStartFrames: minutesToFrames(360, r), weekStart } });
    const main = uuidv7();
    await p.channelPlaylist.create({ data: { id: main, tenantId, channelId: id, kind: 'main' } });
    const ads = withAds ? uuidv7() : null;
    if (ads) await p.channelPlaylist.create({ data: { id: ads, tenantId, channelId: id, kind: 'ads' } });
    return { id, main, ads, r };
  }
  async function type(playlistId: string, groupId: string, name: string, minutes: number, rate: FrameRateCode) {
    const id = uuidv7();
    await p.blockType.create({
      data: {
        id, tenantId, playlistId, groupId, name, color: groupId === series ? '#d0021b' : '#4a90e2', textColor: '#ffffff',
        lengthFrames: minutesToFrames(minutes, FRAME_RATES[rate]), validFrom: day('2024-01-01'), validTo: day('2099-12-31'), validWeekdays: ALL,
        fillGaps: groupId === series, opensWithBreak: false,
      },
    });
    return id;
  }
  async function template(playlistId: string, name: string, from: string, to: string, blocks: { weekday: number; type: string; startMin: number; minutes: number; breaks?: string[] }[], rate: FrameRateCode) {
    const r = FRAME_RATES[rate];
    const id = uuidv7();
    await p.template.create({ data: { id, tenantId, playlistId, name, validFrom: day(from), validTo: day(to), activeWeekdays: ALL } });
    const rows = blocks.map((b) => ({ ...b, id: uuidv7() }));
    await p.templateBlock.createMany({
      data: rows.map((b) => ({ id: b.id, templateId: id, weekday: b.weekday, blockTypeId: b.type, startFrames: minutesToFrames(b.startMin, r), lengthFrames: minutesToFrames(b.minutes, r), fillGaps: true, opensWithBreak: false })),
    });
    const links = rows.flatMap((b) => (b.breaks ?? []).map((breakTypeId, position) => ({ id: uuidv7(), blockId: b.id, position, breakTypeId })));
    if (links.length) await p.linkedBreak.createMany({ data: links });
    return id;
  }

  // E2E TV: main + ads, week from Saturday
  const tv = await channel('E2E TV', 'E2ETV', '25', 6, true);
  await p.channel.updateMany({ where: { tenantId, name: 'E2E TV' }, data: { allowedExports: ['playout-xml'], defaultExport: 'playout-xml' } });
  const run = [];
  for (let i = 1; i <= 4; i++) run.push(await type(tv.main, series, `Run Block ${i}`, 60, '25'));
  await type(tv.main, series, 'Half Block', 30, '25');
  const sp1: string[] = [];
  const ab: string[] = [];
  for (let h = 0; h < 24; h++) {
    const hh = String((6 + h) % 24).padStart(2, '0');
    sp1.push(await type(tv.ads!, breaksGroup, `Billboard 1 ${hh}:00`, 5, '25'));
    ab.push(await type(tv.ads!, breaksGroup, `Ad Pod ${hh}:30`, 18, '25'));
  }
  const adsBlocks = [];
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      if (d === 0 && h === 1) continue; // Sunday has no breaks in the 07:00 hour
      adsBlocks.push({ weekday: d, type: sp1[h], startMin: h * 60, minutes: 5 }, { weekday: d, type: ab[h], startMin: h * 60 + 10, minutes: 18 });
    }
  }
  await template(tv.ads!, 'E2E ADS', '2024-01-06', '2099-12-25', adsBlocks, '25');
  await template(
    tv.main,
    'E2E MAIN',
    '2024-03-23',
    '2099-05-29',
    [
      { weekday: 6, type: run[0], startMin: 0, minutes: 60, breaks: [sp1[0], ab[0]] },
      { weekday: 6, type: run[1], startMin: 60, minutes: 60 },
      { weekday: 0, type: run[0], startMin: 0, minutes: 60 },
      { weekday: 0, type: run[1], startMin: 60, minutes: 60 },
    ],
    '25',
  );

  await p.breakList.create({ data: { id: uuidv7(), tenantId, channelId: tv.id, name: 'First two', positions: [0, 1] } });

  // E2E PUBLIC: main only, week from Monday
  const pub = await channel('E2E PUBLIC', 'E2EPUB', '25', 1, false);
  const news = await type(pub.main, series, 'News Hour', 60, '25');
  await template(pub.main, 'Public Autumn', '2026-09-07', '2027-01-03', [{ weekday: 1, type: news, startMin: 0, minutes: 60 }], '25');

  // E2E DF: 29.97 drop-frame, week from Sunday
  const df = await channel('E2E DF', 'E2EDF', '29.97df', 0, false);
  const morning = await type(df.main, series, 'Morning Show', 60, '29.97df');
  await template(df.main, 'DF Fall', '2026-09-06', '2027-01-02', [{ weekday: 1, type: morning, startMin: 0, minutes: 60 }], '29.97df');

  // E2E REPEAT: an ads template with one hand-built hour on Saturday 06:00 (sp 5 and sp 6 unused)
  const rep = await channel('E2E REPEAT', 'E2EREP', '25', 6, true);
  const sp: string[] = [];
  for (let i = 1; i <= 6; i++) sp.push(await type(rep.ads!, breaksGroup, `sp ${i}`, 5, '25'));
  const box = [await type(rep.ads!, breaksGroup, 'drama addbox 1', 18, '25'), await type(rep.ads!, breaksGroup, 'drama addbox 2', 18, '25')];
  await template(
    rep.ads!,
    'REPEAT ADS',
    '2026-10-17',
    '2027-10-15',
    [
      { weekday: 6, type: sp[0], startMin: 0, minutes: 5 },
      { weekday: 6, type: sp[1], startMin: 5, minutes: 5 },
      { weekday: 6, type: box[0], startMin: 10, minutes: 18 },
      { weekday: 6, type: sp[2], startMin: 30, minutes: 5 },
      { weekday: 6, type: sp[3], startMin: 35, minutes: 5 },
      { weekday: 6, type: box[1], startMin: 40, minutes: 18 },
    ],
    '25',
  );

  // E2E EMPTY: no templates, no block types — every setting can change
  await channel('E2E EMPTY', 'E2EEMPTY', '25', 6, false);

  await makeScheduling(p, tenantId, series, type, template);
}

/** The broadcast day and first day of the week of E2E SCHED now (day from 09:00, week from Saturday). */
export function schedToday() {
  const today = broadcastToday(Date.now(), { dayStartFrames: minutesToFrames(540, FRAME_RATES['25']), frameRate: '25', timeZone: null });
  return { today, week: weekStartOn(today, 6) };
}

/** Catalog and the clock time of each E2E SCHED block (offset from 09:00). */
export const SCHED_BLOCKS: [string, number][] = [
  ['1H Day Block', 2],
  ['1H Run Block', 6],
  ['1H Repeat Block 19', 10],
  ['1H Repeat Block 23', 14],
  ['1H Night Block', 18],
];

async function makeScheduling(
  p: PrismaClient,
  tenantId: string,
  groupId: string,
  type: (playlistId: string, groupId: string, name: string, minutes: number, rate: FrameRateCode) => Promise<string>,
  template: (playlistId: string, name: string, from: string, to: string, blocks: { weekday: number; type: string; startMin: number; minutes: number }[], rate: FrameRateCode) => Promise<string>,
) {
  const R = FRAME_RATES['25'];
  const id = uuidv7();
  await p.channel.create({ data: { id, tenantId, name: 'E2E SCHED', code: 'E2ESCHED', frameRate: '25', dayStartFrames: minutesToFrames(540, R), weekStart: 6 } });
  const main = uuidv7();
  await p.channelPlaylist.create({ data: { id: main, tenantId, channelId: id, kind: 'main' } });
  const types: Record<string, string> = {};
  for (const [name] of SCHED_BLOCKS) types[name] = await type(main, groupId, name, 60, '25');
  const blocks = [];
  for (let d = 0; d < 7; d++) for (const [name, h] of SCHED_BLOCKS) blocks.push({ weekday: d, type: types[name], startMin: h * 60, minutes: 60 });
  const tpl = await template(main, 'SCHED MAIN', '2024-03-23', '2099-05-29', blocks, '25');

  // catalog
  const ct = async (name: string, family: string) => {
    const x = uuidv7();
    await p.contentType.create({ data: { id: x, tenantId, name, family } });
    return x;
  };
  const content = async (contentTypeId: string, title: string, eps: { title: string; chapter: number | null; minutes: number | null; template?: boolean }[]) => {
    const c = uuidv7();
    await p.content.create({ data: { id: c, tenantId, contentTypeId, title, code: title.slice(0, 4).toUpperCase() } });
    const ids: string[] = [];
    for (const e of eps) {
      const x = uuidv7();
      await p.production.create({
        data: { id: x, tenantId, contentId: c, title: e.title, code: `${title.slice(0, 3).toUpperCase()}-${e.chapter ?? ids.length}`, chapter: e.chapter, isTemplate: !!e.template, lengthFrames: e.minutes === null ? null : minutesToFrames(e.minutes, R), mediaStatus: 'ready' },
      });
      if (!e.template) ids.push(x);
    }
    return ids;
  };
  const series = await ct('TV Series Drama', 'program');
  const idents = await ct('Idents', 'filling');
  const harbor = await content(series, 'Harbor Nights', [{ title: '[TEMPLATE]-Harbor Nights', chapter: 0, minutes: null, template: true }, ...Array.from({ length: 12 }, (_, i) => ({ title: `Harbor Nights - ${i + 1}`, chapter: i + 1, minutes: i === 2 ? null : 45 }))]);
  const bright = await content(series, 'Bright Lanes', Array.from({ length: 12 }, (_, i) => ({ title: `Bright Lanes - ${i + 1}`, chapter: i + 1, minutes: 40 })));
  await content(series, 'Spider Noir', Array.from({ length: 4 }, (_, i) => ({ title: `Spider Noir - ${i + 1}`, chapter: i + 1, minutes: 50 })));
  const ids = await content(idents, 'Lumen Plus', [1, 2, 3].map((i) => ({ title: `LumenPlus_Ident_${i}`, chapter: null, minutes: 0.25 })));

  // the rest of the catalog (Catalog page): a long series, a commercial, sources, custom fields,
  // a segmentation, a rotation list, graphics and time windows
  await content(series, 'Night Desk 2020', Array.from({ length: 55 }, (_, i) => ({ title: `Night Desk 2020 - ${i + 1}`, chapter: i + 1, minutes: 42 })));
  await content(await ct('2026 OCT COMMERCIAL', 'advert'), '15 OCT 2026', [{ title: '[ENT-081]_[P-C] - 0', chapter: 0, minutes: 0.5 }]);
  const server = uuidv7();
  await p.source.createMany({ data: [{ id: server, tenantId, name: 'SERVER', code: 'SVR' }, { id: uuidv7(), tenantId, name: 'LIVE', code: 'LIV', isLive: true }] });
  await p.customField.createMany({ data: [{ id: uuidv7(), tenantId, entity: 'production', key: 'STAR', label: 'STAR', position: 0 }, { id: uuidv7(), tenantId, entity: 'production', key: 'GRAPHICS', label: 'GRAPHICS', position: 1 }] });
  await p.production.updateMany({ where: { tenantId }, data: { sourceId: server } });
  const segm = uuidv7();
  await p.segmentation.create({ data: { id: segm, tenantId, productionId: harbor[0], code: 1, name: 'HAR-1-1' } });
  await p.segment.createMany({
    data: [0, 1, 2].map((i) => ({ id: uuidv7(), segmentationId: segm, code: i + 1, sourceId: server, mediaId: 'HAR-1', tcInFrames: minutesToFrames(15 * i, R), tcOutFrames: minutesToFrames(15 * (i + 1), R), lengthFrames: minutesToFrames(15, R) })),
  });
  const list = uuidv7();
  await p.rotationList.create({ data: { id: list, tenantId, name: 'Lumen Fillers', lastItemPosition: 2, randomInsert: true } });
  await p.rotationListItem.createMany({ data: ids.map((productionId, i) => ({ id: uuidv7(), listId: list, productionId, name: `LumenPlus_Ident_${i + 1}`, position: i + 1 })) });
  const gsrc = uuidv7();
  await p.graphicSource.create({ data: { id: gsrc, tenantId, name: 'PRISM SD', code: '2', channelId: id } });
  await p.graphicTemplate.create({ data: { id: uuidv7(), tenantId, sourceId: gsrc, name: '10 SEC BEFORE THE END', startType: 'to-end', startOffsetFrames: minutesToFrames(0, R) + 1000, endType: 'duration', endDurationFrames: 750 } });
  await p.timeWindow.createMany({ data: [{ id: uuidv7(), tenantId, name: 'Kids', color: '#f8e71c', lengthFrames: minutesToFrames(300, R) }, { id: uuidv7(), tenantId, name: 'Family Prime Time', color: '#7ed321', lengthFrames: minutesToFrames(180, R) }] });

  // orders around this week
  const { week } = schedToday();
  const days: TemplateDay[] = Array.from({ length: 7 }, () => new Map(SCHED_BLOCKS.map(([n, h]) => [types[n], { startFrames: minutesToFrames(h * 60, R), lengthFrames: minutesToFrames(60, R) }])));
  const ctx = { templates: new Map([[id, days]]), dayFrames: framesPerDay(R) };
  const order = async (spec: { name: string; mode: 'series' | 'promos'; status: 'confirmed' | 'draft'; start: string; end: string; color: string; productions: string[]; build: (items: string[]) => AiringDraft[] }) => {
    const items = spec.productions.map((productionId) => ({ id: uuidv7(), productionId, lengthFrames: null }));
    const d: OrderDraft = {
      name: spec.name, mode: spec.mode, status: spec.status, startDate: spec.start, endDate: spec.end, color: spec.color, firstItemId: null, reuseInLoop: false, maxAirings: null, totalAirings: null,
      timeWindows: { allowed: [], rejected: [] }, channels: [{ channelId: id, templateId: tpl }], items, airings: spec.build(items.map((i) => i.id)),
    };
    const r = copyWeek(d, ctx, id, week);
    if (!r.ok) throw new Error(r.reason);
    const orderId = uuidv7();
    const day = (x: string) => new Date(`${x}T00:00:00Z`);
    await p.order.create({ data: { id: orderId, tenantId, name: d.name, mode: d.mode, status: d.status, startDate: day(d.startDate), endDate: day(d.endDate), color: d.color, timeWindows: d.timeWindows as never } });
    await p.orderChannel.create({ data: { id: uuidv7(), orderId, channelId: id, templateId: tpl, position: 0 } });
    await p.orderItem.createMany({ data: items.map((i, position) => ({ id: i.id, orderId, position, productionId: i.productionId, lengthFrames: null })) });
    const row = (a: AiringDraft) => ({ id: a.id, tenantId, orderId, channelId: id, date: day(a.date), blockTypeId: a.blockTypeId, passes: a.passes, repeatOfId: a.repeatOfId, repeatIndex: 0 });
    await p.airing.createMany({ data: r.airings.filter((a) => !a.repeatOfId).map(row) });
    await p.airing.createMany({ data: r.airings.filter((a) => a.repeatOfId).map(row) });
    await p.airingItem.createMany({ data: r.airings.flatMap((a) => a.items.map((x, position) => ({ id: uuidv7(), airingId: a.id, position, orderItemId: x.itemId, passes: x.passes }))) });
  };
  const air = (date: string, bt: string, itemId: string | null, passes = 1, repeatOf: AiringDraft | null = null, items: string[] = []): AiringDraft => ({
    id: uuidv7(), channelId: id, date, blockTypeId: bt, passes: repeatOf ? 0 : passes, repeatOfId: repeatOf?.id ?? null, repeatIndex: 0, blockColor: null,
    items: repeatOf ? [] : itemId ? [{ itemId, passes: 0, jingle: null }] : items.map((x) => ({ itemId: x, passes: 0, jingle: null })),
  });
  // Harbor: Sat / Mon / Wed at 15:00 (Run), repeats 19:00 and 23:00 the same day, 11:00 the next day
  await order({
    name: 'Harbor - E2E', mode: 'series', status: 'confirmed', start: addDays(week, -7), end: addDays(week, 27), color: '#0284c7', productions: harbor,
    build: (items) => [0, 2, 4].flatMap((off, i) => {
      const f = air(addDays(week, off), types['1H Run Block'], items[i]);
      return [f, air(f.date, types['1H Repeat Block 19'], null, 0, f), air(f.date, types['1H Repeat Block 23'], null, 0, f), air(addDays(f.date, 1), types['1H Day Block'], null, 0, f)];
    }),
  });
  // Bright Lanes: a draft on Sun / Tue / Thu at 15:00
  await order({
    name: 'Bright Lanes - E2E', mode: 'series', status: 'draft', start: addDays(week, -7), end: addDays(week, 13), color: '#d97706', productions: bright,
    build: (items) => [1, 3, 5].map((off, i) => air(addDays(week, off), types['1H Run Block'], items[i])),
  });
  // idents: 2 passes in every block of every day
  await order({
    name: 'Lumen Plus idents - E2E', mode: 'promos', status: 'confirmed', start: addDays(week, -7), end: addDays(week, 13), color: '#7c3aed', productions: ids,
    build: (items) => Array.from({ length: 7 }, (_, off) => SCHED_BLOCKS.map(([n]) => air(addDays(week, off), types[n], null, 2, null, items))).flat(),
  });
}

// ---------------------------------------------------------------- agents (decision 0024)

/**
 * A team of two agents acting with the role "Scheduler", and #playlist-checks where Playlist checker
 * handed work to Weeks builder, whose change (create the week of E2E TV `week`) waits for a person.
 * The company's AI table (decision 0025) is Drafts, and Playlist › Approve asks first. No provider key:
 * nothing here calls a provider.
 */
export async function makeAgentTeam() {
  const p = client();
  const t = await p.tenant.findUniqueOrThrow({ where: { slug: SLUG } });
  const read = { read: 'on' };
  const drafts = { read: 'on', change: 'on', create: 'on' };
  await p.tenant.update({
    where: { id: t.id },
    data: { aiAccess: 'on', aiPolicy: { media: read, layouts: read, scheduling: read, playlist: { ...drafts, approve: 'ask' }, ads: drafts, channels: read } },
  });
  const roleId = uuidv7();
  await p.role.create({
    data: {
      id: roleId, tenantId: t.id, name: 'Scheduler', allChannels: true,
      grants: { create: ['playlist:view', 'playlist:edit', 'playlist:approve', 'catalog:view', 'orders:view'].map((g) => ({ id: uuidv7(), module: g.split(':')[0], action: g.split(':')[1] })) },
    },
  });
  const tester = await p.user.findUniqueOrThrow({ where: { email: TESTER.email } });
  const checker = uuidv7();
  const builder = uuidv7();
  const base = { tenantId: t.id, provider: 'anthropic', model: 'claude-opus-5-5', roleId };
  await p.agent.createMany({
    data: [
      { ...base, id: checker, name: 'Playlist checker', mark: 'PC', color: 'm1', job: "Checks the coming days' playlists and says what is wrong.", parts: { playlist: 'read', media: 'read', scheduling: 'read', ads: 'read' }, skill: '1. check_day for tomorrow on each channel.\n2. Report each problem.', worksWith: [builder] },
      { ...base, id: builder, name: 'Weeks builder', mark: 'WB', color: 'm5', job: 'Creates the coming weeks of each channel from its layouts.', parts: { playlist: 'edit', layouts: 'read' }, skill: '1. Preview create_weeks for the first missing week.' },
    ],
  });
  const room = uuidv7();
  await p.agentRoom.create({ data: { id: room, tenantId: t.id, name: 'playlist-checks', description: 'What the checks find, and who fixes it' } });
  const week = weekStartOn(addDays(new Date().toISOString().slice(0, 10), 56), 6);
  const at = (min: number) => new Date(Date.now() - (10 - min) * 60_000);
  const run = uuidv7();
  await p.agentRun.create({ data: { id: run, tenantId: t.id, agentId: builder, trigger: 'handoff', requestedById: tester.id, roomId: room, chain: [checker], status: 'done', startedAt: at(2), endedAt: at(3), inputTokens: 5200, outputTokens: 640 } });
  const [m1, m2, m3, m4, m5] = [uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7()];
  const msg = { tenantId: t.id, roomId: room, threadId: m1 };
  await p.agentMessage.createMany({
    data: [
      { id: m1, tenantId: t.id, roomId: room, authorKind: 'person', authorUserId: tester.id, text: '@Playlist checker are the coming weeks of E2E TV ready?', createdAt: at(0) },
      { ...msg, id: m2, authorKind: 'agent', authorAgentId: checker, text: `E2E TV has no week from ${week} yet.\n@Weeks builder can you make it?`, payload: { handoff: builder }, createdAt: at(1) },
      { ...msg, id: m3, authorKind: 'agent', authorAgentId: builder, kind: 'change', text: 'Create weeks', payload: { changeId: run }, runId: run, createdAt: at(2) },
      { ...msg, id: m4, authorKind: 'agent', authorAgentId: builder, text: `I prepared the week of ${week}: main and ads playlists. It waits for your approval.`, runId: run, createdAt: at(2) },
      { ...msg, id: m5, authorKind: 'agent', authorAgentId: builder, kind: 'memory', text: 'E2E TV weeks are made eight weeks ahead.', runId: run, createdAt: at(2) },
    ],
  });
  await p.agentChange.create({
    data: {
      id: run, tenantId: t.id, agentId: builder, runId: run, messageId: m3, tool: 'create_weeks', args: { channel: 'E2E TV', from_week: week, apply: true },
      preview: `E2E TV · 2 weeks to create (preview — nothing is created)\n- Week of ${week} · main playlist · layout "E2E MAIN"\n- Week of ${week} · ads playlist · layout "E2E ADS"\nTo create them: create_weeks with the same arguments and apply: true.`,
      createdAt: at(2),
    },
  });
  return { tenantId: t.id, room, checker, builder, week };
}

/** The weeks of E2E TV that start on `firstDate`. */
export async function weeksFrom(firstDate: string) {
  return client().week.count({ where: { firstDate: day(firstDate), playlist: { channel: { name: 'E2E TV', tenant: { slug: SLUG } } } } });
}

/**
 * Phase B: in the E2E tester's chat with Weeks builder, a request and the change it prepared — fill
 * E2E TV's main playlist of `date` from its plans (Program placements, only what is missing), at
 * the day's version now. The day and what it is filled from must exist (prepareFill).
 */
export async function seedDayChange(date: string) {
  const p = client();
  const t = await p.tenant.findUniqueOrThrow({ where: { slug: SLUG } });
  const tester = await p.user.findUniqueOrThrow({ where: { email: TESTER.email } });
  const agent = await p.agent.findFirstOrThrow({ where: { tenantId: t.id, name: 'Weeks builder' } });
  const dayRow = await p.dayPlaylist.findFirstOrThrow({ where: { tenantId: t.id, date: day(date), playlist: { kind: 'main', channel: { name: 'E2E TV' } } } });
  const at = (min: number) => new Date(Date.now() - (5 - min) * 60_000);
  const run = uuidv7();
  await p.agentRun.create({ data: { id: run, tenantId: t.id, agentId: agent.id, trigger: 'chat', requestedById: tester.id, chatUserId: tester.id, status: 'done', startedAt: at(0), endedAt: at(1) } });
  const chat = { tenantId: t.id, agentId: agent.id, chatUserId: tester.id };
  const [ask, card, said] = [uuidv7(), uuidv7(), uuidv7()];
  await p.agentMessage.createMany({
    data: [
      { ...chat, id: ask, authorKind: 'person', authorUserId: tester.id, text: `Put the plans of ${date} into the day`, createdAt: at(0) },
      { ...chat, id: card, authorKind: 'agent', authorAgentId: agent.id, kind: 'change', text: 'Fill a day', payload: { changeId: run }, runId: run, createdAt: at(1) },
      { ...chat, id: said, authorKind: 'agent', authorAgentId: agent.id, text: 'The two airings of the confirmed plan go in. It waits for you.', runId: run, createdAt: at(1) },
    ],
  });
  await p.agentChange.create({
    data: {
      id: run, tenantId: t.id, agentId: agent.id, runId: run, messageId: card, tool: 'fill_day',
      args: { channel: 'E2E TV', date, playlist: 'main', step: 'programs', mode: 'missing', apply: true, version: dayRow.version },
      preview: `E2E TV · Main playlist · ${date} · Draft · version ${dayRow.version} — preview, nothing is saved\nProgram placements: 2 placed`,
      createdAt: at(1),
    },
  });
}

/**
 * Phase C1: in the E2E tester's chat with Weeks builder, a request and one change of `tool` with
 * these arguments (applied as they are, `apply: true` and the day's version are added for day tools).
 */
export async function seedAgentChange(tool: 'edit_day' | 'approve_day', date: string, extra: Record<string, unknown> = {}) {
  const p = client();
  const t = await p.tenant.findUniqueOrThrow({ where: { slug: SLUG } });
  const tester = await p.user.findUniqueOrThrow({ where: { email: TESTER.email } });
  const agent = await p.agent.findFirstOrThrow({ where: { tenantId: t.id, name: 'Weeks builder' } });
  const dayRow = await p.dayPlaylist.findFirstOrThrow({ where: { tenantId: t.id, date: day(date), playlist: { kind: 'main', channel: { name: 'E2E TV' } } } });
  const at = (min: number) => new Date(Date.now() - (5 - min) * 60_000);
  const run = uuidv7();
  await p.agentRun.create({ data: { id: run, tenantId: t.id, agentId: agent.id, trigger: 'chat', requestedById: tester.id, chatUserId: tester.id, status: 'done', startedAt: at(0), endedAt: at(1) } });
  const chat = { tenantId: t.id, agentId: agent.id, chatUserId: tester.id };
  const card = uuidv7();
  const title = tool === 'edit_day' ? 'Change rows of a day' : 'Approve a day for air';
  await p.agentMessage.createMany({
    data: [
      { ...chat, id: uuidv7(), authorKind: 'person', authorUserId: tester.id, text: tool === 'edit_day' ? `Put a filler at the end of Run Block 1 on ${date}` : `Approve ${date} for air`, createdAt: at(0) },
      { ...chat, id: card, authorKind: 'agent', authorAgentId: agent.id, kind: 'change', text: title, payload: { changeId: run }, runId: run, createdAt: at(1) },
    ],
  });
  await p.agentChange.create({
    data: {
      id: run, tenantId: t.id, agentId: agent.id, runId: run, messageId: card, tool,
      args: { channel: 'E2E TV', date, playlist: 'main', ...extra, apply: true, version: dayRow.version },
      preview: `E2E TV · Main playlist · ${date} · Draft · version ${dayRow.version} — preview${tool === 'approve_day' ? ': approving puts this day on air' : ', nothing is saved'}`,
      createdAt: at(1),
    },
  });
  return run;
}

/** An item of the test company's catalog with a length (the rotation list "E2E Fillers" has some). */
export async function itemWithLength() {
  const p = client();
  const t = await p.tenant.findUniqueOrThrow({ where: { slug: SLUG } });
  return p.production.findFirstOrThrow({ where: { tenantId: t.id, deletedAt: null, lengthFrames: { gt: 0 }, title: { startsWith: 'Filler' } }, select: { id: true, title: true } });
}

/** The E2E TV main day playlist of `date` is approved. */
export async function dayApproved(date: string) {
  const p = client();
  const t = await p.tenant.findUniqueOrThrow({ where: { slug: SLUG } });
  return (await p.dayPlaylist.findFirstOrThrow({ where: { tenantId: t.id, date: day(date), playlist: { kind: 'main', channel: { name: 'E2E TV' } } } })).published;
}

/**
 * Decision 0025: the company lets AI apps make layouts after asking first, and an AI app of the E2E
 * tester ("Claude on my laptop") asked to make the main layout "WINTER 2031" of E2E TV: it waits.
 * Answers a counter of layouts with that name.
 */
export async function seedAppChange() {
  const p = client();
  const t = await p.tenant.findUniqueOrThrow({ where: { slug: SLUG } });
  await p.tenant.update({
    where: { id: t.id },
    data: { aiAccess: 'on', aiPolicy: { layouts: { read: 'on', change: 'on', create: 'ask' }, playlist: { read: 'on' }, channels: { read: 'on' } } },
  });
  const tester = await p.user.findUniqueOrThrow({ where: { email: TESTER.email } });
  const token = uuidv7();
  await p.accessToken.create({
    data: { id: token, userId: tester.id, tenantId: t.id, name: 'Claude on my laptop', tokenHash: `e2e-${token}`, access: 'edit', expiresAt: new Date(Date.now() + 86_400_000) },
  });
  await p.agentChange.create({
    data: {
      id: uuidv7(), tenantId: t.id, agentId: null, runId: null, tokenId: token, userId: tester.id, tool: 'create_layout',
      args: { channel: 'E2E TV', playlist: 'main', name: 'WINTER 2031', valid_from: '2031-01-04', valid_to: '2031-03-28', apply: true },
      preview: 'E2E TV · new main layout "WINTER 2031" · 2031-01-04 → 2031-03-28 · every day, no blocks yet — preview, nothing is made',
    },
  });
  return () => p.template.count({ where: { tenantId: t.id, name: 'WINTER 2031', deletedAt: null } });
}

