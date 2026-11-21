// Runs the SCTE-35 decoder: decodes as the visitor types or pastes. Nothing leaves the page; a shared
// link keeps the cue after "#", which browsers never send to the server.
import { EXAMPLES, decode, renderHtml, type Result } from './scte35-model';

const root = document.querySelector<HTMLElement>('[data-scte-tool]');
if (root) start(root);

function start(root: HTMLElement) {
  const part = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-part="${name}"]`)!;
  const input = part<HTMLTextAreaElement>('cue');
  const out = part<HTMLElement>('out');
  const copyJson = part<HTMLButtonElement>('copy-json');
  const copyLink = part<HTMLButtonElement>('copy-link');
  const examples = [...root.querySelectorAll<HTMLButtonElement>('[data-example]')];
  let result: Result = decode(input.value);

  function run() {
    result = decode(input.value);
    out.innerHTML = input.value.trim() ? renderHtml(result) : '';
    copyJson.disabled = copyLink.disabled = !result.ok;
    const cue = input.value.trim();
    for (const b of examples) b.setAttribute('aria-pressed', String(EXAMPLES.find((e) => e.id === b.dataset.example)?.cue === cue));
  }
  input.addEventListener('input', run);
  for (const b of examples) {
    b.addEventListener('click', () => {
      input.value = EXAMPLES.find((e) => e.id === b.dataset.example)?.cue ?? '';
      run();
    });
  }

  async function copy(button: HTMLButtonElement, text: string) {
    const label = button.dataset.label ?? (button.dataset.label = button.textContent ?? '');
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Could not copy';
    }
    setTimeout(() => (button.textContent = label), 1500);
  }
  copyJson.addEventListener('click', () => {
    if (result.ok) copy(copyJson, JSON.stringify(result.json, null, 2));
  });
  copyLink.addEventListener('click', () => copy(copyLink, `${location.origin}${location.pathname}#cue=${encodeURIComponent(input.value.trim())}`));

  const shared = location.hash.match(/^#cue=(.+)$/);
  if (shared) {
    try {
      input.value = decodeURIComponent(shared[1]);
    } catch {
      input.value = shared[1];
    }
    run();
  }
}
