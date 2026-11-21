// The MCP write tools (decision 0023, phase 3), offered only to a token made with --edit; the person's
// role still decides every call. They change drafts only: each answers with a preview unless called
// with apply: true, applies all or nothing, and keeps what was there before so that undo_change can
// put it back while nobody has changed it since. None of them approves, reopens or exports a day.

import { z } from 'zod';
import {
  FILL_STEP_LABEL, STRUCTURAL_EVENT_KINDS, formatClock, formatTc, frameRate, offsetFromClock, parseTc, weekDeleteBlockers,
  type DraftRow, type FillLine, type FillReport, type FillStep, type FrameRate,
} from '@9eye/core';
import { demand } from '../access';
import { db, fromIsoDate, toIsoDate } from '../db';
import { HttpError } from '../errors';
import { listBreakPositions } from '../services/breakPositions';
import { bookSpots, getCommercialOrder, saveCommercialWeek, type BookingDto } from '../services/commercialOrders';
import { getDay, runStep, saveDay } from '../services/days';
import { checkWeeks, createWeeks, deleteWeek, type WeekRunBody } from '../services/weeks';
import type { Principal } from './auth';
import { registerChangeTools, undoMore } from './changes';
import { campaignRef, registerAdsTools, undoAds } from './ads';
import { registerMediaTools, undoMedia } from './media';
import { registerPlanTools, undoPlans } from './plans';
import { registerPlaylistTools, undoPlaylist } from './playlist';
import { registerSetupTools, undoSetup } from './setup';
import {
  WEEKDAYS, capped, channelArg, dateArg, dayHead, findChannel, isUuid, isoDate, missingText, playlistArg, plural, quote, range, type DefineTool, APPLY, UNDO_HINT, draftRow, TOOL_GRANT,
} from './common';

/** A campaign's bookings are changed (and put back) at most this many days at a time. */
const MAX_BOOKING_DAYS = 62;
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;


function reportText(report: FillReport, r: FrameRate): string[] {
  const line = (x: FillLine) => `- ${x.block} · ${x.title}${x.detail ? ` · ${x.detail}` : ''}${x.frames ? ` · ${formatTc(x.frames, r)}` : ''}`;
  const out = [
    [
      `${FILL_STEP_LABEL[report.step]}: ${report.placed.length} placed`,
      report.notPlaced.length ? `${report.notPlaced.length} not placed` : null,
      report.kept ? `${report.kept} already in the day` : null,
      report.removed ? `${plural(report.removed, 'row')} taken out first` : null,
    ].filter(Boolean).join(' · '),
  ];
  if (report.placed.length) out.push('Placed:', ...capped(report.placed.map(line), 'and more', 60));
  if (report.notPlaced.length) out.push('Not placed, and why:', ...capped(report.notPlaced.map(line), 'and more', 60));
  for (const n of report.notes) out.push(`Note: ${n}`);
  return out;
}

/** A layout of the channel's playlist by id or name. */
async function layoutId(channelId: string, kind: 'main' | 'ads', ref: string | undefined): Promise<string | null> {
  if (!ref) return null;
  const t = await db.template.findFirst({
    where: { deletedAt: null, playlist: { channelId, kind }, ...(isUuid(ref) ? { id: ref } : { name: { equals: ref.trim(), mode: 'insensitive' as const } }) },
    select: { id: true },
  });
  if (!t) throw new HttpError(404, `No ${kind} layout "${ref}" on this channel.`);
  return t.id;
}

const STEP: Record<string, FillStep> = { programs: 'programs', breaks: 'breaks', rotation: 'rotation', campaigns: 'commercials' };

/** The write tools; `tool` registers each (with its audit record), see tools.ts. */
export function registerWriteTools(tool: DefineTool, p: Principal) {
  tool(
    'create_weeks',
    'Create weeks',
    `Create the weeks of a channel's playlists from their layouts, so their days can be filled — all or nothing. Preview first: it lists the weeks it would make, and every problem that stops it. ${UNDO_HINT}`,
    z.object({
      channel: channelArg,
      from_week: isoDate.describe("The first day of the first week, YYYY-MM-DD (the channel's week-start day)."),
      to_week: isoDate.optional().describe('The first day of the last week. Default: from_week (one week).'),
      playlists: z.array(z.enum(['main', 'ads'])).min(1).max(2).optional().describe('Default: every playlist of the channel.'),
      main_layout: z.string().max(300).optional().describe('Only where several main layouts fit the weeks: its name or id.'),
      ads_layout: z.string().max(300).optional().describe('Only where several ads layouts fit the weeks: its name or id.'),
      apply: z.boolean().default(false).describe(APPLY),
    }),
    async (a, { changeId }) => {
      const c = await findChannel(p, a.channel);
      demand(p.access, 'playlist', 'edit', c.id);
      const body: WeekRunBody = {
        kinds: a.playlists ?? (c.adsPlaylistId ? ['main', 'ads'] : ['main']),
        fromWeek: a.from_week,
        toWeek: a.to_week ?? a.from_week,
        templates: { main: await layoutId(c.id, 'main', a.main_layout), ads: await layoutId(c.id, 'ads', a.ads_layout) },
      };
      const plan = await checkWeeks(c.id, body);
      const days = (on: boolean[]) => (on.every(Boolean) ? 'every day' : WEEKDAYS.filter((_, i) => on[i]).map((w) => w.slice(0, 3)).join(' ') || 'no day');
      const out = [`${c.name} · ${plural(plan.weeks.length, 'week')} to create${a.apply ? '' : ' (preview — nothing is created)'}`];
      for (const w of plan.weeks) out.push(`- Week ${w.number} ${quote(w.name)} · ${w.kind} playlist · ${range(w.firstDate, w.lastDate)} · layout ${quote(w.templateName)} · ${days(w.activeWeekdays)}`);
      if (plan.problems.length) out.push('Problems — nothing can be created until they are solved:', ...plan.problems.map((x) => `- ${x.message}`));
      if (plan.warnings.length) out.push('Warnings:', ...plan.warnings.map((x) => `- ${x.message}`));
      if (!a.apply) {
        if (plan.problems.length || !plan.weeks.length) return out.join('\n');
        out.push('To create them: create_weeks with the same arguments and apply: true.');
        return { text: out.join('\n'), applyWith: { apply: true } };
      }
      if (plan.problems.length) throw new HttpError(422, out.join('\n'));
      const made = await createWeeks(c.id, body, p.user.id);
      out[0] = `${c.name} · ${plural(made.weeks.length, 'week')} created. Change id ${changeId} — ${UNDO_HINT}`;
      return { text: out.join('\n'), change: { targetId: null, channelIds: [c.id], before: null, after: { weekIds: made.weeks.map((w) => w.id) } } };
    },
    'write',
  );

  tool(
    'fill_day',
    'Fill a day',
    `Run one step that fills a day from what exists, like the day page's Import: Program placements (the airings of confirmed plans), Break events (the spots of each break, from the ads playlist), Rotation lists (fill the blocks' free time), or Campaigns (ads playlist: the booked spots of confirmed campaigns). Preview first: it says what goes in, and what cannot and why. Apply saves the day only if it is still at the version the preview showed. An approved day cannot be changed: a person must reopen it. ${UNDO_HINT}`,
    z.object({
      channel: channelArg,
      date: dateArg,
      playlist: playlistArg,
      step: z.enum(['programs', 'breaks', 'rotation', 'campaigns']).describe('programs and breaks: main playlist; campaigns: ads playlist; rotation: either.'),
      mode: z.enum(['missing', 'all']).default('missing').describe('missing = only what is not in the day yet; all = take out what this step placed before, then place everything again.'),
      version: z.number().int().optional().describe('The day version the preview showed (needed with apply: true).'),
      apply: z.boolean().default(false).describe(APPLY),
    }),
    async (a, { changeId }) => {
      const c = await findChannel(p, a.channel);
      demand(p.access, 'playlist', 'edit', c.id);
      const d = await getDay(c.id, a.playlist, a.date ?? c.today);
      if (!d.day) throw new HttpError(409, `${dayHead(d)}\n${missingText(d)} create_weeks makes it.`);
      if (a.apply && a.version === undefined) throw new HttpError(400, 'Apply needs the version the preview showed.');
      if (a.apply && a.version !== d.day.version) throw new HttpError(409, `The day changed since the preview (version ${a.version}, now ${d.day.version}): preview it again.`);
      const before = d.day.blocks.map((b) => ({ id: b.id, rows: b.events.map(draftRow) }));
      const run = await runStep(d.day.id, { step: STEP[a.step], mode: a.mode, version: d.day.version, blocks: before });
      const r = frameRate(d.channel.frameRate);
      const out = [`${dayHead(d)} · version ${d.day.version}`, ...reportText(run.report, r)];
      const changes = run.report.placed.length + run.report.removed;
      if (!a.apply) {
        out[0] += ' — preview, nothing is saved';
        if (!changes) return [...out, 'Nothing would change.'].join('\n');
        out.push(`To save it: fill_day with apply: true and version ${d.day.version}.`);
        return { text: out.join('\n'), applyWith: { apply: true, version: d.day.version, date: d.date } };
      }
      if (!changes) return [...out, 'Nothing changed, so nothing was saved.'].join('\n');
      const saved = await saveDay(d.day.id, { version: d.day.version, blocks: run.blocks.map((b) => ({ id: b.id, rows: b.events.map(draftRow) })) });
      const version = saved.day!.version;
      out[0] += ` — saved as version ${version}. Change id ${changeId} — ${UNDO_HINT}`;
      return {
        text: out.join('\n'),
        change: { targetId: d.day.id, channelIds: [c.id], before: { dayId: d.day.id, version: d.day.version, blocks: before }, after: { dayId: d.day.id, version } },
      };
    },
    'write',
  );

  tool(
    'book_campaign_spots',
    'Book campaign spots',
    `Book a campaign's ads into the breaks of the ads playlist over a date range (at most ${MAX_BOOKING_DAYS} days at a time): every chosen break on every chosen day that has it; a break the campaign has booked already keeps its spot. Preview first: it counts the spots and their length, and the breaks a weekday does not have. Apply needs the campaign version from get_campaign or the preview. ${UNDO_HINT}`,
    z.object({
      campaign: z.string().trim().min(1).max(300).describe('The campaign: its id or name (get_deal lists them).'),
      from: isoDate.optional().describe('First day. Default: the campaign start.'),
      to: isoDate.optional().describe('Last day. Default: the campaign end.'),
      breaks: z.array(z.string().max(200)).max(500).optional().describe('Break names as get_campaign lists them. Default: every break, narrowed by break_name_contains and between.'),
      break_name_contains: z.string().max(100).optional().describe('Only breaks whose name contains these words, e.g. "Ad Pod".'),
      between: z.object({ from: z.string().max(11), to: z.string().max(11) }).optional().describe('Only breaks that start in this clock-time range, "HH:MM" (the broadcast day can run past midnight).'),
      break_in_block: z.number().int().min(1).max(20).optional().describe('Only the Nth break of each block (2 = the second break of every block), day by day from the layout; breaks, break_name_contains and between narrow it further.'),
      weekdays: z.array(z.enum(SHORT_DAYS)).min(1).max(7).optional().describe('Default: every day.'),
      ads: z.array(z.string().max(100)).min(1).max(200).optional().describe('"V1", "V2"… as get_campaign lists them, or their ids. Default: all its ads.'),
      spread: z.enum(['rotate', 'same']).default('rotate').describe('rotate = the ads take turns over each day\'s breaks; same = the first ad in every break.'),
      position: z.string().max(200).optional().describe('A break position from get_campaign. Default: none.'),
      plays: z.number().int().min(1).max(99).default(1).describe('How many times the spot plays in each break.'),
      version: z.number().int().optional().describe('The campaign version (needed with apply: true).'),
      apply: z.boolean().default(false).describe(APPLY),
    }),
    async (a, { changeId }) => {
      const o = await campaignRef(p, a.campaign, 'edit');
      if (a.apply && a.version === undefined) throw new HttpError(400, 'Apply needs the campaign version (get_campaign or the preview shows it).');
      if (a.apply && a.version !== o.version) throw new HttpError(409, `The campaign changed (version ${a.version}, now ${o.version}): preview it again.`);
      const from = a.from ?? o.startDate;
      const to = a.to ?? o.endDate;
      const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
      if (days < 0) throw new HttpError(400, 'The last day is before the first day.');
      if (days >= MAX_BOOKING_DAYS) throw new HttpError(400, `Book at most ${MAX_BOOKING_DAYS} days at a time (${range(from, to)} is ${days + 1}).`);

      // the breaks
      const r = frameRate(o.channel.frameRate);
      let chosen = o.breaks;
      if (a.breaks) {
        const byName = new Map(o.breaks.map((b) => [b.name.toLowerCase(), b]));
        const unknown = a.breaks.filter((n) => !byName.has(n.trim().toLowerCase()));
        if (unknown.length) throw new HttpError(404, `No break ${unknown.slice(0, 5).map(quote).join(', ')} in this campaign's layout; get_campaign lists them.`);
        const names = new Set(a.breaks.map((n) => n.trim().toLowerCase()));
        chosen = chosen.filter((b) => names.has(b.name.toLowerCase()));
      }
      if (a.break_name_contains) chosen = chosen.filter((b) => b.name.toLowerCase().includes(a.break_name_contains!.trim().toLowerCase()));
      if (a.between) {
        const at = (s: string) => {
          const f = parseTc(s.trim(), r);
          if (f === null) throw new HttpError(400, `"${s}" is not a clock time (HH:MM).`);
          return offsetFromClock(f, o.channel.dayStartFrames, r);
        };
        const [lo, hi] = [at(a.between.from), at(a.between.to)];
        chosen = chosen.filter((b) => b.startFrames >= lo && b.startFrames <= hi);
      }
      if (!chosen.length) throw new HttpError(404, 'No break of this campaign fits that choice.');

      // the ads and the position
      const itemIds = (a.ads ?? o.items.map((x) => x.id)).map((ref) => {
        const v = /^v(\d+)$/i.exec(ref.trim());
        const item = v ? o.items[Number(v[1]) - 1] : o.items.find((x) => x.id === ref.trim());
        if (!item) throw new HttpError(404, `No ad ${quote(ref)} in this campaign; get_campaign lists V1, V2…`);
        return item.id;
      });
      if (!itemIds.length) throw new HttpError(409, 'The campaign has no ads to book.');
      let positionId: string | null = null;
      if (a.position) {
        const positions = await listBreakPositions();
        const hit = positions.find((x) => x.name.toLowerCase() === a.position!.trim().toLowerCase());
        if (!hit) throw new HttpError(404, `No break position ${quote(a.position)}: ${positions.map((x) => x.name).join(', ')}.`);
        positionId = hit.id;
      }
      const weekdays = SHORT_DAYS.map((d) => !a.weekdays || a.weekdays.includes(d));

      // what was booked there before (for undo), then the booking itself
      const before = a.apply
        ? (
            await db.airingItem.findMany({
              where: { airing: { orderId: o.id, date: { gte: fromIsoDate(from), lte: fromIsoDate(to) } } },
              include: { airing: { select: { date: true, blockTypeId: true } } },
            })
          ).map((i): BookingDto => ({ date: toIsoDate(i.airing.date), blockTypeId: i.airing.blockTypeId, breakTypeId: i.breakTypeId ?? '', orderItemId: i.orderItemId, positionId: i.positionId, passes: i.passes }))
        : [];
      const result = await bookSpots(o.id, {
        version: o.version, from, to, breakTypeIds: [...new Set(chosen.map((b) => b.breakTypeId))], weekdays, itemIds, spread: a.spread, positionId, passes: a.plays, apply: a.apply,
        nthInBlock: a.break_in_block ?? null,
      });
      const nth = a.break_in_block ? `${a.break_in_block}${['th', 'st', 'nd', 'rd'][a.break_in_block % 100 > 10 && a.break_in_block % 100 < 14 ? 0 : Math.min(a.break_in_block % 10, 4) % 4] ?? 'th'}` : null;

      const cr = frameRate(p.tenant.catalogFrameRate);
      const out = [
        `Campaign ${quote(o.name)} · ${o.channel.name} · ${range(from, to)} · version ${o.version}${a.apply ? '' : ' — preview, nothing is booked'}`,
        nth
          ? `Breaks: the ${nth} break of each block, day by day from the layout${chosen.length < o.breaks.length ? ` (among ${plural(chosen.length, 'chosen break')})` : ''}`
          : `Breaks: ${chosen.length} (${capped(chosen.map((b) => `${formatClock(b.startFrames, o.channel.dayStartFrames, r)} ${b.name}`), 'and more', 8).join(', ')})`,
        `Ads: ${itemIds.map((id) => `V${o.items.findIndex((x) => x.id === id) + 1}`).join(', ')} · ${a.spread === 'rotate' ? 'taking turns' : 'the first in every break'} · ${plural(a.plays, 'play')} each${positionId ? ` · position ${quote(a.position!)}` : ''}`,
        `${plural(result.added, 'spot')} ${a.apply ? 'booked' : 'to book'} (${formatTc(result.addedFrames, cr)}); ${plural(result.kept, 'break')} already booked by this campaign keep their spot.`,
      ];
      for (const s of result.skipped) out.push(`- ${WEEKDAYS[s.weekday]}s do not have ${plural(s.breakTypeIds.length, 'of these breaks', 'of these breaks')}.`);
      if (nth && result.noNth) out.push(`- ${plural(result.noNth, 'block')} on these days ${result.noNth === 1 ? 'has' : 'have'} no ${nth} break: nothing goes there.`);
      if (!a.apply) {
        if (!result.added) return [...out, 'Nothing would change.'].join('\n');
        out.push(`To book: book_campaign_spots with the same choice, apply: true and version ${o.version}.`);
        return { text: out.join('\n'), applyWith: { apply: true, version: o.version, from, to } };
      }
      out.push(`Campaign version now ${result.version}. Change id ${changeId} — ${UNDO_HINT}`);
      return {
        text: out.join('\n'),
        change: { targetId: o.id, channelIds: [o.channel.id], before: { bookings: before }, after: { campaignId: o.id, version: result.version, from, to } },
      };
    },
    'write',
  );

  tool(
    'undo_change',
    'Undo a change',
    'Put back what one applied change of a write tool made, by its change id — only while nobody has changed that day, layout, item, list, campaign or week since. Rotation lists keep the place the saves gave them.',
    z.object({ change: z.uuid().describe('The change id the write tool answered with.') }),
    async ({ change }) => {
      const e = await db.auditEvent.findFirst({ where: { id: change } });
      if (!e || (e.via !== 'mcp' && e.via !== 'agent') || !e.ok || !e.after || !UNDOABLE.has(e.action)) {
        throw new HttpError(404, `No change ${change} that can be undone: only changes a write tool applied.`);
      }
      const done = await db.auditEvent.findFirst({ where: { action: 'tool undo_change', ok: true, targetId: change } });
      if (done) throw new HttpError(409, `That change was undone already (change ${done.id}).`);
      const [module, action] = TOOL_GRANT[e.action.slice('tool '.length)] ?? ['playlist', 'edit'];
      if (!e.channelIds.length) demand(p.access, module, action);
      for (const ch of e.channelIds) demand(p.access, module, action, ch);
      const after = e.after as Record<string, unknown>;
      const before = (e.before ?? {}) as Record<string, unknown>;
      const changedSince = (what: string) => (err: unknown) => {
        if (err instanceof HttpError && err.status === 409) throw new HttpError(409, `${err.message}\nThe ${what} changed after that change, so undo would overwrite newer work: nothing was changed.`);
        throw err;
      };

      if (e.action === 'tool fill_day' || e.action === 'tool edit_day') {
        const dayId = after.dayId as string;
        const saved = await saveDay(dayId, { version: after.version as number, blocks: before.blocks as { id: string; rows: DraftRow[] }[] }).catch(changedSince('day'));
        const version = saved.day!.version;
        return {
          text: `${dayHead(saved)} is back as it was before change ${change} (now version ${version}). Rotation lists are not put back.`,
          change: { targetId: change, channelIds: e.channelIds, before: { dayId, version: after.version }, after: { dayId, version } },
        };
      }
      const more = await undoMore(e, change, changedSince as never);
      if (more) return more;
      const setup = await undoSetup(e, change, changedSince as never);
      if (setup) return setup;
      const plans = await undoPlans(e, change);
      if (plans) return plans;
      const ads = await undoAds(e, change);
      if (ads) return ads;
      const media = await undoMedia(e, change);
      if (media) return media;
      const week = await undoPlaylist(e, change, p.user.id);
      if (week) return week;
      if (e.action === 'tool book_campaign_spots' || e.action === 'tool remove_campaign_spots') {
        const campaignId = after.campaignId as string;
        const r = await saveCommercialWeek(campaignId, {
          version: after.version as number, from: after.from as string, to: after.to as string, bookings: before.bookings as BookingDto[],
        }).catch(changedSince('campaign'));
        return {
          text: `The campaign's bookings from ${range(after.from as string, after.to as string)} are back as they were before change ${change} (campaign version now ${r.version}).`,
          change: { targetId: change, channelIds: e.channelIds, before: { campaignId, version: after.version }, after: { campaignId, version: r.version } },
        };
      }
      // create_weeks: delete the weeks it made — all of them, or none when one is in use now
      const weekIds = after.weekIds as string[];
      const weeks = await db.week.findMany({ where: { id: { in: weekIds } }, select: { id: true } });
      const days = await db.dayPlaylist.findMany({
        where: { weekId: { in: weeks.map((w) => w.id) } },
        select: { date: true, published: true, reconciled: true, blocks: { select: { _count: { select: { events: { where: { kind: { notIn: [...STRUCTURAL_EVENT_KINDS] } } } } } } } },
      });
      const blockers = weekDeleteBlockers(
        days.map((d) => ({ date: toIsoDate(d.date), published: d.published, reconciled: d.reconciled, placedEvents: d.blocks.reduce((n, b) => n + b._count.events, 0) })),
      );
      if (blockers.length) throw new HttpError(409, `A week that change made is in use now: nothing was deleted.\n${blockers.map((b) => `- ${b.message}`).join('\n')}`);
      for (const w of weeks) await deleteWeek(w.id);
      const gone = weekIds.length - weeks.length;
      return {
        text: `Deleted ${plural(weeks.length, 'week')} that change ${change} made${gone ? ` (${gone} had been deleted already)` : ''}.`,
        change: { targetId: change, channelIds: e.channelIds, before: { weekIds: weeks.map((w) => w.id) }, after: { deleted: weeks.length } },
      };
    },
    'write',
  );

  registerChangeTools(tool, p);
  registerSetupTools(tool, p);
  registerPlanTools(tool, p);
  registerAdsTools(tool, p);
  registerMediaTools(tool, p);
  registerPlaylistTools(tool, p);
}

const UNDOABLE = new Set(Object.keys(TOOL_GRANT).map((t) => `tool ${t}`));
