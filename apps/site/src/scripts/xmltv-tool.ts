// Runs the XMLTV EPG checker: on pasted text as the visitor types, or on a dropped or chosen file
// (.xml or .xml.gz). Nothing leaves the page; .gz files are unpacked by the browser itself.
import { EXAMPLE, check, problemsHtml, renderHtml, reportCsv, reportText, type Report } from './xmltv-model';

const SHOWN = 300_000;

const root = document.querySelector<HTMLElement>('[data-xmltv-tool]');
if (root) start(root);

/** Reads a guide file: unpacks gzip, then decodes with the encoding its <?xml …?> line names. */
async function readFile(file: File): Promise<string> {
  let bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) throw new Error('This is a .zip file. Unpack it, then drop the .xml file inside.');
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      throw new Error('This .gz file could not be unpacked. It may be damaged or cut off: download it again.');
    }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 300));
  const name = head.match(/^\s*<\?xml[^>]*encoding\s*=\s*["']([\w.:-]+)["']/)?.[1];
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(name || 'utf-8');
  } catch {
    decoder = new TextDecoder('utf-8');
  }
  return decoder.decode(bytes);
}

const size = (bytes: number) => (bytes < 1e6 ? `${Math.max(1, Math.round(bytes / 1e3))} KB` : `${(bytes / 1e6).toFixed(1)} MB`);
const frame = () => new Promise((done) => setTimeout(done, 30));

function start(root: HTMLElement) {
  const part = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-part="${name}"]`)!;
  const input = part<HTMLTextAreaElement>('input');
  const file = part<HTMLInputElement>('file');
  const drop = part<HTMLElement>('drop');
  const minGap = part<HTMLInputElement>('min-gap');
  const out = part<HTMLElement>('out');
  const status = part<HTMLElement>('status');
  const copy = part<HTMLButtonElement>('copy');
  const csv = part<HTMLButtonElement>('csv');
  const placeholder = input.placeholder;

  let text = input.value;
  let name = 'example.xml';
  let about = 'The example guide';
  let report: Report = check(text);
  let timer = 0;

  const gap = () => {
    const n = Math.round(Number(minGap.value));
    return Number.isFinite(n) && n >= 1 ? n : 1;
  };

  function run() {
    clearTimeout(timer);
    if (!text.trim()) {
      out.innerHTML = '';
      status.textContent = '';
      copy.disabled = csv.disabled = true;
      return;
    }
    const t0 = performance.now();
    report = check(text, { minGap: gap() });
    out.innerHTML = renderHtml(report);
    const seconds = (performance.now() - t0) / 1000;
    status.textContent = `${about} · checked in ${seconds < 0.1 ? 'under 0.1' : seconds.toFixed(1)} s`;
    copy.disabled = csv.disabled = !report.ok;
  }

  function show(error: string) {
    const p = document.createElement('p');
    p.className = 'notice notice--red';
    p.setAttribute('role', 'alert');
    p.textContent = error;
    out.replaceChildren(p);
    status.textContent = '';
    copy.disabled = csv.disabled = true;
  }

  async function load(f: File) {
    status.textContent = `Reading ${f.name} (${size(f.size)})…`;
    out.setAttribute('aria-busy', 'true');
    await frame();
    try {
      text = await readFile(f);
    } catch (e) {
      text = '';
      show(`${f.name}: ${e instanceof Error ? e.message : 'the file could not be read.'}`);
      out.removeAttribute('aria-busy');
      return;
    }
    name = f.name;
    about = `${f.name} (${size(f.size)})`;
    input.value = text.length <= SHOWN ? text : '';
    input.placeholder = text.length <= SHOWN ? placeholder : `${f.name} is too long to show here. It was checked in full; paste here to check something else.`;
    status.textContent = `Checking ${about}…`;
    await frame();
    run();
    out.removeAttribute('aria-busy');
  }

  input.addEventListener('input', () => {
    text = input.value;
    name = 'xmltv';
    about = 'Pasted guide';
    input.placeholder = placeholder;
    clearTimeout(timer);
    timer = window.setTimeout(run, text.length > 1e6 ? 600 : 250);
  });
  minGap.addEventListener('change', run);
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (f) load(f);
    file.value = '';
  });

  // Drop anywhere on the tool, so a file dropped on the text box is checked rather than opened.
  let depth = 0;
  root.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    depth++;
    drop.classList.add('is-over');
  });
  root.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
  });
  root.addEventListener('dragleave', () => {
    if (--depth <= 0) {
      depth = 0;
      drop.classList.remove('is-over');
    }
  });
  root.addEventListener('drop', (e) => {
    const f = e.dataTransfer?.files?.[0];
    depth = 0;
    drop.classList.remove('is-over');
    if (!f) return;
    e.preventDefault();
    load(f);
  });

  part<HTMLButtonElement>('example').addEventListener('click', () => {
    input.value = text = EXAMPLE;
    name = 'example.xml';
    about = 'The example guide';
    input.placeholder = placeholder;
    run();
  });
  part<HTMLButtonElement>('clear').addEventListener('click', () => {
    input.value = text = '';
    input.placeholder = placeholder;
    run();
    input.focus();
  });

  out.addEventListener('change', (e) => {
    const select = e.target;
    if (!(select instanceof HTMLSelectElement) || select.dataset.part !== 'filter') return;
    const list = out.querySelector<HTMLElement>('[data-part="problems"]');
    if (list) list.innerHTML = problemsHtml(report, select.value);
  });

  async function flash(button: HTMLButtonElement, done: Promise<unknown> | void, ok: string) {
    const label = button.dataset.label ?? (button.dataset.label = button.textContent ?? '');
    try {
      await done;
      button.textContent = ok;
    } catch {
      button.textContent = 'Could not copy';
    }
    setTimeout(() => (button.textContent = label), 1500);
  }
  copy.addEventListener('click', () => flash(copy, navigator.clipboard.writeText(reportText(report, about)), 'Copied'));
  csv.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([`﻿${reportCsv(report)}`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.replace(/(\.xml)?(\.gz)?$/i, '') || 'xmltv'}-check.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    flash(csv, undefined, 'Downloaded');
  });
}
