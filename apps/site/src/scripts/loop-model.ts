// The check-and-fix loop on the home page: one sample run, three rounds, on a fictional channel.
// `cards` are the flow cards a line lights up: 0 check · 1 hand off · 2 fix · 3 check again · 4 ready · 5 operator.

export interface LoopLine { who: string; text: string; dot: string; cards: number[]; round: string }

export const LOOP: LoopLine[] = [
  { who: 'Playlist check agent', text: 'Round 1: checked 1,284 items on Sunday. 5 problems.', dot: '#d97706', cards: [0], round: 'Round 1' },
  { who: 'Timing agent', text: 'News at 19:00 would start 00:00:42:10 late. Fixed with a shorter segment.', dot: '#16a34a', cards: [1, 2], round: 'Round 1' },
  { who: 'Filler and bumper agent', text: 'A 00:00:18:00 gap after Matinee Movie. Filled with a bumper.', dot: '#16a34a', cards: [1, 2], round: 'Round 1' },
  { who: 'Ad placement agent', text: 'Two car brands in the 21:30 break. One spot moved to 21:58.', dot: '#16a34a', cards: [1, 2], round: 'Round 1' },
  { who: 'Promo placement agent', text: 'A Wildmere promo has no media file. Swapped for another cut.', dot: '#16a34a', cards: [1, 2], round: 'Round 1' },
  { who: 'Schedule agent', text: 'Kitchen Duel ep. 18: its rights end before Sunday. No fix within the rules.', dot: '#dc2626', cards: [1, 2], round: 'Round 1' },
  { who: 'Playlist check agent', text: 'Round 2: checked again. 1 problem left.', dot: '#d97706', cards: [3], round: 'Round 2' },
  { who: 'Operator notified', text: 'Ana R. got the problem, the reason and what was tried, and picked episode 17 instead.', dot: '#2563eb', cards: [5], round: 'Round 2' },
  { who: 'Playlist check agent', text: 'Round 3: checked again. Every check passes.', dot: '#16a34a', cards: [3, 4], round: 'Round 3' },
];

export function status(last: number): { text: string; color: string } {
  const line = LOOP[last];
  if (last === LOOP.length - 1) return { text: 'Ready for approval. Nothing goes to air with a known problem.', color: '#15803d' };
  if (line.who === 'Operator notified') return { text: 'The operator has it. The loop goes on after the change.', color: '#9a5200' };
  if (line.dot === '#dc2626') return { text: 'No fix within the rules. Telling the operator.', color: '#b91c1c' };
  return { text: `Working · ${line.round}`, color: '#52525b' };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function lineHtml(l: LoopLine, animate: boolean): string {
  return `<li${animate ? ' class="rise"' : ''}><i style="background:${l.dot}"></i><span><b>${esc(l.who)}</b><span>${esc(l.text)}</span></span></li>`;
}
