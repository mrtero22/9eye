// The live agent desk on the home page: sample scenarios and their state, rendered as HTML strings.
// Used twice: at build time for the first paint (and visitors without JavaScript), then in the browser,
// where desk.ts advances the state five times a second. Sample data only (a fictional channel).

export type Result = 'approved' | 'rejected' | null;
export type Phase = 'running' | 'waiting' | 'approved' | 'rejected';

export interface LogEntry { text: string; at: string; dot: string }

export interface DeskState {
  sc: number;
  /** Ticks (200 ms) since the scenario started. */
  n: number;
  /** The on-air clock in frames at 25 fps. */
  frames: number;
  startFrames: number;
  result: Result;
  doneAt: number;
  decidedFrames: number;
  liveFixed: boolean;
  log: LogEntry[];
}

interface Scenario {
  id: string;
  agent: string;
  color: string;
  tryLabel: string;
  channel: string;
  trigger: string;
  idleGroup: 'Idle' | 'Scheduled';
  idleSub: string;
  steps: [string, string][];
  changes: [string, string, string][];
  metric: [string, string, string];
}

const FPS = 25;
const TICKS_PER_STEP = 5;
const TICKS_BEFORE_AUTO_APPROVE = 15;
const TICKS_AFTER_DECISION = 20;
export const START = ((18 * 60 + 52) * 60 + 10) * FPS;

export const SCENARIOS: Scenario[] = [
  {
    id: 'live', agent: 'Live-change agent', color: '#ea580c', tryLabel: 'Sport runs 18 min over',
    channel: 'Tessa One · Sat 14 Nov', trigger: 'Started by a rule: overrun reported by playout',
    idleGroup: 'Idle', idleSub: 'Waits for live changes',
    steps: [
      ['Playout', 'Weekend Sport will end at 19:18:00:00, 18 min late'],
      ['Playlist', 'Read Saturday from 19:00 to the end of the day'],
      ['Playlist', 'News and Weather moves to 19:18:00:00'],
      ['Orders', 'Kitchen Duel ep. 17 moves to Sun 13:00, a free block'],
      ['Ads playlist', '6 spots move from the 19:30 break to 19:48'],
      ['Timing', 'Saturday Movie keeps its fixed start at 20:00:00:00'],
    ],
    changes: [
      ['News and Weather', '19:00:00:00', '19:18:00:00'],
      ['Kitchen Duel ep. 17', 'Sat 19:35', 'Sun 13:00'],
      ['Break · 6 spots', '19:30:10:00', '19:48:10:00'],
      ['Saturday Movie', '20:18:00:00', '20:00:00:00'],
    ],
    metric: ['Saturday Movie starts', '20:18:00:00', '20:00:00:00'],
  },
  {
    id: 'timing', agent: 'Timing agent', color: '#0d9488', tryLabel: 'Check Sunday’s timing',
    channel: 'Tessa One · Sun 15 Nov', trigger: 'Scheduled: every evening',
    idleGroup: 'Scheduled', idleSub: 'Every evening',
    steps: [
      ['Playlist', 'Read Sunday, 06:00 to 06:00'],
      ['Timing', 'Checked 12 fixed starts: one is late'],
      ['Timing', 'News at 19:00 would start 00:01:12:08 late'],
      ['Catalog', 'Sunday Magazine: shorter segmentation, −00:00:58:00'],
      ['Rotation list', 'Dropped a 00:00:14:08 filler from the 18:56 break'],
      ['Timing', 'All 12 fixed starts land on the frame'],
    ],
    changes: [
      ['Sunday Magazine', '01:58:00:00', '01:57:02:00'],
      ['Filler · 18:56 break', '00:00:14:08', 'Removed'],
      ['News and Weather', '19:01:12:08', '19:00:00:00'],
    ],
    metric: ['Fixed starts on time', '11 of 12', '12 of 12'],
  },
  {
    id: 'ads', agent: 'Ad placement agent', color: '#2563eb', tryLabel: 'Place Sunday’s ads',
    channel: 'Tessa One · Sun 15 Nov', trigger: 'Started by Ana R.',
    idleGroup: 'Idle', idleSub: 'Last run 09:12',
    steps: [
      ['Orders', 'Read 214 booked spots for Sunday'],
      ['Ads playlist', 'Placed 198 spots in 46 breaks'],
      ['Rules', 'Alcohol spots kept after 21:00 (9 spots)'],
      ['Rules', 'Clash codes apart in every break'],
      ['Ads playlist', '16 spots do not fit: their breaks are full'],
      ['Orders', 'Proposed Monday breaks for the 16 spots'],
    ],
    changes: [
      ['Spots placed', '0', '198'],
      ['Spots proposed for Monday', '0', '16'],
      ['Clash-code conflicts', '—', '0'],
    ],
    metric: ['Spots placed', '0 of 214', '198 of 214'],
  },
];

const OTHER_AGENTS: [string, string, 'Scheduled' | 'Idle', string][] = [
  ['Promo placement agent', '#7c3aed', 'Scheduled', 'Daily at 05:00'],
  ['Filler and bumper agent', '#db2777', 'Scheduled', 'After every change'],
  ['Playlist check agent', '#16a34a', 'Scheduled', 'Daily at 22:00'],
  ['Schedule agent', '#0284c7', 'Idle', 'Planned week 46'],
  ['Reconciliation agent', '#64748b', 'Idle', '3 notes on Friday'],
];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function tc(frames: number, withFrames: boolean): string {
  const p = (v: number) => String(v).padStart(2, '0');
  const h = Math.floor(frames / (FPS * 3600)) % 24;
  const m = Math.floor(frames / (FPS * 60)) % 60;
  const s = Math.floor(frames / FPS) % 60;
  return `${p(h)}:${p(m)}:${p(s)}${withFrames ? ':' + p(frames % FPS) : ''}`;
}

export function initialState(showAll = false): DeskState {
  return {
    sc: 0, n: showAll ? 1000 : 0, frames: START, startFrames: START, result: null, doneAt: 0, decidedFrames: START, liveFixed: false,
    log: [
      { text: 'Schedule agent planned week 46', at: 'Fri 16:20', dot: '#16a34a' },
      { text: 'Reconciliation agent matched Friday’s as-run', at: '06:10', dot: '#16a34a' },
    ],
  };
}

function shownSteps(s: DeskState): number {
  return Math.min(SCENARIOS[s.sc].steps.length, Math.floor(s.n / TICKS_PER_STEP));
}

export function phaseOf(s: DeskState): Phase {
  if (shownSteps(s) < SCENARIOS[s.sc].steps.length) return 'running';
  return s.result ?? 'waiting';
}

export function decide(s: DeskState, r: 'approved' | 'rejected', n = s.n, frames = s.frames): DeskState {
  if (s.result !== null || phaseOf(s) !== 'waiting') return s;
  const cur = SCENARIOS[s.sc];
  const entry = { text: `${cur.agent}: changes ${r === 'approved' ? 'applied' : 'rejected'}`, at: tc(frames, false), dot: r === 'approved' ? '#16a34a' : '#a1a1aa' };
  return { ...s, n, frames, result: r, doneAt: n, decidedFrames: frames, log: [...s.log, entry].slice(-30), liveFixed: s.liveFixed || (cur.id === 'live' && r === 'approved') };
}

export function pick(s: DeskState, sc: number, showAll = false): DeskState {
  return { ...s, sc, n: showAll ? 1000 : 0, result: null, doneAt: 0, startFrames: s.frames, liveFixed: sc === 0 ? false : s.liveFixed };
}

/** One 200 ms step: the clock moves 5 frames, steps appear, the demo approves itself, then moves on. */
export function tick(s: DeskState): DeskState {
  const cur = SCENARIOS[s.sc];
  const n = s.n + 1;
  const frames = s.frames + FPS / TICKS_PER_STEP;
  if (s.result === null && n >= cur.steps.length * TICKS_PER_STEP + TICKS_BEFORE_AUTO_APPROVE) return decide({ ...s, n }, 'approved', n, frames);
  if (s.result !== null && n >= s.doneAt + TICKS_AFTER_DECISION) {
    const sc = (s.sc + 1) % SCENARIOS.length;
    return { ...s, sc, n: 0, frames, startFrames: frames, result: null, doneAt: 0, liveFixed: sc === 0 ? false : s.liveFixed };
  }
  return { ...s, n, frames };
}

const glyph = (color: string, size: number) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="12" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8.3 7.1 15.7 10.9M8.3 16.9l7.4-3.8"/></svg>`;

const BADGES: Record<Phase, [string, string, string]> = {
  running: ['Running', '#eaf1ff', '#1d4ed8'],
  waiting: ['Needs you', '#fdf4e3', '#9a5200'],
  approved: ['Applied', '#e8f6ec', '#15803d'],
  rejected: ['Rejected', '#f4f4f5', '#52525b'],
};

export interface DeskView {
  list: string;
  runHead: string;
  steps: string[];
  working: boolean;
  changes: string;
  airTc: string;
  airBar: string;
  playhead: string;
  airNote: string;
  metric: string;
  log: string[];
  summary: string;
  pressed: number;
  stepsKey: string;
}

export function view(s: DeskState, showAll = false): DeskView {
  const cur = SCENARIOS[s.sc];
  const phase = phaseOf(s);
  const shown = shownSteps(s);
  const total = cur.steps.length;

  type Row = { group: string; name: string; color: string; sub: string; subColor: string; dot: string; active: boolean; pick: number | null };
  const rows: Row[] = SCENARIOS.map((x, i): Row => {
    if (i !== s.sc) return { group: x.idleGroup, name: x.agent, color: x.color, sub: x.idleSub, subColor: '#6b6b74', dot: x.idleGroup === 'Scheduled' ? '#a1a1aa' : '#d4d4d8', active: false, pick: i };
    const sub = phase === 'running' ? `Step ${shown + 1} of ${total}` : phase === 'waiting' ? `${x.changes.length} changes to approve` : phase === 'approved' ? 'Applied just now' : 'Rejected just now';
    return {
      group: phase === 'running' ? 'Running' : phase === 'waiting' ? 'Needs you' : 'Idle',
      name: x.agent, color: x.color, sub, subColor: phase === 'waiting' ? '#9a5200' : '#6b6b74',
      dot: phase === 'running' ? '#2563eb' : phase === 'waiting' ? '#d97706' : '#16a34a', active: true, pick: i,
    };
  });
  for (const [name, color, group, sub] of OTHER_AGENTS) rows.push({ group, name, color, sub, subColor: '#6b6b74', dot: group === 'Scheduled' ? '#a1a1aa' : '#d4d4d8', active: false, pick: null });

  const rowHtml = (r: Row) => {
    const inner = `<span class="dk-glyph" style="background:${r.color}1f">${glyph(r.color, 16)}<span class="dk-status" style="background:${r.dot}"></span></span><span class="dk-row__text"><b>${esc(r.name)}</b><small style="color:${r.subColor}">${esc(r.sub)}</small></span>`;
    return r.pick === null
      ? `<div class="dk-row is-static">${inner}</div>`
      : `<button type="button" class="dk-row${r.active ? ' is-active' : ''}" data-pick="${r.pick}" aria-pressed="${r.active}">${inner}</button>`;
  };
  const list = ['Needs you', 'Running', 'Scheduled', 'Idle']
    .map((g) => ({ g, items: rows.filter((r) => r.group === g) }))
    .filter((x) => x.items.length)
    .map((x) => `<div class="dk-group"><span>${x.g}</span><b>${x.items.length}</b></div>${x.items.map(rowHtml).join('')}`)
    .join('');

  const [badge, badgeBg, badgeFg] = BADGES[phase];
  const progress = phase === 'running' ? `Step ${shown + 1} of ${total}` : phase === 'waiting' ? `${total} of ${total} done` : '';
  const runHead = `<span class="dk-glyph" style="width:32px;height:32px;background:${cur.color}1f">${glyph(cur.color, 18)}</span><span class="dk-run__who"><span><b>${esc(cur.agent)}</b><span class="dk-badge" style="background:${badgeBg};color:${badgeFg}">${badge}</span></span><span>${esc(cur.channel)} · ${esc(cur.trigger)}</span></span><span class="dk-progress">${progress}</span>`;

  const check = '<span class="dk-check"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg></span>';
  const steps = cur.steps.slice(0, shown).map(([tag, text], k) =>
    `<li class="dk-step rise">${check}<span class="dk-tag">${esc(tag)}</span><span class="dk-step__text">${esc(text)}</span><span class="dk-time">${tc(s.startFrames + (k + 1) * FPS, false)}</span></li>`);

  let changes = '';
  if (phase !== 'running') {
    const rowsHtml = cur.changes.map(([what, from, to]) => `<div class="dk-change"><span>${esc(what)}</span><span class="from">${esc(from)}</span><span class="arrow" aria-hidden="true">→</span><span class="to">${esc(to)}</span></div>`).join('');
    let foot: string;
    if (phase === 'waiting') {
      const left = Math.max(1, Math.ceil((total * TICKS_PER_STEP + TICKS_BEFORE_AUTO_APPROVE - s.n) / TICKS_PER_STEP));
      foot = `<div class="dk-actions"><button type="button" class="dk-action dk-action--primary" data-decide="approved">Approve</button><button type="button" class="dk-action" disabled>Review</button><button type="button" class="dk-action dk-action--danger" data-decide="rejected">Reject</button>${showAll ? '' : `<span class="dk-countdown">The demo approves in ${left} s</span>`}</div>`;
    } else if (phase === 'approved') {
      foot = `<div class="dk-result rise" style="background:#e8f6ec;color:#15803d">Applied at ${tc(s.decidedFrames, false)}<u>Undo</u></div>`;
    } else {
      foot = '<div class="dk-result rise" style="background:#f4f4f5;color:#52525b">Rejected. Nothing changed.</div>';
    }
    changes = `<div class="dk-changes__title"><b>Changes</b><span>${cur.changes.length} changes</span></div><div class="dk-table">${rowsHtml}</div>${foot}`;
  }

  const from = 17 * 60, span = 4 * 60;
  const seg = (name: string, a: number, z: number, bg: string, fg: string) =>
    `<span class="dk-seg" style="left:${(((a - from) / span) * 100).toFixed(2)}%;width:${(((z - a) / span) * 100).toFixed(2)}%;background:${bg};color:${fg}">${esc(name)}</span>`;
  const liveOpen = s.sc === 0 && (phase === 'running' || phase === 'waiting');
  const bar = s.liveFixed
    ? seg('Weekend Sport', 1020, 1158, '#16a34a2e', '#15803d') + seg('News', 1158, 1200, '#2563eb2e', '#1d4ed8') + seg('Saturday Movie', 1200, 1260, '#d977062e', '#9a5200')
    : liveOpen
      ? seg('Weekend Sport', 1020, 1140, '#16a34a2e', '#15803d') + seg('+18:00', 1140, 1158, 'repeating-linear-gradient(135deg,#fecaca 0 4px,#fdeeee 4px 8px)', '#b91c1c') + seg('News', 1158, 1218, '#2563eb2e', '#1d4ed8') + seg('Movie', 1218, 1260, '#dc26262e', '#b91c1c')
      : seg('Weekend Sport', 1020, 1140, '#16a34a2e', '#15803d') + seg('News', 1140, 1200, '#2563eb2e', '#1d4ed8') + seg('Saturday Movie', 1200, 1260, '#d977062e', '#9a5200');
  const playhead = Math.min(100, Math.max(0, ((s.frames / (FPS * 60) - from) / span) * 100)).toFixed(2) + '%';
  const note = liveOpen ? ['Weekend Sport runs 18 min over. Saturday Movie would start at 20:18.', '#9a5200']
    : s.liveFixed ? ['Re-flowed. Saturday Movie starts on time at 20:00.', '#15803d'] : ['Weekend Sport is live until 19:00.', '#52525b'];
  const airNote = `<span style="color:${note[1]}">${note[0]}</span>`;

  const [label, before, after] = cur.metric;
  const shownAfter = phase === 'running' ? '…' : phase === 'rejected' ? before : after;
  const afterColor = phase === 'approved' ? '#15803d' : phase === 'waiting' ? '#18181b' : '#a1a1aa';
  const metricNote: Record<Phase, [string, string]> = { running: ['Working', '#6b6b74'], waiting: ['Proposed · waiting for you', '#9a5200'], approved: ['Applied', '#15803d'], rejected: ['Nothing changed', '#6b6b74'] };
  const metric = `<span class="dk-metric__label">${esc(label)}</span><span class="dk-metric__values"><s>${esc(before)}</s><span class="arrow" aria-hidden="true">→</span><b style="color:${afterColor}">${esc(shownAfter)}</b></span><span class="dk-note" style="color:${metricNote[phase][1]}">${metricNote[phase][0]}</span>`;

  const log = s.log.map((e) => `<div class="dk-log__item rise"><i style="background:${e.dot}"></i><span>${esc(e.text)}<small>${esc(e.at)}</small></span></div>`);

  return {
    list, runHead, steps, working: phase === 'running', changes, metric, log,
    airTc: tc(s.frames, true), airBar: bar, playhead, airNote,
    summary: phase === 'waiting' ? '8 agents · 1 needs you' : '8 agents',
    pressed: s.sc,
    stepsKey: `${s.sc}:${s.startFrames}`,
  };
}
