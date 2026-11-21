// Dialogs of the Playlist page's Weeks tab: create a run of weeks, rename a week, delete a week.

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { WEEK_NAME_MAX, addDays, templatesForWeek, weekNumber, weekStarts, type PlaylistKindName, type WeekRunPlan } from '@9eye/core';
import { ApiError, api, errorText } from '@/lib/api';
import type { Channel } from '@/lib/types';
import { Button, CheckLine, Checkbox, DatePicker, DayToggles, Dialog, Field, Notice, SelectField, TextField, spanText, useToast } from '@/ui';
import { plural, type Week, type WeekRunBody } from './model';
import { useChannelTemplates, useWeekCheck, weekKeys } from './queries';

const KIND_LABEL: Record<PlaylistKindName, string> = { main: 'Main', ads: 'Ads' };
const ALL_DAYS = [true, true, true, true, true, true, true];

function Problems({ items, more = 6 }: { items: { message: string }[]; more?: number }) {
  return (
    <>
      {items.slice(0, more).map((p, i) => (
        <span key={i}>{p.message}</span>
      ))}
      {items.length > more && <span>And {items.length - more} more.</span>}
    </>
  );
}

export function CreateWeeksDialog({ open, onOpenChange, channel, initialWeek }: { open: boolean; onOpenChange: (o: boolean) => void; channel: Channel; initialWeek: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const hasAds = !!channel.adsPlaylistId;
  const [main, setMain] = useState(true);
  const [ads, setAds] = useState(hasAds);
  const [from, setFrom] = useState(initialWeek);
  const [to, setTo] = useState(initialWeek);
  const [pick, setPick] = useState<{ main?: string; ads?: string }>({});
  const [days, setDays] = useState<boolean[] | null>(null);
  const [error, setError] = useState<{ message: string; problems: { message: string }[] } | null>(null);
  useEffect(() => {
    if (!open) return;
    setMain(true);
    setAds(hasAds);
    setFrom(initialWeek);
    setTo(initialWeek);
    setPick({});
    setDays(null);
    setError(null);
  }, [open, initialWeek, hasAds]);

  const kinds = useMemo(() => [...(main ? (['main'] as const) : []), ...(ads && hasAds ? (['ads'] as const) : [])], [main, ads, hasAds]);
  const body: WeekRunBody = useMemo(() => ({ kinds, fromWeek: from, toWeek: to, templates: pick, activeWeekdays: days }), [kinds, from, to, pick, days]);
  const check = useWeekCheck(channel.id, body, open);
  const plan: WeekRunPlan | undefined = check.data;
  const templates = useChannelTemplates(channel.id, open);
  const count = from <= to ? weekStarts(from, to).length : 0;
  const shownDays = days ?? plan?.weeks[0]?.activeWeekdays ?? ALL_DAYS;

  const create = useMutation({
    mutationFn: () => api<{ weeks: Week[] }>('POST', `/channels/${channel.id}/weeks`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: weekKeys.all() });
      toast(`${plural(count, 'week')} created`);
      onOpenChange(false);
    },
    onError: (e) => {
      setError({ message: errorText(e), problems: e instanceof ApiError ? e.problems : [] });
      qc.invalidateQueries({ queryKey: weekKeys.all() });
      void check.refetch();
    },
  });

  const ready = !!plan && !plan.problems.length && plan.weeks.length > 0 && !check.isFetching && !create.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Create weeks"
      description={`${channel.name} · each week is a dated copy of its layout.`}
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!ready} onClick={() => { setError(null); create.mutate(); }}>
            {count ? `Create ${plural(count, 'week')}` : 'Create weeks'}
          </Button>
        </>
      }
    >
      {hasAds && (
        <div role="group" aria-label="Playlists" className="flex flex-col gap-1.5">
          <span className="text-meta text-text-2">Playlists</span>
          <div className="flex flex-wrap gap-x-5 gap-y-1.5">
            <Checkbox checked={main} onChange={setMain}>
              Main playlist
            </Checkbox>
            <Checkbox checked={ads} onChange={setAds}>
              Ads playlist
            </Checkbox>
          </div>
          <span className="text-meta text-text-3">Main is created first, then ads.</span>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <DatePicker
          mode="week"
          label="From week"
          width={236}
          weekStart={channel.weekStart}
          today={channel.today}
          value={from}
          onChange={(v) => {
            setFrom(v.from);
            if (to < v.from) setTo(v.from);
          }}
        />
        <DatePicker
          mode="week"
          label="To week"
          width={236}
          weekStart={channel.weekStart}
          today={channel.today}
          value={to}
          onChange={(v) => {
            setTo(v.from);
            if (v.from < from) setFrom(v.from);
          }}
        />
      </div>
      <span className="text-small text-text-2">
        {count ? `${plural(count, 'week')}: week ${weekNumber(from)}${count > 1 ? ` to week ${weekNumber(to)}` : ''}, ${spanText(from, addDays(to, 6))}.` : 'Pick the first and the last week.'}
      </span>

      <div className="flex flex-col gap-1.5">
        <span className="text-meta text-text-2">Layouts</span>
        {kinds.map((kind) => {
          const fitting = templatesForWeek((templates.data ?? []).filter((t) => t.kind === kind), from);
          const used = [...new Set((plan?.weeks ?? []).filter((w) => w.kind === kind).map((w) => w.templateName))];
          if (fitting.length > 1) {
            return (
              <SelectField key={kind} label={`${KIND_LABEL[kind]} playlist: ${fitting.length} layouts fit, pick one`} value={pick[kind] ?? ''} onChange={(e) => setPick({ ...pick, [kind]: e.target.value || undefined })}>
                <option value="">Pick a layout…</option>
                {fitting.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </SelectField>
            );
          }
          return (
            <span key={kind} className="flex gap-3 text-small">
              <span className="w-10 shrink-0 text-text-3">{KIND_LABEL[kind]}</span>
              <span className="min-w-0 [overflow-wrap:anywhere]">{used.length ? used.join(', ') : fitting[0]?.name ?? 'No layout for these dates'}</span>
            </span>
          );
        })}
        {!kinds.length && <span className="text-small text-text-3">Pick at least one playlist.</span>}
      </div>

      <Field label="Active days">
        <span className="flex flex-wrap items-center gap-3">
          <DayToggles
            label="Active days"
            tone="accent"
            size="sm"
            weekStart={channel.weekStart}
            value={shownDays}
            onToggle={(d) => setDays(shownDays.map((on, i) => (i === d ? !on : on)))}
          />
          {days ? (
            <Button size="xs" variant="ghost" onClick={() => setDays(null)}>
              Use the layout's days
            </Button>
          ) : (
            <span className="text-meta text-text-3">As in the layout. A day that is off gets no playlist.</span>
          )}
        </span>
      </Field>

      {plan && plan.weeks.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-meta text-text-2">Names</span>
          <div aria-label="Names of the new weeks" role="group" className="mono flex flex-col gap-0.5 rounded-item bg-surface-2 px-2.5 py-2 text-small">
            {plan.weeks.slice(0, 4).map((w) => (
              <span key={`${w.kind}${w.firstDate}`}>{w.name}</span>
            ))}
            {plan.weeks.length > 4 && <span className="text-text-3">+ {plan.weeks.length - 4} more</span>}
          </div>
          <span className="text-meta text-text-3">A week can be renamed afterwards.</span>
        </div>
      )}

      {plan && plan.problems.length > 0 && (
        <Notice tone="red">
          <span className="font-medium">Nothing is created until this is solved:</span>
          <Problems items={plan.problems} />
        </Notice>
      )}
      {plan && !plan.problems.length && plan.weeks.length > 0 && (
        <div aria-label="Checks" role="group" className="flex flex-col gap-1.5 rounded-item border border-border px-3 py-2.5">
          <CheckLine ok>None of these weeks exists yet.</CheckLine>
          <CheckLine ok>Every week is inside its layout's dates.</CheckLine>
          {plan.warnings.slice(0, 4).map((w, i) => (
            <CheckLine key={i} ok={false}>
              {w.message}
            </CheckLine>
          ))}
          {plan.warnings.length > 4 && <CheckLine ok={false}>And {plan.warnings.length - 4} more notes of the same kind.</CheckLine>}
        </div>
      )}
      {check.isError && <Notice tone="red">{errorText(check.error)}</Notice>}
      {error && (
        <Notice tone="red">
          <span className="font-medium">{error.message}</span>
          {error.problems.length > 1 && <Problems items={error.problems} />}
        </Notice>
      )}
    </Dialog>
  );
}

export function RenameWeekDialog({ week, onOpenChange }: { week: Week | null; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (week) {
      setName(week.name);
      setError(null);
    }
  }, [week]);
  const m = useMutation({
    mutationFn: () => api<Week>('PATCH', `/weeks/${week!.id}`, { name, version: week!.version }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: weekKeys.all() });
      toast('Week renamed');
      onOpenChange(false);
    },
    onError: (e) => {
      setError(errorText(e));
      qc.invalidateQueries({ queryKey: weekKeys.all() });
    },
  });
  const n = name.trim().length;
  const ok = n > 0 && n <= WEEK_NAME_MAX;
  return (
    <Dialog
      open={!!week}
      onOpenChange={onOpenChange}
      title={week ? `Rename week ${week.number}` : 'Rename week'}
      description={week ? `${spanText(week.firstDate, week.lastDate)}. Only the name changes.` : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!ok || m.isPending || name.trim() === week?.name} onClick={() => m.mutate()}>
            Rename
          </Button>
        </>
      }
    >
      <TextField
        label="Name"
        value={name}
        maxLength={WEEK_NAME_MAX}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && ok && name.trim() !== week?.name && m.mutate()}
        hint={`${n} of ${WEEK_NAME_MAX} characters`}
      />
      {error && <Notice tone="red">{error}</Notice>}
    </Dialog>
  );
}

export function DeleteWeekDialog({ week, onOpenChange }: { week: Week | null; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<{ message: string; problems: { message: string }[] } | null>(null);
  useEffect(() => {
    if (week) setError(null);
  }, [week]);
  const m = useMutation({
    mutationFn: () => api<void>('DELETE', `/weeks/${week!.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: weekKeys.all() });
      toast('Week deleted');
      onOpenChange(false);
    },
    onError: (e) => {
      setError({ message: errorText(e), problems: e instanceof ApiError ? e.problems : [] });
      qc.invalidateQueries({ queryKey: weekKeys.all() });
    },
  });
  const dayCount = week?.days.filter((d) => d.id).length ?? 0;
  return (
    <Dialog
      open={!!week}
      onOpenChange={onOpenChange}
      title={week ? `Delete week ${week.number}?` : 'Delete week?'}
      description={
        week
          ? `${week.name} (${spanText(week.firstDate, week.lastDate)}) is removed with its ${plural(dayCount, 'day playlist')}. The layout stays as it is, and the week can be created again.`
          : undefined
      }
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="secondary" className="text-red-text" disabled={m.isPending || !!error?.problems.length} onClick={() => m.mutate()}>
            Delete week
          </Button>
        </>
      }
    >
      {error && (
        <Notice tone="red">
          <span className="font-medium">{error.message}</span>
          <Problems items={error.problems} more={7} />
        </Notice>
      )}
    </Dialog>
  );
}
