// Runs the live agent desk: scales the 1200 × 720 picture to its frame, advances the sample scenarios
// while the desk is on screen, and lets the visitor pick a scenario, approve or reject.
import { decide, initialState, pick, tick, view, type DeskState } from './desk-model';

const root = document.querySelector<HTMLElement>('[data-desk]');
if (root) start(root);

function start(root: HTMLElement) {
  const frame = root.querySelector<HTMLElement>('.desk-frame')!;
  const desk = root.querySelector<HTMLElement>('.desk')!;
  const part = (name: string) => root.querySelector<HTMLElement>(`[data-part="${name}"]`)!;
  const html = {
    list: part('list'), runHead: part('run-head'), changes: part('changes'), airBar: part('air-bar'),
    airNote: part('air-note'), metric: part('metric'),
  };
  const steps = part('steps');
  const log = part('log');
  const airTc = part('air-tc');
  const playhead = part('playhead');
  const summary = part('summary');
  const tries = [...root.querySelectorAll<HTMLButtonElement>('[data-try]')];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  new ResizeObserver(() => desk.style.setProperty('--desk-scale', String(frame.clientWidth / 1200))).observe(frame);

  let state: DeskState = initialState(reduced);
  const shown: Record<string, string> = {};
  let stepsKey = '';
  let stepCount = 0;
  let logCount = 0;
  log.innerHTML = '';

  function render() {
    const v = view(state, reduced);
    for (const key of Object.keys(html) as (keyof typeof html)[]) {
      if (shown[key] === v[key]) continue;
      shown[key] = v[key];
      html[key].innerHTML = v[key];
    }
    html.changes.hidden = v.changes === '';
    airTc.textContent = v.airTc;
    playhead.style.left = v.playhead;
    summary.textContent = v.summary;
    tries.forEach((b, i) => b.setAttribute('aria-pressed', String(i === v.pressed)));

    // Steps and the activity log only grow: new lines are appended so earlier ones keep still.
    if (v.stepsKey !== stepsKey || v.steps.length < stepCount) {
      stepsKey = v.stepsKey;
      stepCount = 0;
      steps.innerHTML = '';
    }
    if (v.steps.length > stepCount) {
      steps.querySelector('.dk-working')?.remove();
      steps.insertAdjacentHTML('beforeend', v.steps.slice(stepCount).join(''));
      stepCount = v.steps.length;
    }
    const working = steps.querySelector('.dk-working');
    if (v.working && !working) steps.insertAdjacentHTML('beforeend', '<li class="dk-step dk-working"><span class="dk-spin"></span>Working on the next step…</li>');
    if (!v.working && working) working.remove();

    if (v.log.length < logCount) { log.innerHTML = ''; logCount = 0; }
    if (v.log.length > logCount) {
      log.insertAdjacentHTML('beforeend', v.log.slice(logCount).join(''));
      logCount = v.log.length;
    }
  }

  root.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-pick],[data-try],[data-decide]');
    if (!target) return;
    if (target.dataset.decide) state = decide(state, target.dataset.decide as 'approved' | 'rejected');
    else state = pick(state, Number(target.dataset.pick ?? target.dataset.try), reduced);
    render();
  });

  render();
  if (reduced) return;

  let onScreen = false;
  new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; }).observe(frame);
  setInterval(() => {
    if (!onScreen || document.hidden) return;
    state = tick(state);
    render();
  }, 200);
}
