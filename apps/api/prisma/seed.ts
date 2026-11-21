// Sample companies with different channel profiles, so every design is tried beyond one company
// (decision 0001).
//
//   B · a public broadcaster: main playlist only (no ads), week starts Monday, 25 fps, DST time zone
//   C · a local station: main + ads playlists, 29.97 drop-frame, week starts Sunday
//
// Run: npm run db:seed            (skips companies that already exist)
//      npm run db:seed -- --reset (removes the sample companies first)

import {
  FRAME_RATES,
  addDays,
  copyWeek,
  frameRate,
  framesPerDay,
  minutesToFrames,
  uuidv7,
  weekdayOf,
  type AiringDraft,
  type FrameRateCode,
  type OrderDraft,
  type OrderMode,
  type TemplateDay,
} from '@9eye/core';
import { db, fromIsoDate, platformDb, withTenant } from '../src/db';
import { removeTenant } from '../src/maintenance';

type Kind = 'main' | 'ads';
const ALL = [true, true, true, true, true, true, true];

interface ChannelSpec {
  name: string;
  code: string;
  frameRate: FrameRateCode;
  dayStart: string; // "06:00"
  weekStart: number;
  timeZone: string | null;
  dateLocale: string;
  kinds: Kind[];
}

async function makeTenant(name: string, slug: string, reset: boolean): Promise<string | null> {
  if (reset) await removeTenant(slug);
  if (await platformDb.tenant.findUnique({ where: { slug } })) {
    console.log(`  ${name}: already there, skipped`);
    return null;
  }
  const t = await platformDb.tenant.create({ data: { id: uuidv7(), name, slug } });
  return t.id;
}

function clockToMinutes(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

async function makeChannel(spec: ChannelSpec) {
  const r = frameRate(spec.frameRate);
  const channel = await db.channel.create({
    data: {
      id: uuidv7(),
      name: spec.name,
      code: spec.code,
      frameRate: spec.frameRate,
      dayStartFrames: minutesToFrames(clockToMinutes(spec.dayStart), r),
      weekStart: spec.weekStart,
      timeZone: spec.timeZone,
      dateLocale: spec.dateLocale,
      allowedExports: ['bxf'],
      defaultExport: 'bxf',
      epgTypes: ['xmltv'],
      bxfTimesUtc: spec.timeZone === 'America/Chicago',
    } as never,
  });
  const playlists: Record<string, string> = {};
  for (const kind of spec.kinds) {
    const p = await db.channelPlaylist.create({ data: { id: uuidv7(), channelId: channel.id, kind } as never });
    playlists[kind] = p.id;
  }
  return { channel, playlists, rate: r, dayStartMin: clockToMinutes(spec.dayStart) };
}

async function makeGroup(name: string, color: string) {
  return db.blockGroup.create({ data: { id: uuidv7(), name, color } as never });
}

interface TypeSpec {
  name: string;
  group: string;
  color: string;
  minutes: number;
  weekdays?: boolean[];
  opensWithBreak?: boolean;
}

async function makeTypes(playlistId: string, specs: TypeSpec[], groups: Record<string, string>, rateCode: FrameRateCode) {
  const r = FRAME_RATES[rateCode];
  const out: Record<string, { id: string; lengthFrames: number }> = {};
  for (const s of specs) {
    const id = uuidv7();
    const lengthFrames = minutesToFrames(s.minutes, r);
    await db.blockType.create({
      data: {
        id,
        playlistId,
        groupId: groups[s.group],
        name: s.name,
        color: s.color,
        textColor: '#ffffff',
        lengthFrames,
        validFrom: fromIsoDate('2026-01-01'),
        validTo: fromIsoDate('2099-12-31'),
        validWeekdays: s.weekdays ?? ALL,
        fillGaps: true,
        opensWithBreak: s.opensWithBreak ?? false,
      } as never,
    });
    out[s.name] = { id, lengthFrames };
  }
  return out;
}

interface Placed {
  weekday: number;
  type: string;
  at: string; // clock time "HH:MM"
  breaks?: string[];
}

async function makeTemplate(
  playlistId: string,
  name: string,
  validFrom: string,
  validTo: string,
  placed: Placed[],
  types: Record<string, { id: string; lengthFrames: number }>,
  breakTypes: Record<string, { id: string }>,
  ch: { rate: ReturnType<typeof frameRate>; dayStartMin: number },
) {
  const templateId = uuidv7();
  await db.template.create({
    data: { id: templateId, playlistId, name, validFrom: fromIsoDate(validFrom), validTo: fromIsoDate(validTo), activeWeekdays: ALL } as never,
  });
  const blocks = placed.map((p) => {
    const t = types[p.type];
    if (!t) throw new Error(`Unknown block type ${p.type}`);
    const offsetMin = (clockToMinutes(p.at) - ch.dayStartMin + 1440) % 1440;
    return {
      id: uuidv7(),
      templateId,
      weekday: p.weekday,
      blockTypeId: t.id,
      startFrames: minutesToFrames(offsetMin, ch.rate),
      lengthFrames: t.lengthFrames,
      fillGaps: true,
      opensWithBreak: false,
      breaks: (p.breaks ?? []).map((b) => {
        const k = breakTypes[b];
        if (!k) throw new Error(`Unknown break ${b}`);
        return k.id;
      }),
    };
  });
  await platformDb.templateBlock.createMany({ data: blocks.map(({ breaks: _b, ...b }) => b) });
  await platformDb.linkedBreak.createMany({
    data: blocks.flatMap((b) => b.breaks.map((breakTypeId, position) => ({ id: uuidv7(), blockId: b.id, position, breakTypeId }))),
  });
  return templateId;
}

const pad = (n: number) => String(n).padStart(2, '0');

// ---------------------------------------------------------------- catalog and orders (Scheduling)

async function makeContent(type: { name: string; family: string }, title: string, items: { title: string; chapter: number | null; minutes: number | null }[], rate: ReturnType<typeof frameRate>) {
  let t = await db.contentType.findFirst({ where: { name: type.name } });
  if (!t) t = await db.contentType.create({ data: { id: uuidv7(), name: type.name, family: type.family, code: type.name.slice(0, 3).toUpperCase() } as never });
  const content = await db.content.create({ data: { id: uuidv7(), contentTypeId: t.id, title, code: title.replace(/\W/g, '').slice(0, 6).toUpperCase() } as never });
  const ids: string[] = [];
  for (const it of items) {
    const id = uuidv7();
    await db.production.create({
      data: {
        id, contentId: content.id, title: it.title, code: `${content.code}-${pad(it.chapter ?? ids.length + 1)}`, chapter: it.chapter,
        lengthFrames: it.minutes === null ? null : minutesToFrames(it.minutes, rate), mediaStatus: 'ready',
      } as never,
    });
    ids.push(id);
  }
  return { content, ids };
}

async function templateDaysOf(templateId: string): Promise<TemplateDay[]> {
  const rows = await platformDb.templateBlock.findMany({ where: { templateId } });
  const days: TemplateDay[] = Array.from({ length: 7 }, () => new Map());
  for (const b of rows) days[b.weekday].set(b.blockTypeId, { startFrames: b.startFrames, lengthFrames: b.lengthFrames });
  return days;
}

/**
 * An order whose reference week is placed by hand and then copied over the whole order (as an
 * operator does: one complete week, then Copy week to the whole order).
 */
async function makeOrder(spec: {
  channelId: string;
  templateId: string;
  rate: ReturnType<typeof frameRate>;
  name: string;
  mode: OrderMode;
  status: 'confirmed' | 'draft';
  start: string;
  end: string;
  color: string;
  productionIds: string[];
  refWeek: string;
  /** The reference week: first airings (offset in days from refWeek, block type, item index, passes) and repeats (offset, block type, index of the first airing above). */
  firsts: { day: number; type: string; item?: number; passes?: number }[];
  repeats?: { day: number; type: string; of: number }[];
}) {
  const items = spec.productionIds.map((productionId) => ({ id: uuidv7(), productionId, lengthFrames: null }));
  const programme = spec.mode === 'series' || spec.mode === 'programmes';
  const firsts: AiringDraft[] = spec.firsts.map((f) => ({
    id: uuidv7(), channelId: spec.channelId, date: addDays(spec.refWeek, f.day), blockTypeId: f.type, passes: programme ? 1 : (f.passes ?? 1), repeatOfId: null, repeatIndex: 0, blockColor: null,
    items: programme ? [{ itemId: items[f.item ?? 0].id, passes: 0, jingle: null }] : items.map((i) => ({ itemId: i.id, passes: 0, jingle: null })),
  }));
  const repeats: AiringDraft[] = (spec.repeats ?? []).map((r) => ({ id: uuidv7(), channelId: spec.channelId, date: addDays(spec.refWeek, r.day), blockTypeId: r.type, passes: 0, repeatOfId: firsts[r.of].id, repeatIndex: 0, blockColor: null, items: [] }));
  const d: OrderDraft = {
    name: spec.name, mode: spec.mode, status: spec.status, startDate: spec.start, endDate: spec.end, color: spec.color, firstItemId: null, reuseInLoop: false,
    maxAirings: null, totalAirings: null, timeWindows: { allowed: [], rejected: [] }, channels: [{ channelId: spec.channelId, templateId: spec.templateId }], items, airings: [...firsts, ...repeats],
  };
  const days = await templateDaysOf(spec.templateId);
  for (const a of d.airings) if (!days[weekdayOf(a.date)].has(a.blockTypeId)) throw new Error(`${spec.name}: no such block on ${a.date}`);
  const r = copyWeek(d, { templates: new Map([[spec.channelId, days]]), dayFrames: framesPerDay(spec.rate) }, spec.channelId, spec.refWeek);
  if (!r.ok) throw new Error(`${spec.name}: ${r.reason}`);
  const orderId = uuidv7();
  await db.order.create({
    data: { id: orderId, name: d.name, mode: d.mode, status: d.status, startDate: fromIsoDate(d.startDate), endDate: fromIsoDate(d.endDate), color: d.color, reuseInLoop: false, timeWindows: d.timeWindows } as never,
  });
  await platformDb.orderChannel.create({ data: { id: uuidv7(), orderId, channelId: spec.channelId, templateId: spec.templateId, position: 0 } });
  await platformDb.orderItem.createMany({ data: items.map((i, position) => ({ id: i.id, orderId, position, productionId: i.productionId, lengthFrames: null })) });
  const tenantId = (await platformDb.channel.findUniqueOrThrow({ where: { id: spec.channelId } })).tenantId;
  const row = (a: AiringDraft) => ({ id: a.id, tenantId, orderId, channelId: a.channelId, date: fromIsoDate(a.date), blockTypeId: a.blockTypeId, passes: a.passes, repeatOfId: a.repeatOfId, repeatIndex: a.repeatIndex });
  await platformDb.airing.createMany({ data: r.airings.filter((a) => !a.repeatOfId).map(row) });
  await platformDb.airing.createMany({ data: r.airings.filter((a) => a.repeatOfId).map(row) });
  await platformDb.airingItem.createMany({ data: r.airings.flatMap((a) => a.items.map((x, position) => ({ id: uuidv7(), airingId: a.id, position, orderItemId: x.itemId, passes: x.passes }))) });
  // the lengths come from the catalog
  for (const i of items) {
    const p = await platformDb.production.findUniqueOrThrow({ where: { id: i.productionId } });
    await platformDb.orderItem.update({ where: { id: i.id }, data: { lengthFrames: p.lengthFrames } });
  }
  return r;
}

// ---------------------------------------------------------------- scenario B
async function seedPublicBroadcaster(reset: boolean) {
  const tenantId = await makeTenant('Northlight Public Media (sample)', 'sample-public', reset);
  if (!tenantId) return;
  await withTenant(tenantId, async () => {
    const ch = await makeChannel({ name: 'NORTHLIGHT ONE', code: 'NL1', frameRate: '25', dayStart: '06:00', weekStart: 1, timeZone: 'Europe/Brussels', dateLocale: 'en-GB', kinds: ['main'] });
    const g: Record<string, string> = {};
    for (const [n, c] of [['News', '#2f6fdf'], ['Daytime', '#2a9d8f'], ['Prime time', '#c2410c'], ['Night', '#6b7280'], ['Weekend', '#7c3aed']] as const) {
      g[n] = (await makeGroup(n, c)).id;
    }
    const WEEKDAYS = [false, true, true, true, true, true, false];
    const WEEKEND = [true, false, false, false, false, false, true];
    const types = await makeTypes(
      ch.playlists.main,
      [
        { name: 'Morning News', group: 'News', color: '#2f6fdf', minutes: 180 },
        { name: 'Midday News', group: 'News', color: '#2f6fdf', minutes: 30 },
        { name: 'Regional News', group: 'News', color: '#2f6fdf', minutes: 30, weekdays: WEEKDAYS },
        { name: 'Evening News', group: 'News', color: '#2f6fdf', minutes: 15 },
        { name: 'Late News', group: 'News', color: '#2f6fdf', minutes: 30 },
        { name: 'Daytime Morning', group: 'Daytime', color: '#2a9d8f', minutes: 180, weekdays: WEEKDAYS },
        { name: 'Daytime Afternoon', group: 'Daytime', color: '#2a9d8f', minutes: 330, weekdays: WEEKDAYS },
        { name: 'Evening Magazine', group: 'Prime time', color: '#c2410c', minutes: 90, weekdays: WEEKDAYS },
        { name: 'Prime Time', group: 'Prime time', color: '#c2410c', minutes: 120 },
        { name: 'Late Night', group: 'Night', color: '#6b7280', minutes: 135 },
        { name: 'Night Repeats', group: 'Night', color: '#6b7280', minutes: 300 },
        { name: 'Weekend Morning', group: 'Weekend', color: '#7c3aed', minutes: 180, weekdays: WEEKEND },
        { name: 'Weekend Sport', group: 'Weekend', color: '#7c3aed', minutes: 330, weekdays: WEEKEND },
        { name: 'Weekend Evening', group: 'Weekend', color: '#7c3aed', minutes: 120, weekdays: WEEKEND },
      ],
      g,
      '25',
    );
    const weekday = (d: number): Placed[] => [
      { weekday: d, type: 'Morning News', at: '06:00' },
      { weekday: d, type: 'Daytime Morning', at: '09:00' },
      { weekday: d, type: 'Midday News', at: '12:00' },
      { weekday: d, type: 'Daytime Afternoon', at: '12:30' },
      { weekday: d, type: 'Regional News', at: '18:00' },
      { weekday: d, type: 'Evening Magazine', at: '18:30' },
      { weekday: d, type: 'Evening News', at: '20:00' },
      { weekday: d, type: 'Prime Time', at: '20:15' },
      { weekday: d, type: 'Late News', at: '22:15' },
      { weekday: d, type: 'Late Night', at: '22:45' },
      { weekday: d, type: 'Night Repeats', at: '01:00' },
    ];
    const weekend = (d: number): Placed[] => [
      { weekday: d, type: 'Weekend Morning', at: '06:00' },
      { weekday: d, type: 'Morning News', at: '09:00' },
      { weekday: d, type: 'Midday News', at: '12:00' },
      { weekday: d, type: 'Weekend Sport', at: '12:30' },
      { weekday: d, type: 'Evening News', at: '18:00' },
      { weekday: d, type: 'Weekend Evening', at: '18:15' },
      { weekday: d, type: 'Prime Time', at: '20:15' },
      { weekday: d, type: 'Late News', at: '22:15' },
      { weekday: d, type: 'Late Night', at: '22:45' },
      { weekday: d, type: 'Night Repeats', at: '01:00' },
    ];
    // 2026-09-07 is a Monday, 2027-01-03 a Sunday.
    const tpl = await makeTemplate(ch.playlists.main, 'Autumn 2026', '2026-09-07', '2027-01-03', [1, 2, 3, 4, 5].flatMap(weekday).concat([6, 0].flatMap(weekend)), types, {}, ch);

    // Catalog and orders: a programmes-mode film slot at the weekend and a documentary series on weekdays.
    const films = await makeContent({ name: 'Feature films', family: 'program' }, 'Autumn Cinema', ['The Quiet Harbour', 'North by Night', 'A Winter Garden', 'Lanterns', 'The Long Field', 'Paper Moons', 'Grey Coast', 'Second Light'].map((title) => ({ title, chapter: null, minutes: 95 })), ch.rate);
    const docs = await makeContent({ name: 'Documentaries', family: 'program' }, 'Planet Atlas', Array.from({ length: 12 }, (_, i) => ({ title: `Planet Atlas - ${i + 1}`, chapter: i + 1, minutes: i === 9 ? null : 52 })), ch.rate);
    await makeContent({ name: 'Station idents', family: 'filling' }, 'Northlight idents', ['NL1 ident morning', 'NL1 ident evening', 'NL1 ident night'].map((title) => ({ title, chapter: null, minutes: 0.25 })), ch.rate);
    // 2026-10-19 is a Monday
    await makeOrder({
      channelId: ch.channel.id, templateId: tpl, rate: ch.rate, name: 'Weekend Cinema - NL1', mode: 'programmes', status: 'confirmed', start: '2026-10-19', end: '2026-11-29', color: '#d97706',
      productionIds: films.ids, refWeek: '2026-10-19',
      firsts: [{ day: 5, type: types['Weekend Evening'].id, item: 0 }, { day: 6, type: types['Weekend Evening'].id, item: 1 }],
    });
    await makeOrder({
      channelId: ch.channel.id, templateId: tpl, rate: ch.rate, name: 'Planet Atlas - NL1', mode: 'series', status: 'confirmed', start: '2026-10-19', end: '2026-11-29', color: '#059669',
      productionIds: docs.ids, refWeek: '2026-10-19',
      firsts: [{ day: 0, type: types['Prime Time'].id }, { day: 2, type: types['Prime Time'].id }, { day: 4, type: types['Prime Time'].id }],
      repeats: [{ day: 0, type: types['Night Repeats'].id, of: 0 }, { day: 2, type: types['Night Repeats'].id, of: 1 }, { day: 4, type: types['Night Repeats'].id, of: 2 }, { day: 1, type: types['Daytime Morning'].id, of: 0 }],
    });
  });
  console.log('  Northlight Public Media (sample): NORTHLIGHT ONE, main playlist only, week from Monday, 25 fps');
}

// ---------------------------------------------------------------- scenario C
async function seedLocalStation(reset: boolean) {
  const tenantId = await makeTenant('KMTR Local Television (sample)', 'sample-station', reset);
  if (!tenantId) return;
  await withTenant(tenantId, async () => {
    const ch = await makeChannel({ name: 'KMTR 7', code: 'KMTR', frameRate: '29.97df', dayStart: '06:00', weekStart: 0, timeZone: 'America/Chicago', dateLocale: 'en-US', kinds: ['main', 'ads'] });
    const g: Record<string, string> = {};
    for (const [n, c] of [['Local news', '#1d4ed8'], ['Network', '#b45309'], ['Syndicated', '#0f766e'], ['Overnight', '#6b7280'], ['Local break', '#db2777'], ['Network break', '#9333ea']] as const) {
      g[n] = (await makeGroup(n, c)).id;
    }
    const MF = [false, true, true, true, true, true, false];
    const SS = [true, false, false, false, false, false, true];
    const main = await makeTypes(
      ch.playlists.main,
      [
        { name: 'Morning News', group: 'Local news', color: '#1d4ed8', minutes: 60, weekdays: MF },
        { name: 'Network Morning', group: 'Network', color: '#b45309', minutes: 120 },
        ...Array.from({ length: 7 }, (_, i) => ({ name: `Syndicated Hour ${i + 1}`, group: 'Syndicated', color: '#0f766e', minutes: 60, weekdays: MF })),
        { name: 'News at 4', group: 'Local news', color: '#1d4ed8', minutes: 60, weekdays: MF },
        { name: 'Network News', group: 'Network', color: '#b45309', minutes: 30 },
        { name: 'Access Half Hour', group: 'Syndicated', color: '#0f766e', minutes: 30 },
        ...Array.from({ length: 3 }, (_, i) => ({ name: `Prime Hour ${i + 1}`, group: 'Network', color: '#b45309', minutes: 60 })),
        { name: 'News at 9', group: 'Local news', color: '#1d4ed8', minutes: 30 },
        { name: 'Late Night', group: 'Network', color: '#b45309', minutes: 90 },
        { name: 'Overnight', group: 'Overnight', color: '#6b7280', minutes: 420 },
        { name: 'Weekend Kids', group: 'Syndicated', color: '#0f766e', minutes: 120, weekdays: SS },
        { name: 'Weekend Sports', group: 'Network', color: '#b45309', minutes: 300, weekdays: SS },
        { name: 'Weekend Movie', group: 'Syndicated', color: '#0f766e', minutes: 120, weekdays: SS },
      ],
      g,
      '29.97df',
    );
    // Ads playlist: four breaks an hour at their real minute: :12 local (2 min), :24 network (3), :36 local (2), :48 network (3).
    const breakSpecs: TypeSpec[] = [];
    const adsPlaced: Placed[] = [];
    for (let i = 0; i < 24; i++) {
      const h = (6 + i) % 24;
      for (const [mm, kind, len] of [[12, 'Local', 2], [24, 'Network', 3], [36, 'Local', 2], [48, 'Network', 3]] as const) {
        const name = `${kind} ${pad(h)}:${pad(mm)}`;
        breakSpecs.push({ name, group: kind === 'Local' ? 'Local break' : 'Network break', color: kind === 'Local' ? '#db2777' : '#9333ea', minutes: len });
        for (let d = 0; d < 7; d++) adsPlaced.push({ weekday: d, type: name, at: `${pad(h)}:${pad(mm)}` });
      }
    }
    const breaks = await makeTypes(ch.playlists.ads, breakSpecs, g, '29.97df');
    const breaksIn = (at: string, minutes: number) => {
      const out: string[] = [];
      const s = clockToMinutes(at);
      for (let m = s; m < s + minutes; m++) {
        const hh = Math.floor(m / 60) % 24;
        const mm = m % 60;
        const name = [12, 24, 36, 48].includes(mm) ? `${mm === 12 || mm === 36 ? 'Local' : 'Network'} ${pad(hh)}:${pad(mm)}` : null;
        if (name) out.push(name);
      }
      return out;
    };
    const place = (weekday: number, type: string, at: string): Placed => {
      const minutes = Math.round(main[type].lengthFrames / minutesToFrames(1, ch.rate));
      return { weekday, type, at, breaks: breaksIn(at, minutes) };
    };
    const weekday = (d: number): Placed[] => [
      place(d, 'Morning News', '06:00'),
      place(d, 'Network Morning', '07:00'),
      ...Array.from({ length: 7 }, (_, i) => place(d, `Syndicated Hour ${i + 1}`, `${pad(9 + i)}:00`)),
      place(d, 'News at 4', '16:00'),
      place(d, 'Network News', '17:00'),
      place(d, 'Access Half Hour', '17:30'),
      ...Array.from({ length: 3 }, (_, i) => place(d, `Prime Hour ${i + 1}`, `${pad(18 + i)}:00`)),
      place(d, 'News at 9', '21:00'),
      place(d, 'Late Night', '21:30'),
      place(d, 'Overnight', '23:00'),
    ];
    const weekend = (d: number): Placed[] => [
      place(d, 'Weekend Kids', '06:00'),
      place(d, 'Network Morning', '08:00'),
      place(d, 'Weekend Sports', '10:00'),
      place(d, 'Weekend Movie', '15:00'),
      place(d, 'Network News', '17:00'),
      place(d, 'Access Half Hour', '17:30'),
      ...Array.from({ length: 3 }, (_, i) => place(d, `Prime Hour ${i + 1}`, `${pad(18 + i)}:00`)),
      place(d, 'News at 9', '21:00'),
      place(d, 'Late Night', '21:30'),
      place(d, 'Overnight', '23:00'),
    ];
    // 2026-09-06 is a Sunday, 2027-01-02 a Saturday.
    await makeTemplate(ch.playlists.ads, 'Fall 2026 breaks', '2026-09-06', '2027-01-02', adsPlaced, breaks, {}, ch);
    const tpl = await makeTemplate(ch.playlists.main, 'Fall 2026', '2026-09-06', '2027-01-02', [1, 2, 3, 4, 5].flatMap(weekday).concat([6, 0].flatMap(weekend)), main, breaks, ch);

    // Catalog and orders on a 29.97 drop-frame channel: a syndicated series and a station promo order.
    const show = await makeContent({ name: 'Syndicated series', family: 'program' }, 'Coastal Patrol', Array.from({ length: 30 }, (_, i) => ({ title: `Coastal Patrol - ${i + 1}`, chapter: i + 1, minutes: 44 })), ch.rate);
    const promos = await makeContent({ name: 'Station promos', family: 'filling' }, 'KMTR promos', ['KMTR News at 9 promo', 'KMTR Weekend Movie promo', 'KMTR Morning promo', 'KMTR Local Sports promo'].map((title) => ({ title, chapter: null, minutes: 0.5 })), ch.rate);
    // 2026-10-18 is a Sunday
    await makeOrder({
      channelId: ch.channel.id, templateId: tpl, rate: ch.rate, name: 'Coastal Patrol - KMTR', mode: 'series', status: 'confirmed', start: '2026-10-18', end: '2026-11-28', color: '#0284c7',
      productionIds: show.ids, refWeek: '2026-10-18',
      firsts: [1, 2, 3, 4, 5].map((day) => ({ day, type: main['Syndicated Hour 1'].id })),
      repeats: [1, 2, 3, 4, 5].map((day, i) => ({ day, type: main['Overnight'].id, of: i })),
    });
    await makeOrder({
      channelId: ch.channel.id, templateId: tpl, rate: ch.rate, name: 'KMTR station promos', mode: 'promos', status: 'draft', start: '2026-10-18', end: '2026-11-14', color: '#0d9488',
      productionIds: promos.ids, refWeek: '2026-10-18',
      firsts: [0, 1, 2, 3, 4, 5, 6].flatMap((day) => ['Prime Hour 1', 'Prime Hour 2', 'Prime Hour 3'].map((t) => ({ day, type: main[t].id, passes: 2 }))),
    });
    await db.breakList.create({ data: { id: uuidv7(), channelId: ch.channel.id, name: 'Full hour', positions: [0, 1, 2, 3] } as never });
    await db.breakList.create({ data: { id: uuidv7(), channelId: ch.channel.id, name: 'Half hour', positions: [0, 1] } as never });
  });
  console.log('  KMTR Local Television (sample): KMTR 7, main + ads, week from Sunday, 29.97 drop-frame');
}

async function main() {
  const reset = process.argv.includes('--reset');
  console.log('Seeding sample companies…');
  await seedPublicBroadcaster(reset);
  await seedLocalStation(reset);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => platformDb.$disconnect());
