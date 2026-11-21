// Runs the timecode calculator: every field recalculates as the visitor types. Nothing leaves the page.
import { changeRate, count, rateById, readFrames, readTimecode, realTime, tc, type Read } from './timecode-model';

const root = document.querySelector<HTMLElement>('[data-tc-tool]');
if (root) start(root);

function start(root: HTMLElement) {
  const el = <T extends HTMLElement = HTMLElement>(name: string) => root.querySelector<T>(`[data-part="${name}"]`)!;
  const input = (name: string) => el<HTMLInputElement>(name);
  const select = (name: string) => el<HTMLSelectElement>(name);

  function say(name: string, text: string, error = false) {
    const note = el(name);
    note.textContent = text;
    note.hidden = !text;
    note.classList.toggle('notice--red', error);
    note.classList.toggle('notice--amber', !error);
  }

  // 1 · Timecode and frames: typing in one fills the other; a new frame rate keeps the timecode.
  let last: 'tc' | 'frames' = 'tc';
  function convert() {
    const r = rateById(select('c-rate').value);
    const read: Read = last === 'tc' ? readTimecode(input('c-tc').value, r) : readFrames(input('c-frames').value);
    if ('error' in read) {
      say('c-note', read.error, true);
      el('c-real').textContent = '–';
      return;
    }
    if (last === 'tc') input('c-frames').value = String(read.frames);
    else input('c-tc').value = tc(read.frames, r);
    el('c-real').textContent = realTime(read.frames, r);
    say('c-note', read.note);
  }
  input('c-tc').addEventListener('input', () => { last = 'tc'; convert(); });
  input('c-frames').addEventListener('input', () => { last = 'frames'; convert(); });
  select('c-rate').addEventListener('change', convert);

  // 2 · Add or subtract.
  let op: 1 | -1 = 1;
  const ops = [...root.querySelectorAll<HTMLButtonElement>('[data-op]')];
  function sum() {
    const r = rateById(select('s-rate').value);
    const a = readTimecode(input('s-a').value, r);
    const b = readTimecode(input('s-b').value, r);
    if ('error' in a || 'error' in b) {
      say('s-note', 'error' in a ? a.error : 'error' in b ? b.error : '', true);
      el('s-tc').textContent = '–';
      el('s-meta').textContent = '';
      return;
    }
    const frames = a.frames + op * b.frames;
    say('s-note', a.note || b.note);
    el('s-tc').textContent = tc(frames, r);
    el('s-meta').textContent = `${count(frames)} frames · real time ${realTime(frames, r)}`;
  }
  for (const b of ops) {
    b.addEventListener('click', () => {
      op = b.dataset.op === '-' ? -1 : 1;
      for (const o of ops) o.setAttribute('aria-pressed', String(o === b));
      sum();
    });
  }
  for (const name of ['s-a', 's-b']) input(name).addEventListener('input', sum);
  select('s-rate').addEventListener('change', sum);

  // 3 · Change frame rate, keeping the real time.
  function change() {
    const from = rateById(select('r-from').value);
    const to = rateById(select('r-to').value);
    const read = readTimecode(input('r-tc').value, from);
    if ('error' in read) {
      say('r-note', read.error, true);
      el('r-tc-out').textContent = '–';
      el('r-meta').textContent = '';
      return;
    }
    const out = changeRate(read.frames, from, to);
    say('r-note', read.note);
    el('r-tc-out').textContent = tc(out.frames, to);
    const rounded = out.frames === out.exact ? '' : ` (${out.exact.toFixed(2)}, rounded)`;
    el('r-meta').textContent = `${count(out.frames)} frames${rounded} · real time ${realTime(out.frames, to)}`;
  }
  input('r-tc').addEventListener('input', change);
  select('r-from').addEventListener('change', change);
  select('r-to').addEventListener('change', change);
}
