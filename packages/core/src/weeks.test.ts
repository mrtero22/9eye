import { describe, expect, it } from 'vitest';
import { FRAME_RATES, minutesToFrames } from './timecode';
import {
  buildWeekDays,
  dayState,
  defaultWeekName,
  isoWeekNumber,
  planWeekRun,
  unmatchedBreaks,
  weekDeleteBlockers,
  weekStartsOfMonth,
  type WeekBlockSource,
  type WeekRunInput,
  type WeekTemplateInfo,
} from './index';

const R = FRAME_RATES['25'];
const min = (m: number) => minutesToFrames(m, R);
const ALL = [true, true, true, true, true, true, true];

const tpl = (id: string, validFrom = '2024-03-23', validTo = '2099-05-29', activeWeekdays = ALL): WeekTemplateInfo => ({ id, name: id.toUpperCase(), validFrom, validTo, activeWeekdays });

function run(over: Partial<WeekRunInput> = {}): WeekRunInput {
  return {
    weekStart: 6,
    today: '2026-11-11',
    fromWeek: '2026-11-21',
    toWeek: '2026-11-28',
    shortName: 'AURORA',
    playlists: [
      { kind: 'ads', playlistId: 'pa', templates: [tpl('ads')], existing: [] },
      { kind: 'main', playlistId: 'pm', templates: [tpl('main')], existing: [] },
    ],
    ...over,
  };
}

function block(weekday: number, type: string, startMin: number, breaks: string[] = []): WeekBlockSource {
  return { weekday, blockTypeId: type, startFrames: min(startMin), lengthFrames: min(60), fillGaps: true, opensWithBreak: false, note: '', rotationListId: null, limitsPerContentType: [], breaks };
}

describe('week numbers and names', () => {
  it('numbers a week by the ISO week of its first day, whatever weekday that is', () => {
    expect(isoWeekNumber('2026-08-15')).toBe(33); // Saturday, the captured reference week
    expect(isoWeekNumber('2026-11-07')).toBe(45);
    expect(isoWeekNumber('2026-11-14')).toBe(46);
    expect(isoWeekNumber('2026-01-01')).toBe(1);
    expect(isoWeekNumber('2027-01-02')).toBe(53); // Saturday of ISO week 53 of 2026
    expect(isoWeekNumber('2026-12-28')).toBe(53);
  });

  it('names a week after its number, year, channel and playlist, within 50 characters', () => {
    expect(defaultWeekName('2026-11-14', 'AURORA', 'main')).toBe('Week 46 2026 AURORA M');
    expect(defaultWeekName('2026-11-14', 'AURORA', 'ads')).toBe('Week 46 2026 AURORA Ads');
    const long = defaultWeekName('2026-11-14', 'A very long channel name that would never fit in fifty', 'ads');
    expect(long.length).toBeLessThanOrEqual(50);
    expect(long.endsWith(' Ads')).toBe(true);
  });

  it('gives a month the weeks whose first day is in it', () => {
    expect(weekStartsOfMonth(2026, 11, 6)).toEqual(['2026-11-07', '2026-11-14', '2026-11-21', '2026-11-28']);
    expect(weekStartsOfMonth(2026, 11, 1)).toEqual(['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30']);
    expect(weekStartsOfMonth(2026, 2, 0)).toEqual(['2026-02-01', '2026-02-08', '2026-02-15', '2026-02-22']);
  });
});

describe('create weeks', () => {
  it('plans every week of the run, main before ads', () => {
    const plan = planWeekRun(run());
    expect(plan.problems).toEqual([]);
    expect(plan.warnings).toEqual([]);
    expect(plan.weeks.map((w) => [w.firstDate, w.kind, w.name, w.templateId])).toEqual([
      ['2026-11-21', 'main', 'Week 47 2026 AURORA M', 'main'],
      ['2026-11-21', 'ads', 'Week 47 2026 AURORA Ads', 'ads'],
      ['2026-11-28', 'main', 'Week 48 2026 AURORA M', 'main'],
      ['2026-11-28', 'ads', 'Week 48 2026 AURORA Ads', 'ads'],
    ]);
    expect(plan.weeks[0]).toMatchObject({ lastDate: '2026-11-27', number: 47, activeWeekdays: ALL });
  });

  it('refuses dates that are not week starts, a run backwards and a run that is too long', () => {
    expect(planWeekRun(run({ fromWeek: '2026-11-22' })).problems.map((p) => p.code)).toEqual(['dates']);
    expect(planWeekRun(run({ fromWeek: '2026-11-28', toWeek: '2026-11-21' })).problems.map((p) => p.code)).toEqual(['dates']);
    expect(planWeekRun(run({ toWeek: '2027-11-27' })).problems.map((p) => p.code)).toEqual(['too-many']);
    expect(planWeekRun(run({ playlists: [] })).problems.map((p) => p.code)).toEqual(['no-playlist']);
    expect(planWeekRun(run({ activeWeekdays: [false, false, false, false, false, false, false] })).problems.map((p) => p.code)).toEqual(['active-days']);
  });

  it('never plans a week twice and lists every week that already exists', () => {
    const input = run();
    input.playlists[1].existing = ['2026-11-21', '2026-11-28'];
    const plan = planWeekRun(input);
    expect(plan.problems.map((p) => [p.code, p.kind, p.firstDate])).toEqual([
      ['exists', 'main', '2026-11-21'],
      ['exists', 'main', '2026-11-28'],
    ]);
    expect(plan.problems[0].message).toBe('Week 47 (21 Nov 2026) already exists in the main playlist.');
  });

  it('needs a layout whose dates hold the whole week', () => {
    const input = run();
    input.playlists[1].templates = [tpl('main', '2026-11-28', '2026-12-25')];
    expect(planWeekRun(input).problems.map((p) => [p.code, p.kind, p.firstDate])).toEqual([['no-template', 'main', '2026-11-21']]);
  });

  it('asks which layout when several fit, and takes the picked one', () => {
    const input = run();
    input.playlists[1].templates = [tpl('main'), tpl('dont-use')];
    expect(planWeekRun(input).problems.map((p) => p.code)).toEqual(['pick-template', 'pick-template']);
    input.playlists[1].templateId = 'main';
    const plan = planWeekRun(input);
    expect(plan.problems).toEqual([]);
    expect(plan.weeks.filter((w) => w.kind === 'main').map((w) => w.templateId)).toEqual(['main', 'main']);
    input.playlists[1].templateId = 'gone';
    expect(planWeekRun(input).problems.map((p) => p.code)).toEqual(['no-template', 'no-template']);
  });

  it('takes the layout’s active days unless the run sets its own', () => {
    const noFriday = [true, true, true, true, true, false, true];
    const input = run();
    input.playlists[1].templates = [tpl('main', '2024-03-23', '2099-05-29', noFriday)];
    expect(planWeekRun(input).weeks[0].activeWeekdays).toEqual(noFriday);
    const weekdaysOnly = [false, true, true, true, true, true, false];
    expect(planWeekRun({ ...input, activeWeekdays: weekdaysOnly }).weeks[0].activeWeekdays).toEqual(weekdaysOnly);
  });

  it('warns about weeks in the past without refusing them', () => {
    const plan = planWeekRun(run({ fromWeek: '2026-10-31', toWeek: '2026-11-07' }));
    expect(plan.problems).toEqual([]);
    expect(plan.warnings.map((w) => [w.code, w.firstDate])).toEqual([['past', '2026-10-31']]);
    expect(plan.weeks).toHaveLength(4);
  });
});

describe('the days of a new week', () => {
  const blocks = [block(6, 'run1', 0, ['sp1', 'ab1']), block(6, 'run2', 60), block(0, 'run1', 0, ['sp1']), block(5, 'fri', 0)];

  it('makes a day per active weekday with the layout’s blocks of that weekday', () => {
    const days = buildWeekDays('2026-11-21', [true, true, true, true, true, false, true], blocks, 'main');
    expect(days.map((d) => [d.date, d.weekday, d.blocks.length])).toEqual([
      ['2026-11-21', 6, 2],
      ['2026-11-22', 0, 1],
      ['2026-11-23', 1, 0],
      ['2026-11-24', 2, 0],
      ['2026-11-25', 3, 0],
      ['2026-11-26', 4, 0],
    ]);
  });

  it('starts every main block with its linked-break rows and one gap holder, all of length 0', () => {
    const [sat] = buildWeekDays('2026-11-21', ALL, blocks, 'main');
    expect(sat.blocks[0]).toMatchObject({ blockTypeId: 'run1', startFrames: 0, lengthFrames: min(60) });
    expect(sat.blocks[0].events).toEqual([
      { sequence: 0, kind: 'linked-break', breakTypeId: 'sp1', lengthFrames: 0 },
      { sequence: 1, kind: 'linked-break', breakTypeId: 'ab1', lengthFrames: 0 },
      { sequence: 2, kind: 'gap-compensator', breakTypeId: null, lengthFrames: 0 },
    ]);
    expect(sat.blocks[1].events).toEqual([{ sequence: 0, kind: 'gap-compensator', breakTypeId: null, lengthFrames: 0 }]);
  });

  it('leaves ads blocks empty', () => {
    const [sat] = buildWeekDays('2026-11-21', ALL, [block(6, 'sp1', 0)], 'ads');
    expect(sat.blocks[0].events).toEqual([]);
  });

  it('finds linked breaks with no ads block on that weekday', () => {
    const adsDays = [[{ blockTypeId: 'sp1', startFrames: 0, lengthFrames: min(5) }], [], [], [], [], [], [{ blockTypeId: 'sp1', startFrames: 0, lengthFrames: min(5) }]];
    expect(unmatchedBreaks(blocks, adsDays, ALL)).toEqual([{ weekday: 6, startFrames: 0, breakTypeId: 'ab1' }]);
    expect(unmatchedBreaks(blocks, adsDays, [true, true, true, true, true, true, false])).toEqual([]);
  });
});

describe('deleting a week', () => {
  it('is refused while a day is approved, reconciled or holds placed events', () => {
    const day = (date: string, over: object = {}) => ({ date, published: false, reconciled: false, placedEvents: 0, ...over });
    expect(weekDeleteBlockers([day('2026-11-21'), day('2026-11-22')])).toEqual([]);
    expect(
      weekDeleteBlockers([day('2026-11-23', { placedEvents: 3 }), day('2026-11-21', { published: true, reconciled: true }), day('2026-11-22', { published: true })]).map((b) => b.message),
    ).toEqual(['Sat 21 Nov 2026 is reconciled.', 'Sun 22 Nov 2026 is approved.', 'Mon 23 Nov 2026 holds 3 placed events.']);
    expect(dayState({ published: true, reconciled: false })).toBe('published');
    expect(dayState({ published: true, reconciled: true })).toBe('reconciled');
    expect(dayState({ published: false, reconciled: false })).toBe('draft');
  });
});
