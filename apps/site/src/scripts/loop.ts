// Plays the check-and-fix loop: one log line every 1.2 s, the flow cards it touches light up,
// a pause at the end, then again. Only while the section is on screen.
import { LOOP, lineHtml, status } from './loop-model';

const root = document.querySelector<HTMLElement>('[data-loop]');
if (root && !matchMedia('(prefers-reduced-motion: reduce)').matches) start(root);

function start(root: HTMLElement) {
  const list = root.querySelector<HTMLElement>('[data-part="lines"]')!;
  const round = root.querySelector<HTMLElement>('[data-part="round"]')!;
  const state = root.querySelector<HTMLElement>('[data-part="status"]')!;
  const cards = [...root.querySelectorAll<HTMLElement>('[data-card]')];
  const STEP = 6;
  const cycle = LOOP.length * STEP + 25;
  let t = 0;
  let count = 0;
  list.innerHTML = '';

  function render() {
    const shown = Math.min(LOOP.length, Math.floor((t % cycle) / STEP) + 1);
    if (shown < count) { list.innerHTML = ''; count = 0; }
    if (shown > count) {
      list.insertAdjacentHTML('beforeend', LOOP.slice(count, shown).map((l) => lineHtml(l, true)).join(''));
      count = shown;
    }
    const last = LOOP[shown - 1];
    for (const card of cards) card.classList.toggle('is-on', last.cards.includes(Number(card.dataset.card)));
    round.textContent = last.round;
    const s = status(shown - 1);
    state.textContent = s.text;
    state.style.color = s.color;
  }

  let onScreen = false;
  new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; }).observe(root);
  render();
  setInterval(() => {
    if (!onScreen || document.hidden) return;
    t += 1;
    render();
  }, 200);
}
