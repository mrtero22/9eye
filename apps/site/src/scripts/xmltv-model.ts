// The free XMLTV EPG checker (/tools/xmltv-epg-checker). Pure functions, used twice: at build time for
// the example on the page, then in the browser, where xmltv-tool.ts runs them on a pasted or dropped
// guide. It reads the XML itself instead of using DOMParser: the same code then runs in Node for the
// build and the checks, keeps going after small mistakes such as a bare "&", and knows the line of
// every programme. No imports.

export type Level = 'error' | 'warning';

export interface Problem {
  level: Level;
  /** Short label: Overlap, Gap, Missing title, XML, … */
  kind: string;
  /** Channel id; '' for problems of the whole file. */
  channel: string;
  /** Line in the file; 0 when not known. */
  line: number;
  /** When it happens, in the file's own offset; '' when it has no time. */
  time: string;
  text: string;
}

export interface Mark {
  left: number;
  width: number;
  kind: 'gap' | 'overlap';
}

export interface ChannelReport {
  id: string;
  /** First display name; '' when there is none. */
  name: string;
  /** Has a <channel> element. */
  declared: boolean;
  programmes: number;
  first: string;
  last: string;
  /** Seconds from the first start to the last end. */
  span: number;
  gaps: number;
  gapSeconds: number;
  overlaps: number;
  errors: number;
  warnings: number;
  described: number;
  categorised: number;
  pictured: number;
  numbered: number;
  /** Gaps and overlaps on a 0–100 scale of the channel's span, for the coverage bar. */
  marks: Mark[];
}

export interface Report {
  /** false when nothing could be read; `fatal` says why. */
  ok: boolean;
  /** The mistake that stopped reading, or ''. */
  fatal: string;
  generator: string;
  minGap: number;
  channels: ChannelReport[];
  programmes: number;
  first: string;
  last: string;
  errors: number;
  warnings: number;
  /** File problems first, then each channel's by line. Very long lists are cut; the counts are not. */
  problems: Problem[];
}

export interface Options {
  /** Shorter gaps are not reported (seconds, default 1). */
  minGap?: number;
}

const XML_ROWS = 200;
const CHANNEL_ROWS = 5000;
const LONG = 12 * 3600;
export const ROWS = 300;

const two = (n: number) => String(n).padStart(2, '0');
const count = (n: number) => n.toLocaleString('en-US');
const plural = (n: number, word: string) => `${count(n)} ${word}${n === 1 ? '' : 's'}`;
const verb = (n: number, many: string, one: string) => (n === 1 ? one : many);
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const quote = (t: string) => `"${t.length > 60 ? `${t.slice(0, 57)}…` : t}"`;

/** A length in seconds as M:SS, H:MM:SS, or "2 d 3:00:00". */
export function length(seconds: number): string {
  const s = Math.round(Math.abs(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor(s / 3600) % 24;
  const body = d || h ? `${h}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}` : `${Math.floor(s / 60)}:${two(s % 60)}`;
  return d ? `${d} d ${body}` : body;
}

// ---------------------------------------------------------------------------------------- times

export interface Time {
  /** Milliseconds since 1970, UTC. */
  ms: number;
  /** Minutes east of UTC, as written in the file. */
  offset: number;
  /** How the offset was written: a number, nothing, or a zone name. */
  zone: 'offset' | 'none' | 'name';
  /** ' +0100', ' UTC', or '' when there is none. */
  label: string;
}

const TIME = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:\s*([+-])(\d{2}):?(\d{2})|\s*([A-Za-z]{1,5}))?$/;
const UTC_NAMES = new Set(['UTC', 'GMT', 'UT', 'Z']);

/** Reads an XMLTV time: YYYYMMDDhhmm or YYYYMMDDhhmmss, then an offset such as +0100 (or nothing). */
export function readTime(raw: string): Time | { error: string } {
  const m = raw.trim().match(TIME);
  if (!m) return { error: `${quote(raw)} is not an XMLTV time (YYYYMMDDhhmmss +hhmm).` };
  const [y, mo, d, h, mi, s] = [1, 2, 3, 4, 5, 6].map((i) => Number(m[i] ?? 0));
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (mo < 1 || mo > 12 || d < 1 || d > days || h > 23 || mi > 59 || s > 59) return { error: `${quote(raw)} is not a real date and time.` };
  let offset = 0;
  let zone: Time['zone'] = 'none';
  let label = '';
  if (m[7]) {
    const oh = Number(m[8]);
    const om = Number(m[9]);
    if (oh > 14 || om > 59) return { error: `${quote(raw)} has an offset that does not exist.` };
    offset = (m[7] === '-' ? -1 : 1) * (oh * 60 + om);
    zone = 'offset';
    label = ` ${m[7]}${m[8]}${m[9]}`;
  } else if (m[10]) {
    zone = UTC_NAMES.has(m[10].toUpperCase()) ? 'offset' : 'name';
    label = ` ${m[10]}`;
  }
  return { ms: Date.UTC(y, mo - 1, d, h, mi, s) - offset * 60000, offset, zone, label };
}

/** Clock time HH:MM (with :SS when not zero) in a given offset. */
function clock(ms: number, offset: number): string {
  const d = new Date(ms + offset * 60000);
  const s = d.getUTCSeconds();
  return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}${s ? `:${two(s)}` : ''}`;
}

/** Date and time in the offset of `t`, with its label: 2026-11-09 07:30 +0100. */
function stamp(ms: number, t: Time): string {
  const d = new Date(ms + t.offset * 60000);
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())} ${clock(ms, t.offset)}${t.label}`;
}

// ------------------------------------------------------------------------------------- reading

interface Chan {
  id: string | null;
  line: number;
  names: string[];
}

interface Prog {
  channel: string | null;
  start: string | null;
  stop: string | null;
  line: number;
  titles: string[];
  desc: boolean;
  category: boolean;
  icon: boolean;
  episodes: { system: string; value: string; line: number }[];
}

interface Read {
  fatal: string;
  generator: string;
  channels: Chan[];
  programmes: Prog[];
}

const NAME = /[A-Za-z_:][\w.:-]*/y;
const ATTR = /\s+([A-Za-z_:][\w.:-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/y;
const CLOSE = /<\/([A-Za-z_:][\w.:-]*)\s*>/y;
const SPACE = /\s*/y;
const ENTITY = /&(?:(#x[0-9A-Fa-f]+|#[0-9]+|[A-Za-z_][\w.-]*);)?/g;
const BAD_CHAR = /[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]/g;
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const allowed = (c: number) => c === 0x9 || c === 0xa || c === 0xd || (c >= 0x20 && c <= 0xd7ff) || (c >= 0xe000 && c <= 0xfffd) || (c >= 0x10000 && c <= 0x10ffff);

/** Line numbers for positions in `s`; fast when positions mostly move forward. */
function lines(s: string) {
  let pos = 0;
  let line = 1;
  return (at: number) => {
    if (at >= pos) {
      for (let i = s.indexOf('\n', pos); i !== -1 && i < at; i = s.indexOf('\n', i + 1)) line++;
    } else {
      for (let i = s.lastIndexOf('\n', pos - 1); i !== -1 && i >= at; i = i ? s.lastIndexOf('\n', i - 1) : -1) line--;
    }
    pos = at;
    return line;
  };
}

/** Why a start tag could not be read, from the text right after its name and attributes. */
function tagHint(rest: string): string {
  if (/^[\w.:-]+\s*=\s*[^"'\s]/.test(rest)) return ' Attribute values need quotes: name="value".';
  if (/^[\w.:-]+\s*=\s*(["'])[^"']*</.test(rest)) return ' A "<" inside an attribute value must be written as &lt;.';
  if (/^[\w.:-]+\s*=\s*["']/.test(rest)) return ' Put a space between attributes.';
  if (/^[\w.:-]+\s*(?:[\s/>]|$)/.test(rest)) return ' Every attribute needs a value: name="value".';
  if (/^</.test(rest)) return ' The tag is not closed with ">".';
  return '';
}

function readXml(s: string, problem: (at: number, text: string, level?: Level) => void): Read {
  const out: Read = { fatal: '', generator: '', channels: [], programmes: [] };
  const lineAt = lines(s);
  const stack: { name: string; at: number }[] = [];
  let rootDone = false;
  let entitiesDeclared = false;
  // Set inside the helpers below, so TypeScript must not narrow them to null here.
  let chan = null as Chan | null;
  let prog = null as Prog | null;
  let cap = null as { name: string; text: string; system: string; line: number } | null;

  const fail = (at: number, text: string) => {
    out.fatal = `Line ${lineAt(at)}: ${text}`;
    problem(at, text);
  };

  const decode = (text: string, at: number): string => {
    if (!text.includes('&')) return text;
    return text.replace(ENTITY, (whole: string, ref: string | undefined, index: number) => {
      if (ref === undefined) {
        problem(at + index, 'A bare "&" must be written as &amp;. Most players reject the whole file because of it.');
        return '&';
      }
      if (ref[0] === '#') {
        const code = ref[1] === 'x' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
        if (allowed(code)) return String.fromCodePoint(code);
        problem(at + index, `${whole} is a character XML does not allow.`);
        return '';
      }
      if (ref in NAMED) return NAMED[ref];
      if (!entitiesDeclared) problem(at + index, `${whole} is an HTML name that XML does not know (XML has only &amp; &lt; &gt; &quot; &apos;). Write the character itself, or its number such as &#160;.`);
      return whole;
    });
  };

  const open = (name: string, attrs: Map<string, string>, line: number, depth: number) => {
    if (depth === 1) {
      if (name === 'channel') chan = { id: attrs.get('id') ?? null, line, names: [] };
      else if (name === 'programme') {
        prog = { channel: attrs.get('channel') ?? null, start: attrs.get('start') ?? null, stop: attrs.get('stop') ?? null, line, titles: [], desc: false, category: false, icon: false, episodes: [] };
      }
    } else if (depth === 2 && !cap) {
      if (chan && name === 'display-name') cap = { name, text: '', system: '', line };
      else if (prog) {
        if (name === 'title' || name === 'desc' || name === 'category' || name === 'episode-num') cap = { name, text: '', system: attrs.get('system') ?? '', line };
        else if (name === 'icon' && attrs.get('src')?.trim()) prog.icon = true;
      }
    }
  };

  const close = (name: string, depth: number) => {
    if (depth === 2 && cap && cap.name === name) {
      const text = cap.text.trim();
      if (chan) chan.names.push(text);
      else if (prog) {
        if (name === 'title') prog.titles.push(text);
        else if (name === 'desc') prog.desc ||= Boolean(text);
        else if (name === 'category') prog.category ||= Boolean(text);
        else prog.episodes.push({ system: cap.system, value: text, line: cap.line });
      }
      cap = null;
    } else if (depth === 1) {
      if (name === 'channel' && chan) out.channels.push(chan);
      if (name === 'programme' && prog) out.programmes.push(prog);
      chan = prog = null;
    } else if (depth === 0) rootDone = true;
  };

  // Text between tags: kept inside the elements we read, checked everywhere.
  const text = (from: number, to: number) => {
    if (cap) {
      cap.text += decode(s.slice(from, to), from);
      return;
    }
    const t = s.slice(from, to);
    if (!stack.length) {
      const k = t.search(/\S/);
      if (k !== -1) fail(from + k, rootDone ? 'Text after the end of </tv>.' : 'Text before the <tv> element.');
    } else if (t.includes('&')) decode(t, from);
  };

  BAD_CHAR.lastIndex = 0;
  for (let m = BAD_CHAR.exec(s), n = 0; m && n < 20; m = BAD_CHAR.exec(s), n++) {
    problem(m.index, `An invisible control character (code ${m[0].charCodeAt(0)}) that XML does not allow. Most players reject the file because of it.`);
  }

  let i = 0;
  while (i < s.length && !out.fatal) {
    const lt = s.indexOf('<', i);
    text(i, lt === -1 ? s.length : lt);
    if (lt === -1 || out.fatal) break;

    if (s.startsWith('<!--', lt)) {
      const e = s.indexOf('-->', lt + 4);
      if (e === -1) fail(lt, 'A comment (<!--) is never closed.');
      i = e + 3;
    } else if (s.startsWith('<![CDATA[', lt)) {
      const e = s.indexOf(']]>', lt + 9);
      if (e === -1) fail(lt, 'A CDATA section is never closed.');
      else if (!stack.length) fail(lt, 'Text outside the <tv> element.');
      else if (cap) cap.text += s.slice(lt + 9, e);
      i = e + 3;
    } else if (s.startsWith('<?', lt)) {
      const e = s.indexOf('?>', lt + 2);
      if (e === -1) fail(lt, 'An <?…?> instruction is never closed.');
      i = e + 2;
    } else if (s.startsWith('<!', lt)) {
      const bracket = s.indexOf('[', lt);
      let e = s.indexOf('>', lt);
      if (bracket !== -1 && (e === -1 || bracket < e)) {
        const sub = s.indexOf(']', bracket);
        if (sub !== -1 && s.slice(bracket, sub).includes('<!ENTITY')) entitiesDeclared = true;
        e = sub === -1 ? -1 : s.indexOf('>', sub);
      }
      if (e === -1) fail(lt, 'The <!DOCTYPE …> is never closed.');
      i = e + 1;
    } else if (s[lt + 1] === '/') {
      CLOSE.lastIndex = lt;
      const m = CLOSE.exec(s);
      if (!m) {
        fail(lt, 'A closing tag is not written correctly.');
        break;
      }
      const top = stack.pop();
      if (!top) fail(lt, `</${m[1]}> closes an element that was never opened.`);
      else if (top.name !== m[1]) fail(lt, `</${m[1]}> closes <${top.name}>, which was opened on line ${lineAt(top.at)}.`);
      else close(m[1], stack.length);
      i = CLOSE.lastIndex;
    } else {
      const line = lineAt(lt);
      NAME.lastIndex = lt + 1;
      const nm = NAME.exec(s);
      if (!nm) {
        fail(lt, 'A "<" that does not start a tag. In text it must be written as &lt;.');
        break;
      }
      const name = nm[0];
      const attrs = new Map<string, string>();
      let p = NAME.lastIndex;
      let end: 'open' | 'empty' | 'bad' = 'bad';
      for (;;) {
        ATTR.lastIndex = p;
        const a = ATTR.exec(s);
        if (a) {
          if (attrs.has(a[1])) problem(p, `<${name}> has the attribute ${a[1]} twice.`);
          attrs.set(a[1], decode(a[2] ?? a[3], p));
          p = ATTR.lastIndex;
          continue;
        }
        SPACE.lastIndex = p;
        SPACE.exec(s);
        p = SPACE.lastIndex;
        if (s.startsWith('/>', p)) end = 'empty';
        else if (s[p] === '>') end = 'open';
        break;
      }
      if (end === 'bad') {
        fail(p, `<${name}> is not written correctly.${tagHint(s.slice(p, p + 200))}`);
        break;
      }
      i = p + (end === 'empty' ? 2 : 1);
      if (!stack.length) {
        if (rootDone) {
          fail(lt, `A second element <${name}> after </tv>. A file has one <tv> element.`);
          break;
        }
        if (name !== 'tv') {
          fail(lt, `The file starts with <${name}>, not <tv>: this is not an XMLTV guide.`);
          break;
        }
        out.generator = [attrs.get('generator-info-name'), attrs.get('source-info-name')].filter((x) => x?.trim()).join(' · ');
      }
      open(name, attrs, line, stack.length);
      if (end === 'empty') close(name, stack.length);
      else stack.push({ name, at: lt });
    }
  }

  if (!out.fatal) {
    if (stack.length) {
      const top = stack[stack.length - 1];
      fail(s.length, `The file ends inside <${top.name}> (opened on line ${lineAt(top.at)}). It may be cut off: download it again.`);
    } else if (!rootDone) fail(0, 'No <tv> element was found.');
  }
  return out;
}

// ------------------------------------------------------------------------------------ checking

const PART = String.raw`\s*(?:\d+\s*(?:\/\s*\d+\s*)?)?`;
const XMLTV_NS = new RegExp(`^${PART}\\.${PART}\\.${PART}$`);

interface Timed {
  p: Prog;
  title: string;
  start: Time;
  end: number;
}

function notXml(text: string): Report {
  return { ok: false, fatal: text, generator: '', minGap: 1, channels: [], programmes: 0, first: '', last: '', errors: 1, warnings: 0, problems: [] };
}

/** Checks an XMLTV guide: the XML, the channels, and each channel's programmes in time order. */
export function check(input: string, options: Options = {}): Report {
  const minGap = Math.max(1, Math.round(options.minGap ?? 1) || 1);
  const s = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const k = s.search(/\S/);
  const head = k === -1 ? '' : s.slice(k, k + 20);
  if (!head) return notXml('Paste an XMLTV guide, or drop the file here.');
  if (/^#EXT(M3U|INF)/.test(head)) {
    return notXml('This is an M3U playlist, not an XMLTV guide. The guide is a separate file; its address is often in url-tvg or x-tvg-url on the first line of the playlist.');
  }
  if (head[0] === '{' || head[0] === '[') return notXml('This looks like JSON, not XMLTV. An XMLTV guide is XML with a <tv> element around everything.');
  if (head[0] !== '<') return notXml('This does not look like XML. An XMLTV guide starts with <tv>, often after an <?xml …?> line.');

  let errors = 0;
  let warnings = 0;
  const tally = (level: Level) => (level === 'error' ? errors++ : warnings++);
  const fileProblems: Problem[] = [];
  let xmlHidden = 0;
  const lineOf = lines(s);
  const read = readXml(s, (at, text, level = 'error') => {
    tally(level);
    if (fileProblems.length < XML_ROWS) fileProblems.push({ level, kind: 'XML', channel: '', line: lineOf(at), time: '', text });
    else xmlHidden++;
  });
  if (xmlHidden) fileProblems.push({ level: 'error', kind: 'XML', channel: '', line: 0, time: '', text: `${plural(xmlHidden, 'more XML problem')} like the ones above are not listed.` });
  const fileAdd = (level: Level, kind: string, line: number, text: string) => {
    tally(level);
    if (fileProblems.length < CHANNEL_ROWS) fileProblems.push({ level, kind, channel: '', line, time: '', text });
  };

  let replacement = 0;
  for (let at = s.indexOf('�'); at !== -1; at = s.indexOf('�', at + 1)) replacement++;
  if (replacement) {
    fileAdd('warning', 'Encoding', 0, `${plural(replacement, 'character')} could not be read and show as �. Save the file in the encoding its <?xml …?> line names (usually UTF-8).`);
  }

  // Channels.
  const declared = new Map<string, Chan>();
  for (const c of read.channels) {
    if (!c.id?.trim()) fileAdd('error', 'Channel', c.line, 'A <channel> has no id, so no programme can point to it.');
    else if (declared.has(c.id)) fileAdd('error', 'Channel', c.line, `The channel id "${c.id}" is used twice (also on line ${declared.get(c.id)!.line}).`);
    else declared.set(c.id, c);
  }

  // Programmes per channel, in the order of the file.
  const groups = new Map<string, Prog[]>();
  for (const id of declared.keys()) groups.set(id, []);
  for (const p of read.programmes) {
    if (!p.channel?.trim()) {
      fileAdd('error', 'No channel', p.line, `${p.titles[0] ? quote(p.titles[0]) : 'A programme'} has no channel attribute, so players cannot place it.`);
      continue;
    }
    let g = groups.get(p.channel);
    if (!g) groups.set(p.channel, (g = []));
    g.push(p);
  }

  const channels: ChannelReport[] = [];
  const channelProblems: Problem[] = [];
  let first: { ms: number; text: string } | null = null;
  let last: { ms: number; text: string } | null = null;

  for (const [id, list] of groups) {
    const chan = declared.get(id);
    const rows: Problem[] = [];
    let chErrors = 0;
    let chWarnings = 0;
    const add = (level: Level, kind: string, line: number, text: string, time = '') => {
      tally(level);
      if (level === 'error') chErrors++;
      else chWarnings++;
      if (rows.length < CHANNEL_ROWS) rows.push({ level, kind, channel: id, line, time, text });
    };
    const top: Problem[] = [];
    const addTop = (level: Level, kind: string, line: number, text: string) => {
      tally(level);
      if (level === 'error') chErrors++;
      else chWarnings++;
      top.push({ level, kind, channel: id, line, time: '', text });
    };

    if (!chan) {
      const near = [...declared.keys()].find((k) => k.trim().toLowerCase() === id.trim().toLowerCase());
      addTop('error', 'Unknown channel', list[0].line, `${plural(list.length, 'programme')} ${verb(list.length, 'point', 'points')} to the channel "${id}", but no <channel> has this id, so players do not show ${verb(list.length, 'them', 'it')}.${near ? ` Did you mean "${near}"? Ids must match exactly.` : ''}`);
    } else {
      if (!chan.names.some(Boolean)) addTop('error', 'No display name', chan.line, `The channel "${id}" has no <display-name>.`);
      if (id !== id.trim()) addTop('warning', 'Channel', chan.line, `The channel id "${id}" starts or ends with a space. Players compare ids exactly.`);
      if (!list.length) addTop('warning', 'No programmes', chan.line, `The channel "${id}" has no programmes in this file.`);
    }

    // Each programme on its own.
    const timed: Timed[] = [];
    let noZone = 0;
    let noZoneLine = 0;
    let zoneName = '';
    let named = 0;
    let namedLine = 0;
    let noStop = 0;
    let noStopLine = 0;
    let described = 0;
    let categorised = 0;
    let pictured = 0;
    let numbered = 0;
    const stops = new Map<Prog, Time | null>();

    for (const p of list) {
      if (p.desc) described++;
      if (p.category) categorised++;
      if (p.icon) pictured++;
      if (p.episodes.length) numbered++;
      const title = p.titles.find(Boolean) ?? '';
      const zones = (t: Time) => {
        if (t.zone === 'none' && !noZone++) noZoneLine = p.line;
        if (t.zone === 'name') {
          if (!named++) namedLine = p.line;
          zoneName ||= t.label.trim();
        }
      };

      let start: Time | null = null;
      if (p.start === null) add('error', 'Missing start', p.line, `${title ? quote(title) : 'The programme'} has no start time.`);
      else {
        const t = readTime(p.start);
        if ('error' in t) add('error', 'Bad time', p.line, `The start ${t.error}`);
        else zones((start = t));
      }
      const when = start ? stamp(start.ms, start) : '';
      if (!title) add('error', 'Missing title', p.line, p.titles.length ? 'The <title> is empty.' : 'The programme has no <title>.', when);
      let stop: Time | null = null;
      if (p.stop === null) {
        if (!noStop++) noStopLine = p.line;
      } else {
        const t = readTime(p.stop);
        if ('error' in t) add('error', 'Bad time', p.line, `The stop ${t.error}`, when);
        else zones((stop = t));
      }
      for (const e of p.episodes) {
        if (e.system === 'xmltv_ns' && !XMLTV_NS.test(e.value)) {
          add('warning', 'Episode number', e.line, `${quote(e.value)} is not in xmltv_ns form: season.episode.part, counted from 0, so season 1 episode 5 is "0.4.".`, when);
        }
      }
      if (start && stop) {
        const seconds = (stop.ms - start.ms) / 1000;
        const name = title ? quote(title) : 'The programme';
        if (seconds < 0) add('error', 'Ends before start', p.line, `${name} ends at ${clock(stop.ms, start.offset)}, before it starts at ${clock(start.ms, start.offset)}.`, when);
        else if (seconds === 0) add('error', 'Zero length', p.line, `${name} starts and ends at ${clock(start.ms, start.offset)}.`, when);
        else if (seconds > LONG) add('warning', 'Very long', p.line, `${name} runs ${length(seconds)}. Check its stop time.`, when);
      }
      stops.set(p, stop);
      if (start) timed.push({ p, title: title || '(no title)', start, end: 0 });
    }

    if (noZone) addTop('warning', 'No time zone', noZoneLine, `${plural(noZone, 'time')} ${verb(noZone, 'have', 'has')} no offset such as +0100. The XMLTV standard reads ${verb(noZone, 'them', 'it')} as UTC, but some players read local time, which moves the whole guide.`);
    if (named) addTop('warning', 'Time zone name', namedLine, `${plural(named, 'time')} ${verb(named, 'use', 'uses')} the zone name "${zoneName}" instead of an offset such as +0100. ${verb(named, 'They are', 'It is')} read here as UTC; players may read ${verb(named, 'them', 'it')} differently.`);
    if (noStop) addTop('warning', 'No stop time', noStopLine, `${plural(noStop, 'programme')} ${verb(noStop, 'have', 'has')} no stop time. Players end each one when the next starts, and the last one has no end.`);

    // The channel's timeline: gaps and overlaps.
    timed.sort((a, b) => a.start.ms - b.start.ms);
    timed.forEach((x, k) => {
      const stop = stops.get(x.p);
      x.end = stop ? Math.max(stop.ms, x.start.ms) : (timed[k + 1]?.start.ms ?? x.start.ms);
    });
    const range = (x: Timed) => `${clock(x.start.ms, x.start.offset)}–${clock(x.end, x.start.offset)}`;
    let gaps = 0;
    let gapSeconds = 0;
    let overlaps = 0;
    const spans: { from: number; to: number; kind: Mark['kind'] }[] = [];
    let reach = -Infinity;
    let holder: Timed | null = null;
    let prev: Timed | null = null;
    for (const x of timed) {
      if (holder && prev) {
        const same = x.start.ms === prev.start.ms;
        if (same || x.start.ms < reach) {
          const other = same ? prev : holder;
          if (other.start.ms === x.start.ms && other.end === x.end && other.title === x.title) {
            add('error', 'Duplicate', x.p.line, `${quote(x.title)} (${range(x)}) is in the guide twice (also on line ${other.p.line}).`, stamp(x.start.ms, x.start));
          } else {
            const by = (Math.min(other.end, x.end) - x.start.ms) / 1000;
            add('error', 'Overlap', x.p.line, `${quote(x.title)} (${range(x)}) overlaps ${quote(other.title)} (${range(other)}, line ${other.p.line}) by ${length(by)}.`, stamp(x.start.ms, x.start));
          }
          overlaps++;
          spans.push({ from: x.start.ms, to: Math.max(Math.min(other.end, x.end), x.start.ms), kind: 'overlap' });
        } else if (x.start.ms > reach) {
          const seconds = (x.start.ms - reach) / 1000;
          if (seconds >= minGap) {
            add('warning', 'Gap', x.p.line, `Nothing from ${clock(reach, x.start.offset)} to ${clock(x.start.ms, x.start.offset)} (${length(seconds)}), between ${quote(holder.title)} and ${quote(x.title)}.`, stamp(reach, x.start));
            gaps++;
            gapSeconds += seconds;
            spans.push({ from: reach, to: x.start.ms, kind: 'gap' });
          }
        }
      }
      if (x.end > reach) {
        reach = x.end;
        holder = x;
      }
      prev = x;
    }

    let chFirst = '';
    let chLast = '';
    let span = 0;
    const marks: Mark[] = [];
    if (timed.length && holder) {
      const a = timed[0];
      const end: Timed = holder;
      chFirst = stamp(a.start.ms, a.start);
      chLast = stamp(reach, end.start);
      span = (reach - a.start.ms) / 1000;
      if (!first || a.start.ms < first.ms) first = { ms: a.start.ms, text: chFirst };
      if (!last || reach > last.ms) last = { ms: reach, text: chLast };
      const seen = new Set<string>();
      for (const sp of spans) {
        const left = span ? ((sp.from - a.start.ms) / 1000 / span) * 100 : 0;
        const width = span ? ((sp.to - sp.from) / 1000 / span) * 100 : 0;
        const key = `${sp.kind}${Math.round(left * 4)}`;
        if (seen.has(key) && width < 0.5) continue;
        seen.add(key);
        marks.push({ left: Math.round(left * 100) / 100, width: Math.round(width * 100) / 100, kind: sp.kind });
      }
    }

    rows.sort((a, b) => a.line - b.line);
    const hidden = chErrors + chWarnings - top.length - rows.length;
    if (hidden > 0) rows.push({ level: 'warning', kind: 'More', channel: id, line: 0, time: '', text: `${plural(hidden, 'more problem')} on this channel are not listed.` });
    channelProblems.push(...top, ...rows);
    channels.push({
      id,
      name: chan?.names.find(Boolean) ?? '',
      declared: Boolean(chan),
      programmes: list.length,
      first: chFirst,
      last: chLast,
      span,
      gaps,
      gapSeconds,
      overlaps,
      errors: chErrors,
      warnings: chWarnings,
      described,
      categorised,
      pictured,
      numbered,
      marks,
    });
  }

  if (!read.fatal && !read.channels.length && !read.programmes.length) fileAdd('warning', 'Empty', 0, 'The <tv> element has no channels and no programmes.');

  return {
    ok: true,
    fatal: read.fatal,
    generator: read.generator,
    minGap,
    channels,
    programmes: read.programmes.length,
    first: first?.text ?? '',
    last: last?.text ?? '',
    errors,
    warnings,
    problems: [...fileProblems, ...channelProblems],
  };
}

// ----------------------------------------------------------------------------------- rendering

const percent = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '—');

function statusBadges(errors: number, warnings: number, ok = 'No problems found'): string {
  if (!errors && !warnings) return `<span class="badge badge--green">${ok}</span>`;
  return `${errors ? `<span class="badge badge--red">${plural(errors, 'error')}</span>` : ''}${warnings ? `<span class="badge badge--amber">${plural(warnings, 'warning')}</span>` : ''}`;
}

function filtered(r: Report, filter: string): Problem[] {
  if (!filter) return r.problems;
  if (filter === 'file') return r.problems.filter((p) => !p.channel);
  const id = filter.slice(2);
  return r.problems.filter((p) => p.channel === id);
}

/** The list of problems, for all channels ('') or one ('c:<id>', or 'file' for the file itself). */
export function problemsHtml(r: Report, filter = ''): string {
  const list = filtered(r, filter);
  if (!list.length) {
    if (r.errors || r.warnings) return '<p class="meta" style="margin: 0">No problems here.</p>';
    return `<p class="notice notice--green">Every programme has a channel, a title and readable times, with no gaps${r.minGap > 1 ? ` of ${length(r.minGap)} or more` : ''} and no overlaps.</p>`;
  }
  const rows = list.slice(0, ROWS).map((p) => `<tr>
    <td style="width: 1%; vertical-align: top"><span class="badge badge--${p.level === 'error' ? 'red' : 'amber'}">${esc(p.kind)}</span>${p.line ? `<br><span class="mono meta">line ${p.line}</span>` : ''}</td>
    <td style="white-space: normal; min-width: 240px; vertical-align: top">${esc(p.text)}<br><span class="mono meta">${[p.channel || 'The file', p.time].filter(Boolean).map(esc).join(' · ')}</span></td>
  </tr>`).join('');
  const more = list.length > ROWS ? `<p class="meta" style="margin: 0">Showing the first ${ROWS} of ${count(list.length)}. Copy the report or download the CSV for all of them.</p>` : '';
  return `<div class="sheet-box"><div class="scroll-x"><table class="sheet sheet--stack">
    <thead><tr><th scope="col">Problem</th><th scope="col">Details</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div></div>${more}`;
}

function coverage(c: ChannelReport): string {
  if (!c.span) return '';
  const marks = c.marks.map((m) => `<span class="is-${m.kind}" style="left: ${m.left}%; width: ${m.width}%"></span>`).join('');
  return `<span class="cbar" title="${esc(`${c.first} → ${c.last}`)}">${marks}</span>`;
}

/** The whole result: summary, channels and problems. */
export function renderHtml(r: Report, filter = ''): string {
  if (!r.ok) return `<p class="notice notice--red" role="alert">${esc(r.fatal)}</p>`;
  const head = `<div class="btn-row" style="gap: 8px">${statusBadges(r.errors, r.warnings)}</div>`;
  const fatal = r.fatal ? `<p class="notice notice--red" role="alert">Reading stopped. ${esc(r.fatal)} Players reject the whole file at a mistake like this; the results below cover the part before it.</p>` : '';
  const channelRows = r.channels.slice(0, 1000).map((c) => `<tr>
    <td><strong style="font-weight: 500">${esc(c.name || c.id)}</strong>${c.name ? `<br><span class="mono meta">${esc(c.id)}</span>` : ''}${c.declared ? '' : ' <span class="badge badge--red">no &lt;channel&gt;</span>'}</td>
    <td class="mono">${count(c.programmes)}</td>
    <td class="mono">${esc(c.first) || '—'}</td>
    <td class="mono">${esc(c.last) || '—'}</td>
    <td class="mono${c.gaps ? ' is-off' : ''}">${c.gaps ? `${count(c.gaps)} · ${length(c.gapSeconds)}` : '0'}</td>
    <td class="mono${c.overlaps ? ' is-off' : ''}">${count(c.overlaps)}</td>
    <td class="mono">${percent(c.described, c.programmes)}</td>
    <td class="mono">${percent(c.pictured, c.programmes)}</td>
    <td>${statusBadges(c.errors, c.warnings, 'OK')}</td>
    <td>${coverage(c)}</td>
  </tr>`).join('');
  const moreChannels = r.channels.length > 1000 ? `<p class="meta" style="margin: 0; padding: 12px 20px">Showing the first 1,000 of ${count(r.channels.length)} channels.</p>` : '';
  const channels = `<div class="sheet-box">
    <dl class="sheet-sum">
      <div><dt>Channels</dt><dd class="mono">${count(r.channels.length)}</dd></div>
      <div><dt>Programmes</dt><dd class="mono">${count(r.programmes)}</dd></div>
      <div><dt>Guide starts</dt><dd class="mono">${esc(r.first) || '—'}</dd></div>
      <div><dt>Guide ends</dt><dd class="mono">${esc(r.last) || '—'}</dd></div>
    </dl>
    ${r.channels.length ? `<div class="scroll-x"><table class="sheet">
      <thead><tr><th scope="col">Channel</th><th scope="col">Programmes</th><th scope="col">From</th><th scope="col">To</th><th scope="col">Gaps</th><th scope="col">Overlaps</th><th scope="col">With description</th><th scope="col">With picture</th><th scope="col">Status</th><th scope="col">Coverage</th></tr></thead>
      <tbody>${channelRows}</tbody>
    </table></div>${moreChannels}` : ''}
  </div>`;
  const legend = r.channels.some((c) => c.span) ? '<p class="meta" style="margin: 0">Coverage runs from the channel\'s first programme to its last: <span class="key key--gap"></span> gap, <span class="key key--overlap"></span> overlap.</p>' : '';

  const groups: string[] = [];
  if (r.problems.some((p) => !p.channel)) groups.push(`<option value="file"${filter === 'file' ? ' selected' : ''}>The file itself (${count(r.problems.filter((p) => !p.channel).length)})</option>`);
  for (const c of r.channels) {
    const n = c.errors + c.warnings;
    if (n) groups.push(`<option value="c:${esc(c.id)}"${filter === `c:${c.id}` ? ' selected' : ''}>${esc(c.name || c.id)} (${count(n)})</option>`);
  }
  const select = groups.length > 1 ? `<div class="field" style="min-width: min(260px, 100%)"><label for="xmltv-filter">Show</label><select id="xmltv-filter" class="input" data-part="filter"><option value="">All problems (${count(r.errors + r.warnings)})</option>${groups.join('')}</select></div>` : '';
  const problems = `<section class="stack" style="--gap: 12px" aria-labelledby="xmltv-problems">
    <div class="btn-row" style="justify-content: space-between; align-items: flex-end; gap: 12px">
      <h3 id="xmltv-problems" class="h3" style="font-size: 18px">Problems</h3>${select}
    </div>
    <div class="stack" style="--gap: 12px" data-part="problems">${problemsHtml(r, filter)}</div>
  </section>`;
  const made = r.generator ? `<p class="meta" style="margin: 0">Made by ${esc(r.generator)}</p>` : '';
  return `${head}${fatal}${channels}${legend}${problems}${made}`;
}

// ------------------------------------------------------------------------------------- exports

/** A plain-text report for a ticket or an e-mail. */
export function reportText(r: Report, label: string): string {
  if (!r.ok) return r.fatal;
  const out = [
    'XMLTV EPG check (https://9eye.org/tools/xmltv-epg-checker)',
    `File: ${label}`,
    `${plural(r.channels.length, 'channel')}, ${plural(r.programmes, 'programme')}: ${plural(r.errors, 'error')}, ${plural(r.warnings, 'warning')}`,
  ];
  if (r.first) out.push(`Guide: ${r.first} to ${r.last}`);
  if (r.fatal) out.push(`Reading stopped. ${r.fatal}`);
  out.push('', 'CHANNELS');
  for (const c of r.channels) {
    out.push(`${c.id}${c.name ? ` (${c.name})` : ''}: ${plural(c.programmes, 'programme')}${c.first ? `, ${c.first} to ${c.last}` : ''}, ${plural(c.gaps, 'gap')}, ${plural(c.overlaps, 'overlap')}, ${plural(c.errors, 'error')}, ${plural(c.warnings, 'warning')}`);
  }
  out.push('', 'PROBLEMS');
  if (!r.problems.length) out.push('None.');
  for (const p of r.problems) {
    out.push([p.level.toUpperCase().padEnd(7), p.kind.padEnd(16), p.channel || 'File', p.line ? `line ${p.line}` : '', p.time, p.text].filter(Boolean).join('  '));
  }
  return out.join('\n');
}

const cell = (v: string | number) => {
  const t = String(v);
  const safe = /^[=+@\t\r]/.test(t) ? `'${t}` : t;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** The problems as CSV (UTF-8), one row each. */
export function reportCsv(r: Report): string {
  const rows = [['level', 'problem', 'channel', 'line', 'time', 'details']];
  for (const p of r.problems) rows.push([p.level, p.kind, p.channel, p.line ? String(p.line) : '', p.time, p.text]);
  return `${rows.map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}

// ------------------------------------------------------------------------------------- example

/** A short guide with the mistakes we see most, shown when the page opens. */
export const EXAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE tv SYSTEM "xmltv.dtd">
<tv generator-info-name="Example export">
  <channel id="tessa-one.example">
    <display-name lang="en">Tessa One</display-name>
    <icon src="https://example.com/logos/tessa-one.png" />
  </channel>
  <channel id="tessa-kids.example">
    <display-name lang="en">Tessa Kids</display-name>
  </channel>
  <channel id="tessa-movies.example">
    <display-name lang="en">Tessa Movies</display-name>
  </channel>
  <programme start="20261109060000 +0100" stop="20261109070000 +0100" channel="tessa-one.example">
    <title lang="en">Morning Live</title>
    <desc lang="en">News, weather and guests from the studio.</desc>
    <category lang="en">News</category>
  </programme>
  <programme start="20261109070000 +0100" stop="20261109073500 +0100" channel="tessa-one.example">
    <title lang="en">Garden Rescue</title>
    <desc lang="en">A family garden gets a new start.</desc>
    <episode-num system="xmltv_ns">2.6.</episode-num>
  </programme>
  <programme start="20261109073000 +0100" stop="20261109080000 +0100" channel="tessa-one.example">
    <title lang="en">Fish & Chips at Home</title>
    <desc lang="en">Two cooks, one kitchen, twenty minutes.</desc>
  </programme>
  <programme start="20261109080000 +0100" stop="20261109090000 +0100" channel="tessa-one.example">
    <title lang="en">Coastal Trains</title>
    <episode-num system="xmltv_ns">S01E04</episode-num>
  </programme>
  <programme start="20261109091000 +0100" stop="20261109100000 +0100" channel="tessa-one.example">
    <title lang="en">Market Report</title>
  </programme>
  <programme start="20261109060000 +0100" stop="20261109063000 +0100" channel="tessa-kids.example">
    <title lang="en">Paper Planes</title>
  </programme>
  <programme start="20261109063000 +0100" stop="20261109070000 +0100" channel="tessa-kids.example">
    <title lang="en"></title>
  </programme>
  <programme start="20261109070000 +0100" stop="20261109072500 +0100" channel="tessa-kids.example">
    <title lang="en">Tiny Tractors</title>
  </programme>
  <programme start="20261109200000 +0100" stop="20261109221500 +0100" channel="Tessa-Movies.example">
    <title lang="en">The Long Harbour</title>
  </programme>
</tv>
`;
