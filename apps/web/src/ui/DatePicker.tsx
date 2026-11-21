// The one date picker of 9eye (docs/design/date-picker.md, mockup DatePicker.dc.html): one day, one
// channel week or a range; a typeable field, a quiet header button or an inline calendar. Values are
// "YYYY-MM-DD" calendar days; the channel decides the week and what "today" is. StartEndPicker: a
// start and an end picked apart, each with its own one-day calendar.

import * as RPopover from '@radix-ui/react-popover';
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './cx';
import {
  MONTHS,
  MONTHS_LONG,
  WEEKDAYS_LONG,
  WEEKDAYS_SHORT,
  channelWeek,
  dayCount,
  dayText,
  dayTextLong,
  daysInMonth,
  limitMessage,
  makeDate,
  monthDays,
  parseDay,
  parts,
  plusDays,
  plusMonths,
  spanText,
  weekCount,
  weekdayIndex,
} from './dates';
import { Icon } from './icons';

export type DateMark = 'ok' | 'warn' | 'error' | 'info' | 'muted';
export interface DateLegendItem {
  tone: DateMark;
  label: string;
}

interface Common {
  /** `field`: typeable input with a calendar button · `quiet`: text button for page headers · `inline`: calendar always shown. */
  variant?: 'field' | 'quiet' | 'inline';
  /** The channel's first weekday (0 = Sunday). */
  weekStart: number;
  /** The channel's current broadcast day, from the server. */
  today: string;
  min?: string;
  max?: string;
  /** Why days outside min / max cannot be picked. */
  limitText?: string;
  marks?: Record<string, DateMark>;
  legend?: DateLegendItem[];
  label?: string;
  /** The label names the field for screen readers only (StartEndPicker shows one label for two fields). */
  labelHidden?: boolean;
  /** Day field: "22 Oct 2026" without the weekday (narrow fields; the calendar still names it). */
  noWeekday?: boolean;
  help?: ReactNode;
  /** A refusal from the page (shown in red under the field). */
  error?: string | null;
  width?: number;
  /** Field variant: takes the width of its container instead of `width`. */
  fill?: boolean;
  align?: 'start' | 'end';
  /** Quiet variant: ‹ › move one day (day) or one week (week). */
  step?: boolean;
  disabled?: boolean;
}
export type DatePickerProps = Common &
  (
    | { mode: 'day'; value: string; onChange: (v: { value: string }) => void }
    | { mode: 'week'; value: string; onChange: (v: { from: string; to: string }) => void }
    | { mode: 'range'; from: string; to: string; wholeWeeks?: boolean; onChange: (v: { from: string; to: string }) => void }
  );

/** When Tab was last pressed: focus that follows it is the user's own, so the calendar opens. */
let lastTab = 0;
if (typeof window !== 'undefined') {
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Tab') lastTab = Date.now();
    },
    true,
  );
}

const MARK_CLASS: Record<DateMark, string> = { ok: 'bg-green', warn: 'bg-amber', error: 'bg-red', info: 'bg-accent', muted: 'bg-text-3' };
const ROUND = 6;

export function DatePicker(props: DatePickerProps) {
  const { mode, variant = 'field', weekStart, today, min, max, marks = {}, legend = [], label, labelHidden, noWeekday, help, error, align = 'start', step, disabled, fill } = props;
  const isRange = mode === 'range';
  const wholeWeeks = props.mode === 'range' && !!props.wholeWeeks;
  const inline = variant === 'inline';
  const cur = props.mode === 'range' ? props.from : props.value || today;
  const rFrom = props.mode === 'range' ? props.from || today : '';
  const rTo = props.mode === 'range' ? props.to || plusDays(today, 6) : '';
  const [wa, wb] = channelWeek(cur, weekStart);
  const anchorDay = isRange ? rFrom : cur;

  const [open, setOpen] = useState(false);
  const [view, setView] = useState(`${anchorDay.slice(0, 7)}-01`);
  const [focus, setFocus] = useState<string | null>(null);
  const [kb, setKb] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [first, setFirst] = useState<string | null>(null);
  const [ta, setTa] = useState<string | null>(null);
  const [tb, setTb] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [monthsOpen, setMonthsOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Move focus into the calendar when it opens (keyboard, calendar button, quiet trigger). */
  const focusGrid = useRef(false);
  /** Focus goes back to the field after a pick; that focus must not open the calendar again. */
  const refocusing = useRef(false);
  const uid = useId();

  const outOf = (d: string) => !!((min && d < min) || (max && d > max));
  const weekOut = (d: string) => {
    const w = channelWeek(d, weekStart);
    return !!((min && w[1] < min) || (max && w[0] > max));
  };
  const off = (d: string) => (mode === 'week' ? weekOut(d) : outOf(d));
  const limitMsg = props.limitText || limitMessage(min, max);
  const snapA = (d: string) => (wholeWeeks ? channelWeek(d, weekStart)[0] : d);
  const snapB = (d: string) => (wholeWeeks ? channelWeek(d, weekStart)[1] : d);

  /** Open or close. `grid`: focus the calendar; `keys`: opened from the keyboard (show the focus ring). */
  const show = (o: boolean, grid = false, keys = false, at = anchorDay) => {
    if (disabled) return;
    if (o) {
      setView(`${at.slice(0, 7)}-01`);
      setFocus(at);
      setKb(keys);
      focusGrid.current = grid;
    } else {
      setFirst(null);
      setHover(null);
      setMonthsOpen(false);
    }
    setOpen(o);
  };
  const done = () => {
    if (!inline) show(false);
  };

  const pickDay = (d: string) => {
    if (off(d)) return;
    setFocus(d);
    setErr('');
    if (props.mode === 'day') {
      setTa(null);
      props.onChange({ value: d });
      return done();
    }
    if (props.mode === 'week') {
      const w = channelWeek(d, weekStart);
      setTa(null);
      props.onChange({ from: w[0], to: w[1] });
      return done();
    }
    if (!first) {
      setFirst(snapA(d));
      return;
    }
    let lo = first;
    let hi = snapB(d);
    if (d < first) {
      lo = snapA(d);
      hi = wholeWeeks ? channelWeek(first, weekStart)[1] : first;
    }
    setFirst(null);
    setHover(null);
    setTa(null);
    setTb(null);
    props.onChange({ from: lo, to: hi });
    done();
  };

  // ---------------------------------------------------------------- typing
  const checkTyped = (txt: string, which: 'a' | 'b'): { value: string } | { error: string } => {
    const r = parseDay(txt, today);
    if ('error' in r) return r;
    let v = r.value;
    if (isRange && wholeWeeks) v = which === 'b' ? snapB(v) : snapA(v);
    if (mode === 'week' ? weekOut(v) : outOf(v)) return { error: limitMsg };
    if (isRange && which === 'a' && v > rTo) return { error: `The start is after the end (${dayText(rTo)}).` };
    if (isRange && which === 'b' && v < rFrom) return { error: `The end is before the start (${dayText(rFrom)}).` };
    return { value: v };
  };
  const commitTyped = (which: 'a' | 'b') => {
    const typed = which === 'a' ? ta : tb;
    if (typed === null) return;
    const r = checkTyped(typed, which);
    if ('error' in r) return setErr(r.error);
    const v = r.value;
    setErr('');
    setView(`${v.slice(0, 7)}-01`);
    setFocus(v);
    if (props.mode === 'range') {
      if (which === 'a') setTa(null);
      else setTb(null);
      props.onChange({ from: which === 'a' ? v : rFrom, to: which === 'b' ? v : rTo });
    } else {
      setTa(null);
      if (props.mode === 'week') {
        const w = channelWeek(v, weekStart);
        props.onChange({ from: w[0], to: w[1] });
      } else props.onChange({ value: v });
    }
  };
  const fieldText = (which: 'a' | 'b') => {
    const typed = which === 'a' ? ta : tb;
    if (typed !== null) return typed;
    if (isRange) return dayText(which === 'a' ? rFrom : rTo);
    return mode === 'week' ? spanText(wa, wb) : dayText(cur, !noWeekday);
  };
  const input = (which: 'a' | 'b') => (
    <input
      ref={which === 'a' ? inputRef : undefined}
      className="mono h-full min-w-0 flex-1 border-0 bg-transparent text-small text-text outline-none disabled:text-text-3"
      aria-label={`${label || 'Date'}${isRange ? (which === 'a' ? ', from' : ', to') : ''}. Type a date or press Down for the calendar`}
      aria-invalid={err && (which === 'a' ? ta : tb) !== null ? true : undefined}
      value={fieldText(which)}
      disabled={disabled}
      onChange={(e) => {
        if (which === 'a') setTa(e.target.value);
        else setTb(e.target.value);
        setErr('');
      }}
      // Opens on a click, or when Tab brings the user here — not when a dialog or popover focuses it.
      onFocus={() => {
        if (!open && !refocusing.current && Date.now() - lastTab < 400) show(true);
      }}
      onClick={() => {
        if (!open) show(true);
      }}
      onBlur={() => commitTyped(which)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commitTyped(which);
        else if (e.key === 'Escape') {
          setTa(null);
          setTb(null);
          setErr('');
          show(false);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          const at = which === 'b' ? rTo : anchorDay;
          if (!open) show(true, true, true, at);
          else {
            setKb(true);
            setFocus(at);
            setView(`${at.slice(0, 7)}-01`);
          }
          requestAnimationFrame(() => gridRef.current?.focus());
        }
      }}
    />
  );

  // ---------------------------------------------------------------- calendar
  const [vy, vm] = parts(view);
  let lo: string | null = null;
  let hi: string | null = null;
  if (isRange) {
    if (first) {
      const b = hover || first;
      lo = b < first ? snapA(b) : first;
      hi = b < first ? (wholeWeeks ? channelWeek(first, weekStart)[1] : first) : snapB(b);
    } else {
      lo = rFrom;
      hi = rTo;
    }
  } else if (mode === 'week') {
    lo = wa;
    hi = wb;
  }
  const hoverWeek = mode === 'week' && hover ? channelWeek(hover, weekStart) : null;
  const focusDay = focus || anchorDay;
  const toneLabel = (t: DateMark) => legend.find((x) => x.tone === t)?.label ?? '';
  const days = monthDays(view, weekStart);

  const gridKey = (e: KeyboardEvent) => {
    let f = focusDay;
    const mv = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>)[e.key];
    if (mv) f = plusDays(f, mv);
    else if (e.key === 'PageUp' || e.key === 'PageDown') f = plusMonths(f, e.key === 'PageUp' ? -1 : 1);
    else if (e.key === 'Home') f = channelWeek(f, weekStart)[0];
    else if (e.key === 'End') f = channelWeek(f, weekStart)[1];
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pickDay(f);
      return;
    } else return;
    e.preventDefault();
    setFocus(f);
    setKb(true);
    setView(`${f.slice(0, 7)}-01`);
    if ((isRange && first) || mode === 'week') setHover(f);
  };

  const tw = channelWeek(today, weekStart);
  type Preset = { label: string; off: boolean; go: () => void };
  const rangeTo = (a: string, b: string) => () => {
    setFirst(null);
    setErr('');
    if (props.mode === 'range') props.onChange({ from: a, to: b });
    done();
  };
  const presets: Preset[] =
    mode === 'day'
      ? ([
          ['Today', today],
          ['Tomorrow', plusDays(today, 1)],
          [`Next ${WEEKDAYS_LONG[weekStart]}`, plusDays(tw[0], 7)],
        ] as const).map(([l, v]) => ({ label: l, off: outOf(v), go: () => pickDay(v) }))
      : mode === 'week'
        ? ([
            ['This week', today],
            ['Next week', plusDays(today, 7)],
            ['In 2 weeks', plusDays(today, 14)],
          ] as const).map(([l, v]) => ({ label: l, off: weekOut(v), go: () => pickDay(v) }))
        : wholeWeeks
          ? ([
              ['This week', 1],
              ['4 weeks', 4],
              ['13 weeks', 13],
            ] as const).map(([l, n]) => ({ label: l, off: outOf(tw[0]) || outOf(plusDays(tw[0], n * 7 - 1)), go: rangeTo(tw[0], plusDays(tw[0], n * 7 - 1)) }))
          : ([
              ['This week', tw[0], tw[1]],
              ['Next 4 weeks', today, plusDays(today, 27)],
              ['Rest of the month', today, makeDate(parts(today)[0], parts(today)[1], daysInMonth(parts(today)[0], parts(today)[1]))!],
            ] as const).map(([l, a, b]) => ({ label: l, off: outOf(a) || outOf(b), go: rangeTo(a, b) }));

  let summary = '';
  if (isRange) {
    if (first) summary = `From ${dayText(first)}. Now pick the last day${wholeWeeks ? ' (its whole week is taken).' : '.'}`;
    else {
      const n = weekCount(rFrom, rTo, weekStart);
      summary = `${dayCount(rFrom, rTo)} days · ${n} channel week${n > 1 ? 's' : ''}${wholeWeeks ? ` · whole weeks, ${WEEKDAYS_LONG[weekStart]} to ${WEEKDAYS_LONG[(weekStart + 6) % 7]}` : ''}`;
    }
  } else if (mode === 'week') summary = `${spanText(wa, wb)} · ${WEEKDAYS_LONG[weekStart]} to ${WEEKDAYS_LONG[(weekStart + 6) % 7]}`;
  else summary = `${dayTextLong(cur)}${cur === today ? ' · today' : ''}`;

  const panel = (
    <div className="flex w-[296px] max-w-full flex-col gap-2 px-3 pb-3 pt-2.5" aria-label={`${label || 'Date'} calendar`} role={inline ? 'group' : undefined}>
      <div className="flex items-center gap-0.5">
        <button type="button" aria-expanded={monthsOpen} onClick={() => setMonthsOpen(!monthsOpen)} className="hov inline-flex h-[30px] cursor-pointer items-center gap-1 rounded-ctl border-0 bg-transparent px-2 font-semibold">
          {MONTHS_LONG[vm - 1]} {vy}
          <Icon name={monthsOpen ? 'chevronUp' : 'chevronDown'} size={13} className="text-text-3" />
        </button>
        <span className="flex-1" />
        {(['prev', 'next'] as const).map((k) => {
          const l = monthsOpen ? (k === 'prev' ? 'Previous year' : 'Next year') : k === 'prev' ? 'Previous month' : 'Next month';
          return (
            <button
              key={k}
              type="button"
              aria-label={l}
              title={l}
              onClick={() => setView(monthsOpen ? `${vy + (k === 'prev' ? -1 : 1)}-${String(vm).padStart(2, '0')}-01` : plusMonths(view, k === 'prev' ? -1 : 1))}
              className="hov inline-flex size-[30px] cursor-pointer items-center justify-center rounded-ctl border-0 bg-transparent p-0 text-text-2"
            >
              <Icon name={k === 'prev' ? 'chevronLeft' : 'chevronRight'} size={15} />
            </button>
          );
        })}
      </div>
      {monthsOpen ? (
        <div className="grid grid-cols-3 gap-1 py-1">
          {MONTHS.map((m, i) => {
            const isView = i + 1 === vm;
            const isSel = anchorDay.slice(0, 7) === `${vy}-${String(i + 1).padStart(2, '0')}`;
            return (
              <button
                key={m}
                type="button"
                aria-pressed={isView}
                onClick={() => {
                  setView(`${vy}-${String(i + 1).padStart(2, '0')}-01`);
                  setMonthsOpen(false);
                }}
                className={cx(
                  'hov h-9 cursor-pointer rounded-ctl border-0 text-small',
                  isSel ? 'bg-accent-soft font-semibold text-accent-text' : isView ? 'bg-surface-2 font-semibold' : 'bg-transparent',
                )}
              >
                {m}
              </button>
            );
          })}
        </div>
      ) : (
        <div
          ref={gridRef}
          role="grid"
          aria-label={`${MONTHS_LONG[vm - 1]} ${vy}`}
          tabIndex={0}
          aria-activedescendant={`${uid}-${focusDay}`}
          onKeyDown={gridKey}
          onMouseLeave={() => setHover(null)}
          className="flex flex-col rounded-ctl outline-offset-2"
        >
          <div role="row" className="grid grid-cols-7">
            {Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7).map((w) => (
              <span key={w} role="columnheader" aria-label={WEEKDAYS_LONG[w]} className="flex h-[26px] items-center justify-center text-[11.5px] text-text-3">
                {WEEKDAYS_SHORT[w].slice(0, 2)}
              </span>
            ))}
          </div>
          {Array.from({ length: 6 }, (_, r) => (
            <div key={r} role="row" className="mt-0.5 grid grid-cols-7">
              {days.slice(r * 7, r * 7 + 7).map((d, c) => {
                const inMonth = d.slice(0, 7) === view.slice(0, 7);
                const isOff = off(d);
                const isToday = d === today;
                const mark = marks[d];
                let look = 'bg-transparent';
                let sel = false;
                let radius = `${ROUND}px`;
                const band = (a: string, b: string) => {
                  const l = d === a || c === 0;
                  const rr = d === b || c === 6;
                  return `${l ? ROUND : 0}px ${rr ? ROUND : 0}px ${rr ? ROUND : 0}px ${l ? ROUND : 0}px`;
                };
                let filled = false;
                if (mode === 'day') {
                  if (d === cur) {
                    look = 'bg-accent text-on-accent font-semibold';
                    sel = filled = true;
                  }
                } else if (lo && hi && d >= lo && d <= hi) {
                  sel = true;
                  radius = band(lo, hi);
                  if (isRange && (d === lo || d === hi)) {
                    look = 'bg-accent text-on-accent font-semibold';
                    filled = true;
                  } else look = 'bg-accent-soft text-accent-text font-medium';
                } else if (hoverWeek && d >= hoverWeek[0] && d <= hoverWeek[1]) {
                  look = 'bg-surface-2';
                  radius = band(hoverWeek[0], hoverWeek[1]);
                }
                const [y, m, dd] = parts(d);
                const markLabel = mark ? toneLabel(mark) : '';
                return (
                  <button
                    key={d}
                    id={`${uid}-${d}`}
                    type="button"
                    role="gridcell"
                    tabIndex={-1}
                    aria-selected={sel}
                    aria-disabled={isOff}
                    aria-label={`${WEEKDAYS_LONG[weekdayIndex(d)]} ${dd} ${MONTHS_LONG[m - 1]} ${y}${isToday ? ', today' : ''}${markLabel ? `, ${markLabel}` : ''}${isOff ? ', not available' : ''}`}
                    title={isOff ? limitMsg : markLabel}
                    onClick={() => pickDay(d)}
                    onMouseEnter={() => {
                      if ((isRange && first) || mode === 'week') setHover(d);
                    }}
                    className={cx(
                      'relative flex h-[34px] flex-col items-center justify-center gap-px border-0 p-0',
                      look,
                      !inMonth && !sel && 'text-text-3',
                      isOff ? 'cursor-default opacity-35' : 'cursor-pointer hover:shadow-[inset_0_0_0_1px_var(--border-strong)]',
                      !isOff && !inMonth && !sel && 'opacity-60',
                    )}
                    style={{ borderRadius: radius, outline: kb && d === focusDay ? '2px solid var(--accent)' : 'none', outlineOffset: -2 }}
                  >
                    <span className={cx('mono text-[13px] leading-4', isToday && 'font-semibold underline underline-offset-[3px]')}>{dd}</span>
                    <span aria-hidden="true" className={cx('size-1 rounded-full', mark ? (filled ? 'bg-on-accent' : MARK_CLASS[mark]) : 'bg-transparent')} />
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
      {presets.length > 0 && (
        <div className="flex flex-wrap gap-1 border-t border-hairline pt-2">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              disabled={p.off}
              onClick={p.go}
              className="hov h-[26px] cursor-pointer rounded-[13px] border border-border bg-surface px-[9px] text-meta font-medium"
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
      <span className={cx('text-[12.5px]', err ? 'text-red-text' : 'text-text-2')}>{err || summary}</span>
      {legend.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-meta text-text-3">
          {legend.map((l) => (
            <span key={l.tone + l.label} className="inline-flex items-center gap-[5px]">
              <span className={cx('size-1.5 rounded-full', MARK_CLASS[l.tone])} />
              {l.label}
            </span>
          ))}
        </div>
      )}
      <span className="text-[11.5px] text-text-3">← → ↑ ↓ move · PgUp PgDn month · Enter pick · Esc close</span>
    </div>
  );

  if (inline) {
    return <div className="inline-flex rounded-card border border-border bg-surface">{panel}</div>;
  }

  const note = err || error || help;
  const noteRed = !!(err || error);
  const fieldW = props.width ?? (isRange ? 300 : mode === 'week' ? 230 : 200);

  // ---------------------------------------------------------------- quiet trigger
  const stepDays = mode === 'week' ? 7 : 1;
  const inNow = mode === 'week' ? today >= wa && today <= wb : cur === today;
  const go = (n: number) => {
    const v = plusDays(cur, n);
    if (mode === 'week' ? weekOut(v) : outOf(v)) return;
    if (props.mode === 'week') {
      const w = channelWeek(v, weekStart);
      props.onChange({ from: w[0], to: w[1] });
    } else if (props.mode === 'day') props.onChange({ value: v });
  };
  const prevOff = !!(min && plusDays(mode === 'week' ? wb : cur, -stepDays) < min);
  const nextOff = !!(max && plusDays(mode === 'week' ? wa : cur, stepDays) > max);
  const quietText = mode === 'week' ? spanText(wa, wb) : isRange ? spanText(rFrom, rTo) : dayText(cur, true);

  const trigger =
    variant === 'quiet' ? (
      <div ref={boxRef} className="inline-flex items-center gap-0.5">
        {step && (
          <button type="button" aria-label={mode === 'week' ? 'Previous week' : 'Previous day'} title={mode === 'week' ? 'Previous week' : 'Previous day'} disabled={prevOff || disabled} onClick={() => go(-stepDays)} className="ctl hov inline-flex size-ctl cursor-pointer items-center justify-center rounded-ctl border-0 bg-transparent p-0 text-text-3">
            <Icon name="chevronLeft" size={16} />
          </button>
        )}
        <RPopover.Trigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label={`Pick ${mode === 'week' ? 'week' : 'day'}, current ${mode === 'week' ? spanText(wa, wb) : dayTextLong(cur)}`}
            aria-expanded={open}
            className="ctl hov inline-flex h-ctl cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-ctl border-0 bg-transparent px-2 font-medium text-text-2"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' && !open) {
                e.preventDefault();
                show(true, true, true);
              }
            }}
          >
            {quietText}
            <Icon name="chevronDown" size={14} />
          </button>
        </RPopover.Trigger>
        {step && (
          <button type="button" aria-label={mode === 'week' ? 'Next week' : 'Next day'} title={mode === 'week' ? 'Next week' : 'Next day'} disabled={nextOff || disabled} onClick={() => go(stepDays)} className="ctl hov inline-flex size-ctl cursor-pointer items-center justify-center rounded-ctl border-0 bg-transparent p-0 text-text-3">
            <Icon name="chevronRight" size={16} />
          </button>
        )}
        {mode !== 'range' &&
          (inNow ? (
            <span className="ml-1 inline-flex h-[22px] items-center whitespace-nowrap rounded-[11px] bg-surface-2 px-2 text-meta text-text-2">{mode === 'week' ? 'This week' : 'Today'}</span>
          ) : (
            <button type="button" disabled={disabled || off(today)} onClick={() => pickDay(today)} className="hov ml-1 h-6 cursor-pointer whitespace-nowrap rounded-[12px] border border-border-strong bg-surface px-[9px] text-meta font-medium text-text">
              {mode === 'week' ? 'This week' : 'Today'}
            </button>
          ))}
      </div>
    ) : (
      <div className={cx('flex-col gap-1', fill ? 'flex w-full' : 'inline-flex')}>
        {label && !labelHidden && <span className="text-meta text-text-2">{label}</span>}
        <RPopover.Anchor asChild>
          <div
            ref={boxRef}
            className={cx(
              'inline-flex h-ctl max-w-full items-center gap-0.5 rounded-ctl border bg-surface pl-2.5 pr-0.5',
              noteRed ? 'border-red' : open ? 'border-accent' : 'border-border-strong',
              disabled && 'bg-surface-2',
            )}
            style={{ width: fill ? '100%' : fieldW }}
          >
            {input('a')}
            {isRange && (
              <>
                <span aria-hidden="true" className="px-1 text-text-3">
                  →
                </span>
                {input('b')}
              </>
            )}
            <button
              type="button"
              disabled={disabled}
              aria-label={open ? 'Close calendar' : 'Open calendar'}
              title={open ? 'Close calendar' : 'Open calendar'}
              aria-expanded={open}
              onClick={() => show(!open, true)}
              className="ctl hov inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[5px] border-0 bg-transparent p-0 text-text-3"
            >
              <Icon name="calendar" size={15} />
            </button>
          </div>
        </RPopover.Anchor>
        {note && <span className={cx('text-meta', noteRed ? 'text-red-text' : 'text-text-3')} style={{ maxWidth: fill ? undefined : fieldW }}>{note}</span>}
      </div>
    );

  return (
    <RPopover.Root open={open} onOpenChange={(o) => show(o, o)}>
      {trigger}
      <RPopover.Portal>
        <RPopover.Content
          align={align}
          side="bottom"
          sideOffset={6}
          collisionPadding={12}
          aria-label={`${label || 'Date'} calendar`}
          className="z-50 rounded-card border border-border bg-surface shadow-pop outline-none"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            if (focusGrid.current) requestAnimationFrame(() => gridRef.current?.focus());
          }}
          onCloseAutoFocus={(e) => {
            if (variant !== 'field') return;
            e.preventDefault();
            const el = document.activeElement;
            if (!el || el === document.body) {
              refocusing.current = true;
              inputRef.current?.focus();
              refocusing.current = false;
            }
          }}
          onInteractOutside={(e) => {
            if (boxRef.current?.contains(e.target as Node)) e.preventDefault();
          }}
          onEscapeKeyDown={() => {
            setTa(null);
            setTb(null);
            setErr('');
          }}
        >
          {panel}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}

/**
 * A start and an end picked apart (order dates; user, 2026-10-23): one label over two day fields with
 * an arrow between, as wide as its column. Each opens a one-day calendar limited by the other.
 */
export function StartEndPicker({
  label,
  weekStart,
  today,
  start,
  end,
  min,
  help,
  disabled,
  onChange,
}: {
  label: string;
  weekStart: number;
  today: string;
  start: string;
  end: string;
  /** The earliest start (a new order: today). */
  min?: string;
  help?: ReactNode;
  disabled?: boolean;
  onChange: (v: { start: string; end: string }) => void;
}) {
  const from = min ? (min === today ? 'From today' : `From ${dayText(min)}`) : '';
  return (
    <div role="group" aria-label={label} className="flex w-full flex-col gap-1">
      <span className="text-meta text-text-2">{label}</span>
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <DatePicker
            mode="day"
            label="Start date"
            labelHidden
            noWeekday
            fill
            weekStart={weekStart}
            today={today}
            value={start}
            min={min}
            max={end}
            limitText={from ? `${from} to the end, ${dayText(end)}.` : `On or before the end, ${dayText(end)}.`}
            disabled={disabled}
            onChange={(v) => onChange({ start: v.value, end })}
          />
        </div>
        <span aria-hidden="true" className="inline-flex h-ctl items-center px-0.5 text-text-3">
          →
        </span>
        <div className="min-w-0 flex-1">
          <DatePicker
            mode="day"
            label="End date"
            labelHidden
            noWeekday
            fill
            align="end"
            weekStart={weekStart}
            today={today}
            value={end}
            min={start}
            limitText={`On or after the start, ${dayText(start)}.`}
            disabled={disabled}
            onChange={(v) => onChange({ start, end: v.value })}
          />
        </div>
      </div>
      {help && <span className="text-meta text-text-3">{help}</span>}
    </div>
  );
}
