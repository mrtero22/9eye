// Runs the ad break calculator: every part recalculates as the visitor types. Nothing leaves the page.
import { SPOT_LENGTHS, fill, fillHtml, inventory, inventoryHtml, readClock, readDuration, slot, slotHtml } from './ad-break-model';

const root = document.querySelector<HTMLElement>('[data-ad-tool]');
if (root) start(root);

function start(root: HTMLElement) {
  const input = (name: string) => root.querySelector<HTMLInputElement>(`[data-part="${name}"]`)!;
  const out = (name: string) => root.querySelector<HTMLElement>(`[data-out="${name}"]`)!;
  const n = (name: string) => Number(input(name).value.replace(',', '.'));

  function stock() {
    out('inventory').innerHTML = inventoryHtml(inventory({
      minutesPerHour: n('i-min'), hoursPerDay: n('i-hours'), daysPerWeek: n('i-days'),
      spotSeconds: n('i-spot'), sellOut: n('i-sold'), price: n('i-price') || 0,
    }));
  }

  function plan() {
    const start = readClock(input('s-start').value);
    out('slot').innerHTML = start === undefined
      ? slotHtml({ error: 'Type the start as a time, for example 20:00 or 20:00:00.' })
      : slotHtml(slot({ start, slotMinutes: n('s-len'), adMinutes: n('s-ads'), promoMinutes: n('s-promo'), breaks: n('s-breaks'), breakAtEnd: input('s-end').checked }));
  }

  function spots() {
    const length = readDuration(input('f-len').value);
    if ('error' in length) {
      out('fill').innerHTML = fillHtml(length);
      return;
    }
    const counts: Record<number, number> = {};
    for (const l of SPOT_LENGTHS) counts[l] = n(`f-${l}`) || 0;
    out('fill').innerHTML = fillHtml(fill(length.seconds, counts));
  }

  const watch = (prefix: string, run: () => void) => {
    for (const el of root.querySelectorAll<HTMLInputElement>(`[data-part^="${prefix}-"]`)) el.addEventListener('input', run);
  };
  watch('i', stock);
  watch('s', plan);
  watch('f', spots);
}
