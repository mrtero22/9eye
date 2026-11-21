// The free SCTE-35 decoder (/tools/scte35-decoder). Pure functions, used twice: at build time for the
// example the page shows before any script runs, then in the browser, where scte35-tool.ts decodes
// what the visitor pastes. Nothing leaves the page. Follows ANSI/SCTE 35: the splice_info_section,
// its splice commands and the "CUEI" splice descriptors. Only erasable TypeScript (no enums, no
// parameter properties), so Node can run it directly in checks.

export interface Row { label: string; value: string; note?: string }
export interface Block { title: string; rows: Row[] }
export interface Decoded {
  ok: true;
  summary: string;
  bytes: number;
  crcOk: boolean;
  warnings: string[];
  blocks: Block[];
  json: Record<string, unknown>;
}
export interface Failed { ok: false; error: string }
export type Result = Decoded | Failed;

/** Three real cues from the examples of the SCTE 35 standard. */
export const EXAMPLES = [
  { id: 'insert', label: 'splice_insert', cue: '/DAvAAAAAAAA///wFAVIAACPf+/+c2nALv4AUsz1AAAAAAAKAAhDVUVJAAABNWLbowo=' },
  { id: 'opportunity', label: 'time_signal: ad opportunity', cue: '/DA0AAAAAAAA///wBQb+cr0AUAAeAhxDVUVJSAAAjn/PAAGlmbAICAAAAAAsoKGKNAIAmsnRfg==' },
  { id: 'program', label: 'time_signal: programme end + start', cue: '/DBIAAAAAAAA///wBQb+ek2ItgAyAhdDVUVJSAAAGH+fCAgAAAAALMvDRBEAAAIXQ1VFSUgAABl/nwgIAAAAACyk26AQAACZcuND' },
];

const TICKS = 90000; // the 90 kHz clock of PTS and durations
const WRAP = 2 ** 33;
const CUEI = 0x43554549;

const COMMANDS: Record<number, string> = {
  0x00: 'splice_null', 0x04: 'splice_schedule', 0x05: 'splice_insert', 0x06: 'time_signal',
  0x07: 'bandwidth_reservation', 0xff: 'private_command',
};
const DESCRIPTORS: Record<number, string> = {
  0x00: 'avail_descriptor', 0x01: 'DTMF_descriptor', 0x02: 'segmentation_descriptor',
  0x03: 'time_descriptor', 0x04: 'audio_descriptor',
};
const SAP = ['Type 1', 'Type 2', 'Type 3', 'Not specified'];
const ENCRYPTION: Record<number, string> = { 0: 'None', 1: 'DES – ECB mode', 2: 'DES – CBC mode', 3: 'Triple DES EDE3 – ECB mode' };
const DEVICE = ['Restrict Group 0', 'Restrict Group 1', 'Restrict Group 2', 'None'];

export const SEGMENTATION_TYPES: Record<number, string> = {
  0x00: 'Not Indicated', 0x01: 'Content Identification', 0x02: 'Call Ad Server',
  0x10: 'Program Start', 0x11: 'Program End', 0x12: 'Program Early Termination', 0x13: 'Program Breakaway',
  0x14: 'Program Resumption', 0x15: 'Program Runover Planned', 0x16: 'Program Runover Unplanned',
  0x17: 'Program Overlap Start', 0x18: 'Program Blackout Override', 0x19: 'Program Join',
  0x20: 'Chapter Start', 0x21: 'Chapter End', 0x22: 'Break Start', 0x23: 'Break End',
  0x24: 'Opening Credit Start', 0x25: 'Opening Credit End', 0x26: 'Closing Credit Start', 0x27: 'Closing Credit End',
  0x30: 'Provider Advertisement Start', 0x31: 'Provider Advertisement End',
  0x32: 'Distributor Advertisement Start', 0x33: 'Distributor Advertisement End',
  0x34: 'Provider Placement Opportunity Start', 0x35: 'Provider Placement Opportunity End',
  0x36: 'Distributor Placement Opportunity Start', 0x37: 'Distributor Placement Opportunity End',
  0x38: 'Provider Overlay Placement Opportunity Start', 0x39: 'Provider Overlay Placement Opportunity End',
  0x3a: 'Distributor Overlay Placement Opportunity Start', 0x3b: 'Distributor Overlay Placement Opportunity End',
  0x3c: 'Provider Promo Start', 0x3d: 'Provider Promo End', 0x3e: 'Distributor Promo Start', 0x3f: 'Distributor Promo End',
  0x40: 'Unscheduled Event Start', 0x41: 'Unscheduled Event End',
  0x42: 'Alternate Content Opportunity Start', 0x43: 'Alternate Content Opportunity End',
  0x44: 'Provider Ad Block Start', 0x45: 'Provider Ad Block End',
  0x46: 'Distributor Ad Block Start', 0x47: 'Distributor Ad Block End',
  0x50: 'Network Start', 0x51: 'Network End',
};
// Segmentation types that may carry sub_segment_num and sub_segments_expected.
const SUB_SEGMENTS = new Set([0x30, 0x32, 0x34, 0x36, 0x38, 0x3a, 0x44, 0x46]);

const UPID_TYPES: Record<number, string> = {
  0x00: 'Not Used', 0x01: 'User Defined (deprecated)', 0x02: 'ISCI (deprecated)', 0x03: 'Ad-ID', 0x04: 'UMID',
  0x05: 'ISAN (deprecated)', 0x06: 'ISAN', 0x07: 'TID', 0x08: 'AiringID', 0x09: 'ADI', 0x0a: 'EIDR',
  0x0b: 'ATSC Content Identifier', 0x0c: 'MPU', 0x0d: 'MID', 0x0e: 'ADS Information', 0x0f: 'URI',
  0x10: 'UUID', 0x11: 'SCR',
};

// ---------------------------------------------------------------------------------------------
// Reading the input

/** Finds the cue in what was pasted (base64, hex, or an HLS / DASH line around it) and returns its bytes. */
export function readInput(text: string): { bytes: Uint8Array } | { error: string } {
  let s = text.trim();
  if (!s) return { error: 'Paste a SCTE-35 cue: base64 (it usually starts with /DA) or hex (FC30…).' };
  const wrapped =
    s.match(/SCTE35-(?:OUT|IN|CMD)\s*=\s*"?(0x[0-9a-f]+|[a-z0-9+/=_-]+)/i) ??
    s.match(/EXT-OATCLS-SCTE35:\s*"?([a-z0-9+/=_-]+)/i) ??
    s.match(/CUE\s*=\s*"([^"]+)"/i) ??
    s.match(/<(?:\w+:)?Binary[^>]*>\s*([^<]+?)\s*<\//i);
  if (wrapped) s = wrapped[1];
  s = s.replace(/\s+/g, '');

  const h = s.replace(/^0x/i, '');
  if (/^0x/i.test(s) || /^fc[0-9a-f]*$/i.test(h)) {
    if (!/^[0-9a-f]+$/i.test(h)) return { error: 'This looks like hex, but it has characters other than 0–9 and A–F.' };
    if (h.length % 2) return { error: 'Hex needs two digits per byte, and one digit is missing.' };
    return { bytes: Uint8Array.from(h.match(/../g)!, (x) => parseInt(x, 16)) };
  }
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (!/^[A-Za-z0-9+/]+$/.test(b64) || b64.length % 4 === 1) {
    return { error: 'This is neither base64 nor hex. Paste the cue itself, for example /DAvAAAAAAAA… or 0xFC302F….' };
  }
  b64 += '='.repeat((4 - (b64.length % 4)) % 4);
  return { bytes: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) };
}

// ---------------------------------------------------------------------------------------------
// Bits and helpers

class Short extends Error {}

class Bits {
  bytes: Uint8Array;
  pos: number; // in bits
  end: number; // in bits
  constructor(bytes: Uint8Array, start = 0, end = bytes.length) {
    this.bytes = bytes;
    this.pos = start * 8;
    this.end = end * 8;
  }
  read(n: number): number {
    if (this.pos + n > this.end) throw new Short();
    let v = 0;
    for (let i = 0; i < n; i++, this.pos++) v = v * 2 + ((this.bytes[this.pos >> 3] >> (7 - (this.pos & 7))) & 1);
    return v;
  }
  flag(): boolean {
    return this.read(1) === 1;
  }
  skip(n: number) {
    if (this.pos + n > this.end) throw new Short();
    this.pos += n;
  }
  /** Whole bytes left. */
  left(): number {
    return (this.end - this.pos) >> 3;
  }
  take(n: number): Uint8Array {
    if (this.pos + n * 8 > this.end) throw new Short();
    const at = this.pos >> 3;
    this.pos += n * 8;
    return this.bytes.subarray(at, at + n);
  }
}

/** Collects one part of the result twice: as rows for people and as JSON with the standard's field names. */
class Out {
  rows: Row[] = [];
  json: Record<string, unknown> = {};
  add(key: string, value: unknown, shown?: string, note?: string) {
    this.json[key] = value;
    this.rows.push({ label: key, value: shown ?? String(value), ...(note ? { note } : {}) });
  }
}

const hex = (v: number, digits = 2) => '0x' + v.toString(16).toUpperCase().padStart(digits, '0');
const hexBytes = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).toUpperCase().padStart(2, '0')).join('');
const printable = (b: Uint8Array) => b.length > 0 && b.every((x) => x >= 0x20 && x <= 0x7e);
const text = (b: Uint8Array) => String.fromCharCode(...b);
const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
const seconds = (ticks: number) => (ticks / TICKS).toFixed(6);
const two = (n: number) => String(n).padStart(2, '0');

/** 90 kHz ticks as HH:MM:SS.mmm. */
export function clock(ticks: number): string {
  const ms = Math.round(ticks / 90);
  return `${two(Math.floor(ms / 3600000))}:${two(Math.floor(ms / 60000) % 60)}:${two(Math.floor(ms / 1000) % 60)}.${String(ms % 1000).padStart(3, '0')}`;
}

let CRC_TABLE: Uint32Array | undefined;
/** CRC-32/MPEG-2, the checksum at the end of every SCTE-35 section. */
export function crc32(data: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i << 24;
      for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1;
      CRC_TABLE[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const x of data) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ x) & 0xff]) >>> 0;
  return crc >>> 0;
}

/** EIDR check character (ISO 7064 Mod 37,36) over the 20 hex digits of the suffix. */
export function eidrCheck(digits: string): string {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let p = 36;
  for (const c of digits.toUpperCase()) {
    const s = (p + chars.indexOf(c)) % 36 || 36;
    p = (s * 2) % 37;
  }
  return chars[(37 - p) % 36];
}

// ---------------------------------------------------------------------------------------------
// Times

function addPts(o: Out, key: string, pts: number, adjustment: number) {
  o.json[key] = round6(pts / TICKS);
  o.json[`${key}_ticks`] = pts;
  o.rows.push({ label: key, value: `${seconds(pts)} s`, note: `${pts} ticks · ${clock(pts)}` });
  if (adjustment) {
    const real = (pts + adjustment) % WRAP;
    o.json[`${key}_adjusted`] = round6(real / TICKS);
    o.rows.push({ label: `${key} + pts_adjustment`, value: `${seconds(real)} s`, note: `${real} ticks · ${clock(real)}` });
  }
}

function spliceTime(b: Bits, o: Out, adjustment: number) {
  const specified = b.flag();
  o.add('time_specified_flag', specified, undefined, specified ? undefined : 'No time given: the splice happens immediately');
  if (specified) {
    b.skip(6);
    addPts(o, 'pts_time', b.read(33), adjustment);
  } else b.skip(7);
}

function breakDuration(b: Bits, o: Out) {
  const auto = b.flag();
  b.skip(6);
  const d = b.read(33);
  o.add('auto_return', auto, undefined, auto ? 'Returns to the network by itself when the break ends' : 'A second cue is needed to return to the network');
  o.json.break_duration = round6(d / TICKS);
  o.json.break_duration_ticks = d;
  o.rows.push({ label: 'break_duration', value: `${seconds(d)} s`, note: `${d} ticks · ${clock(d)}` });
}

const GPS_EPOCH = Date.UTC(1980, 0, 6) / 1000;
function utcTime(o: Out, key: string, s: number) {
  const iso = new Date((GPS_EPOCH + s) * 1000).toISOString().replace('.000Z', 'Z');
  o.json[key] = s;
  o.rows.push({ label: key, value: iso, note: `${s} seconds since 6 January 1980 UTC` });
}

// ---------------------------------------------------------------------------------------------
// Commands

function eventHeader(b: Bits, o: Out): boolean {
  const id = b.read(32);
  o.add('splice_event_id', id, `${hex(id, 8)} (${id})`);
  const cancel = b.flag();
  b.skip(7);
  o.add('splice_event_cancel_indicator', cancel, undefined, cancel ? 'Cancels the earlier event with this id' : undefined);
  return cancel;
}

function eventFooter(b: Bits, o: Out) {
  o.add('unique_program_id', b.read(16));
  o.add('avail_num', b.read(8));
  o.add('avails_expected', b.read(8));
}

function spliceInsert(b: Bits, o: Out, adjustment: number) {
  if (eventHeader(b, o)) return;
  const out = b.flag();
  const program = b.flag();
  const duration = b.flag();
  const immediate = b.flag();
  const compliance = b.flag();
  b.skip(3);
  o.add('out_of_network_indicator', out, undefined, out ? 'Leaves the network: the break starts' : 'Returns to the network: the break ends');
  o.add('program_splice_flag', program, undefined, program ? 'The whole programme splices together' : 'Each component splices on its own');
  o.add('duration_flag', duration);
  o.add('splice_immediate_flag', immediate, undefined, immediate ? 'Splices at the next opportunity, not at a set time' : undefined);
  o.add('event_id_compliance_flag', compliance);
  if (program && !immediate) spliceTime(b, o, adjustment);
  if (!program) {
    const count = b.read(8);
    o.add('component_count', count);
    const components: unknown[] = [];
    for (let i = 0; i < count; i++) {
      const c = new Out();
      c.add('component_tag', b.read(8));
      if (!immediate) spliceTime(b, c, adjustment);
      components.push(c.json);
      o.rows.push(...c.rows.map((r) => ({ ...r, label: `component ${i + 1} · ${r.label}` })));
    }
    o.json.components = components;
  }
  if (duration) breakDuration(b, o);
  eventFooter(b, o);
}

function spliceSchedule(b: Bits, o: Out) {
  const count = b.read(8);
  o.add('splice_count', count);
  const events: unknown[] = [];
  for (let i = 0; i < count; i++) {
    const e = new Out();
    if (!eventHeader(b, e)) {
      const out = b.flag();
      const program = b.flag();
      const duration = b.flag();
      b.skip(5);
      e.add('out_of_network_indicator', out, undefined, out ? 'Leaves the network: the break starts' : 'Returns to the network: the break ends');
      e.add('program_splice_flag', program);
      e.add('duration_flag', duration);
      if (program) utcTime(e, 'utc_splice_time', b.read(32));
      else {
        const n = b.read(8);
        e.add('component_count', n);
        const components: unknown[] = [];
        for (let k = 0; k < n; k++) {
          const c = new Out();
          c.add('component_tag', b.read(8));
          utcTime(c, 'utc_splice_time', b.read(32));
          components.push(c.json);
          e.rows.push(...c.rows.map((r) => ({ ...r, label: `component ${k + 1} · ${r.label}` })));
        }
        e.json.components = components;
      }
      if (duration) breakDuration(b, e);
      eventFooter(b, e);
    }
    events.push(e.json);
    o.rows.push(...e.rows.map((r) => ({ ...r, label: `event ${i + 1} · ${r.label}` })));
  }
  o.json.events = events;
}

// ---------------------------------------------------------------------------------------------
// Descriptors

function upidValue(type: number, b: Uint8Array): { shown: string; json: unknown } {
  switch (type) {
    case 0x00:
      return { shown: '(none)', json: null };
    case 0x02: case 0x03: case 0x07: case 0x09: case 0x0e: case 0x0f: case 0x11:
      if (printable(b)) return { shown: text(b), json: text(b) };
      break;
    case 0x04: // UMID
      if (b.length === 32) {
        const h = hexBytes(b);
        return { shown: h.match(/.{8}/g)!.join('.'), json: h };
      }
      break;
    case 0x06: // ISAN (V-ISAN, 96 bits)
      if (b.length === 12) {
        const h = hexBytes(b);
        return { shown: h.match(/.{4}/g)!.join('-'), json: h };
      }
      break;
    case 0x08: // AiringID
      return { shown: '0x' + hexBytes(b), json: '0x' + hexBytes(b) };
    case 0x0a: // EIDR, compact binary: 2-byte sub-prefix, 80-bit suffix
      if (b.length === 12) {
        const suffix = hexBytes(b.subarray(2));
        const id = `10.${(b[0] << 8) | b[1]}/${suffix.match(/.{4}/g)!.join('-')}-${eidrCheck(suffix)}`;
        return { shown: id, json: id };
      }
      break;
    case 0x0b: // ATSC Content Identifier
      if (b.length >= 4) {
        const r = new Bits(b);
        const tsid = r.read(16);
        r.skip(2);
        const endOfDay = r.read(5);
        const uniqueFor = r.read(9);
        const content = b.subarray(4);
        const id = printable(content) ? text(content) : hexBytes(content);
        return { shown: `TSID ${tsid}, end_of_day ${endOfDay}, unique_for ${uniqueFor}, content_id ${id}`, json: { TSID: tsid, end_of_day: endOfDay, unique_for: uniqueFor, content_id: id } };
      }
      break;
    case 0x0c: // MPU: format_identifier + private data
      if (b.length >= 4) {
        const format = b.subarray(0, 4);
        const data = b.subarray(4);
        const f = printable(format) ? text(format) : '0x' + hexBytes(format);
        const d = printable(data) ? text(data) : '0x' + hexBytes(data);
        return { shown: `format_identifier ${f}, private_data ${d}`, json: { format_identifier: f, private_data: d } };
      }
      break;
    case 0x0d: { // MID: several UPIDs in a row
      const parts: { type: string; value: unknown }[] = [];
      const shown: string[] = [];
      let i = 0;
      while (i + 2 <= b.length) {
        const t = b[i];
        const len = b[i + 1];
        const v = upidValue(t, b.subarray(i + 2, i + 2 + len));
        parts.push({ type: UPID_TYPES[t] ?? hex(t), value: v.json });
        shown.push(`${UPID_TYPES[t] ?? hex(t)}: ${v.shown}`);
        i += 2 + len;
      }
      return { shown: shown.join(' · '), json: parts };
    }
    case 0x10: // UUID
      if (b.length === 16) {
        const h = hexBytes(b).toLowerCase();
        const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
        return { shown: id, json: id };
      }
      break;
  }
  if (printable(b)) return { shown: text(b), json: text(b) };
  return { shown: '0x' + hexBytes(b), json: '0x' + hexBytes(b) };
}

function segmentation(d: Bits, o: Out): string | undefined {
  const id = d.read(32);
  o.add('segmentation_event_id', id, `${hex(id, 8)} (${id})`);
  const cancel = d.flag();
  const compliance = d.flag();
  d.skip(6);
  o.add('segmentation_event_cancel_indicator', cancel, undefined, cancel ? 'Cancels the earlier event with this id' : undefined);
  o.add('segmentation_event_id_compliance_indicator', compliance);
  if (cancel) return 'cancel';
  const program = d.flag();
  const hasDuration = d.flag();
  const notRestricted = d.flag();
  o.add('program_segmentation_flag', program);
  o.add('segmentation_duration_flag', hasDuration);
  o.add('delivery_not_restricted_flag', notRestricted, undefined, notRestricted ? 'No delivery restrictions' : 'The four restriction fields below apply');
  if (!notRestricted) {
    o.add('web_delivery_allowed_flag', d.flag());
    o.add('no_regional_blackout_flag', d.flag());
    o.add('archive_allowed_flag', d.flag());
    const device = d.read(2);
    o.add('device_restrictions', device, `${device} (${DEVICE[device]})`);
  } else d.skip(5);
  if (!program) {
    const count = d.read(8);
    o.add('component_count', count);
    const components: unknown[] = [];
    for (let i = 0; i < count; i++) {
      const c = new Out();
      c.add('component_tag', d.read(8));
      d.skip(7);
      const offset = d.read(33);
      c.json.pts_offset = round6(offset / TICKS);
      c.rows.push({ label: 'pts_offset', value: `${seconds(offset)} s`, note: `${offset} ticks` });
      components.push(c.json);
      o.rows.push(...c.rows.map((r) => ({ ...r, label: `component ${i + 1} · ${r.label}` })));
    }
    o.json.components = components;
  }
  let duration: number | undefined;
  if (hasDuration) {
    duration = d.read(40);
    o.json.segmentation_duration = round6(duration / TICKS);
    o.json.segmentation_duration_ticks = duration;
    o.rows.push({ label: 'segmentation_duration', value: `${seconds(duration)} s`, note: `${duration} ticks · ${clock(duration)}` });
  }
  const upidType = d.read(8);
  const upidLength = d.read(8);
  o.add('segmentation_upid_type', upidType, `${hex(upidType)} (${UPID_TYPES[upidType] ?? 'reserved'})`);
  o.add('segmentation_upid_length', upidLength);
  const upid = upidValue(upidType, d.take(upidLength));
  o.add('segmentation_upid', upid.json, upid.shown);
  const type = d.read(8);
  const name = SEGMENTATION_TYPES[type] ?? 'Reserved';
  o.add('segmentation_type_id', type, `${hex(type)} (${name})`);
  o.add('segment_num', d.read(8));
  o.add('segments_expected', d.read(8));
  if (SUB_SEGMENTS.has(type) && d.left() >= 2) {
    o.add('sub_segment_num', d.read(8));
    o.add('sub_segments_expected', d.read(8));
  }
  return `${name}${duration !== undefined ? `, ${(duration / TICKS).toFixed(3)} s` : ''}`;
}

function descriptor(tag: number, d: Bits, o: Out): string | undefined {
  const identifier = d.read(32);
  const idBytes = new Uint8Array([identifier >>> 24, (identifier >>> 16) & 0xff, (identifier >>> 8) & 0xff, identifier & 0xff]);
  o.add('identifier', printable(idBytes) ? text(idBytes) : hex(identifier, 8), undefined, identifier === CUEI ? undefined : 'Not "CUEI": a private descriptor, shown as bytes');
  if (identifier !== CUEI || !(tag in DESCRIPTORS)) {
    const rest = d.take(d.left());
    o.add('private_bytes', '0x' + hexBytes(rest));
    return undefined;
  }
  switch (tag) {
    case 0x00:
      o.add('provider_avail_id', d.read(32));
      return undefined;
    case 0x01: {
      const preroll = d.read(8);
      o.add('preroll', preroll, `${(preroll / 10).toFixed(1)} s`);
      const count = d.read(3);
      d.skip(5);
      o.add('dtmf_count', count);
      o.add('DTMF_chars', text(d.take(count)));
      return undefined;
    }
    case 0x02:
      return segmentation(d, o);
    case 0x03: {
      const tai = d.read(48);
      const ns = d.read(32);
      const offset = d.read(16);
      o.add('TAI_seconds', tai);
      o.add('TAI_ns', ns);
      o.add('UTC_offset', offset, `${offset} s`);
      const date = new Date((tai - offset) * 1000 + Math.floor(ns / 1e6));
      o.rows.push({ label: 'UTC', value: Number.isNaN(date.getTime()) ? 'Out of range' : date.toISOString(), note: 'TAI_seconds − UTC_offset' });
      return undefined;
    }
    case 0x04: {
      const count = d.read(4);
      d.skip(4);
      o.add('audio_count', count);
      const audio: unknown[] = [];
      for (let i = 0; i < count; i++) {
        const c = new Out();
        c.add('component_tag', d.read(8));
        c.add('ISO_code', text(d.take(3)));
        c.add('Bit_Stream_Mode', d.read(3));
        c.add('Num_Channels', d.read(4));
        c.add('Full_Srvc_Audio', d.flag());
        audio.push(c.json);
        o.rows.push(...c.rows.map((r) => ({ ...r, label: `audio ${i + 1} · ${r.label}` })));
      }
      o.json.components = audio;
      return undefined;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// The section

/** Decodes a pasted SCTE-35 cue. Never throws. */
export function decode(input: string): Result {
  const read = readInput(input);
  if ('error' in read) return { ok: false, error: read.error };
  return parse(read.bytes);
}

export function parse(bytes: Uint8Array): Result {
  if (bytes.length < 1 || bytes[0] !== 0xfc) {
    return { ok: false, error: `This is not a SCTE-35 cue: a cue starts with the byte 0xFC (base64 "/…", hex "FC…")${bytes.length ? `, and this one starts with ${hex(bytes[0])}` : ''}.` };
  }
  if (bytes.length < 3) return { ok: false, error: 'The cue is cut short: it ends inside its first three bytes.' };
  const warnings: string[] = [];
  const b = new Bits(bytes);
  const s = new Out();
  s.add('table_id', b.read(8), '0xFC');
  const syntax = b.flag();
  const priv = b.flag();
  s.add('section_syntax_indicator', syntax, undefined, syntax ? 'Should be 0 in SCTE-35' : undefined);
  s.add('private_indicator', priv, undefined, priv ? 'Should be 0 in SCTE-35' : undefined);
  const sap = b.read(2);
  s.add('sap_type', sap, `${hex(sap, 1)} (${SAP[sap]})`);
  const sectionLength = b.read(12);
  const total = 3 + sectionLength;
  s.add('section_length', sectionLength, undefined, `${total} bytes in all`);
  if (bytes.length < total) {
    return { ok: false, error: `The cue is cut short: its header says ${total} bytes, but only ${bytes.length} were pasted. Copy the whole cue again.` };
  }
  if (bytes.length > total) warnings.push(`${bytes.length - total} bytes after the end of the section were ignored.`);
  if (total < 20) return { ok: false, error: `The cue is too short: a SCTE-35 section has at least 20 bytes, and this one says ${total}.` };
  b.end = total * 8;

  const stored = ((bytes[total - 4] << 24) | (bytes[total - 3] << 16) | (bytes[total - 2] << 8) | bytes[total - 1]) >>> 0;
  const computed = crc32(bytes.subarray(0, total - 4));
  const crcOk = stored === computed;
  if (!crcOk) warnings.push(`CRC_32 does not match: the cue says ${hex(stored, 8)}, the bytes give ${hex(computed, 8)}. The cue was changed or damaged, so the fields below may be wrong.`);

  try {
    const version = b.read(8);
    s.add('protocol_version', version, undefined, version ? 'Only version 0 is defined' : undefined);
    const encrypted = b.flag();
    const algorithm = b.read(6);
    s.add('encrypted_packet', encrypted);
    s.add('encryption_algorithm', algorithm, `${algorithm} (${ENCRYPTION[algorithm] ?? (algorithm >= 32 ? 'User private' : 'Reserved')})`);
    const adjustment = b.read(33);
    s.json.pts_adjustment = round6(adjustment / TICKS);
    s.json.pts_adjustment_ticks = adjustment;
    s.rows.push({ label: 'pts_adjustment', value: `${seconds(adjustment)} s`, note: `${adjustment} ticks${adjustment ? ' · added to every pts_time' : ''}` });
    const cwIndex = b.read(8);
    s.add('cw_index', cwIndex, hex(cwIndex));
    const tier = b.read(12);
    s.add('tier', tier, hex(tier, 3), tier === 0xfff ? 'All tiers' : undefined);
    const commandLength = b.read(12);
    s.add('splice_command_length', commandLength, undefined, commandLength === 0xfff ? 'Not given (an old encoder)' : `${commandLength} bytes`);
    const commandType = b.read(8);
    const commandName = COMMANDS[commandType] ?? 'reserved';
    s.add('splice_command_type', commandType, `${hex(commandType)} (${commandName})`);
    const section: Block = { title: 'splice_info_section', rows: s.rows };
    const json: Record<string, unknown> = { info_section: s.json };
    const blocks: Block[] = [section];
    const crcRow = { label: 'CRC_32', value: hex(stored, 8), note: crcOk ? 'Matches the bytes' : `Does not match: the bytes give ${hex(computed, 8)}` };
    s.json.crc_32 = hex(stored, 8);

    if (encrypted) {
      warnings.push('This cue is encrypted: its command and descriptors can only be read with the key, so only the header is shown.');
      section.rows.push(crcRow);
      return { ok: true, summary: `Encrypted cue (${commandName})`, bytes: total, crcOk, warnings, blocks, json };
    }

    // The command
    const c = new Out();
    const start = b.pos;
    let readable = true;
    switch (commandType) {
      case 0x00: case 0x07: break;
      case 0x04: spliceSchedule(b, c); break;
      case 0x05: spliceInsert(b, c, adjustment); break;
      case 0x06: spliceTime(b, c, adjustment); break;
      default:
        if (commandLength === 0xfff) { readable = false; break; }
        if (commandType === 0xff) {
          const id = b.read(32);
          c.add('identifier', id, hex(id, 8));
          c.add('private_bytes', '0x' + hexBytes(b.take(Math.max(0, commandLength - 4))));
        } else c.add('bytes', '0x' + hexBytes(b.take(commandLength)), undefined, 'A reserved command type');
    }
    json.command = { name: commandName, ...c.json };
    blocks.push({ title: commandName, rows: c.rows.length ? c.rows : [{ label: '—', value: commandType === 0 ? 'No fields: a heartbeat that keeps the link alive' : 'No fields' }] });
    if (!readable) {
      warnings.push('The command length is not given, so the rest of the cue cannot be found.');
      section.rows.push(crcRow);
      return { ok: true, summary: commandName, bytes: total, crcOk, warnings, blocks, json };
    }
    const used = (b.pos - start) / 8;
    if (commandLength !== 0xfff && used !== commandLength) {
      warnings.push(`splice_command_length says ${commandLength} bytes, but the ${commandName} fields take ${used}. The cue was built wrongly; reading goes on after ${commandLength} bytes.`);
      b.pos = start + commandLength * 8;
    }

    // The descriptors
    const loopLength = b.read(16);
    section.rows.push({ label: 'descriptor_loop_length', value: String(loopLength), note: `${loopLength} bytes` });
    s.json.descriptor_loop_length = loopLength;
    const crcAt = (total - 4) * 8;
    let loopEnd = b.pos + loopLength * 8;
    if (loopEnd > crcAt) {
      warnings.push(`descriptor_loop_length says ${loopLength} bytes, but only ${(crcAt - b.pos) / 8} are left before the CRC.`);
      loopEnd = crcAt;
    }
    const descriptors: unknown[] = [];
    const notes: string[] = [];
    let n = 0;
    while (b.pos + 16 <= loopEnd) {
      n++;
      const tag = b.read(8);
      const length = b.read(8);
      const name = DESCRIPTORS[tag] ?? 'private descriptor';
      const at = b.pos / 8;
      const room = (loopEnd - b.pos) / 8;
      const d = new Out();
      d.add('splice_descriptor_tag', tag, `${hex(tag)} (${name})`);
      d.add('descriptor_length', length);
      if (length > room) warnings.push(`Descriptor ${n} (${name}) says ${length} bytes, but only ${room} are left.`);
      let note: string | undefined;
      try {
        note = descriptor(tag, new Bits(bytes, at, at + Math.min(length, room)), d);
      } catch (e) {
        if (!(e instanceof Short)) throw e;
        warnings.push(`Descriptor ${n} (${name}) ends before all its fields: the fields shown are the ones it has.`);
      }
      b.pos = (at + Math.min(length, room)) * 8;
      descriptors.push({ name, ...d.json });
      blocks.push({ title: `Descriptor ${n}: ${name}${note && note !== 'cancel' ? ` · ${note}` : ''}`, rows: d.rows });
      if (note) notes.push(note === 'cancel' ? 'segmentation cancel' : note);
    }
    if (b.pos < loopEnd) b.pos = loopEnd;
    json.descriptors = descriptors;
    const stuffing = (crcAt - b.pos) / 8;
    if (stuffing > 0) section.rows.push({ label: 'alignment_stuffing', value: `${stuffing} bytes` });
    section.rows.push(crcRow);
    json.crc_ok = crcOk;

    return { ok: true, summary: summarize(commandName, c.json, notes), bytes: total, crcOk, warnings, blocks, json };
  } catch (e) {
    if (!(e instanceof Short)) throw e;
    return { ok: false, error: 'The cue ends in the middle of a field. Copy the whole cue again, or check that it is not cut.' };
  }
}

function summarize(name: string, c: Record<string, unknown>, notes: string[]): string {
  const at = (v: unknown) => (typeof v === 'number' ? `at ${v.toFixed(6)} s` : 'immediately');
  const parts: string[] = [name];
  if (name === 'splice_insert') {
    if (c.splice_event_cancel_indicator) parts.push('cancels the event');
    else {
      parts.push(c.out_of_network_indicator ? 'break starts' : 'break ends');
      parts.push(at(c.pts_time));
      if (typeof c.break_duration === 'number') parts.push(`break ${c.break_duration.toFixed(3)} s${c.auto_return ? ', auto-return' : ''}`);
    }
  } else if (name === 'time_signal') parts.push(at(c.pts_time));
  else if (name === 'splice_schedule') parts.push(`${c.splice_count} event${c.splice_count === 1 ? '' : 's'}`);
  else if (name === 'splice_null') parts.push('heartbeat');
  return [...parts, ...notes].join(' · ');
}

// ---------------------------------------------------------------------------------------------
// Showing the result (the same HTML at build time and in the browser)

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function renderHtml(r: Result): string {
  if (!r.ok) return `<p class="notice notice--red" role="alert">${esc(r.error)}</p>`;
  const head = `<div class="stack" style="--gap: 10px">
    <div class="btn-row" style="gap: 8px"><span class="badge ${r.crcOk ? 'badge--green' : 'badge--red'}">${r.crcOk ? 'CRC_32 OK' : 'CRC_32 does not match'}</span><span class="badge badge--accent">${r.bytes} bytes</span></div>
    <p class="mono" style="margin: 0; font-size: 17px; font-weight: 500; overflow-wrap: anywhere">${esc(r.summary)}</p>
  </div>`;
  const warnings = r.warnings.map((w) => `<p class="notice notice--amber">${esc(w)}</p>`).join('');
  const blocks = r.blocks.map((block) => `<section class="stack" style="--gap: 8px">
    <h3 class="h3 mono" style="font-size: 16px; overflow-wrap: anywhere">${esc(block.title)}</h3>
    <div class="scroll-x"><table class="dtable"><tbody>${block.rows.map((row) => `<tr><th scope="row" class="mono">${esc(row.label).replace(/_/g, '_<wbr>')}</th><td class="mono">${esc(row.value)}</td><td>${row.note ? esc(row.note) : ''}</td></tr>`).join('')}</tbody></table></div>
  </section>`).join('');
  return `${head}${warnings}${blocks}`;
}
