// Admin → Channels → one channel (mockup the Admin mockup (private)): settings cards in two columns and an
// "About this channel" column (Used by · What can change · Export file name). One save, all-or-nothing.
// Rules: frame rate and day start are locked while templates or block types use them; the first
// weekday changes only when every template fits the new week; the ads playlist goes off only when
// nothing uses it (docs/design/channel-settings-page.md).

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AGE_LOGO_POSITIONS,
  EPG_TYPES,
  EXPORTERS,
  FRAME_RATES,
  FRAME_RATE_CODES,
  WEEKDAYS,
  checkDates,
  exportFileName,
  exporterLabel,
  formatDate,
  formatTc,
  formatTcShort,
  frameRate,
  lastWeekday,
  parseTc,
  type FrameRate,
} from '@9eye/core';
import { ApiError, api, errorText, type Problem } from '@/lib/api';
import { keys, useChannels } from '@/lib/queries';
import type { BreakList, Channel, ChannelUsage } from '@/lib/types';
import {
  AddPill,
  Badge,
  Breadcrumb,
  Button,
  Card,
  DatePicker,
  DotItem,
  Field,
  Icon,
  InsetRow,
  Menu,
  MenuItem,
  Notice,
  Pill,
  SelectField,
  Switch,
  TextField,
  useToast,
  type DotTone,
} from '@/ui';
import { WEEKDAY_CHOICES } from './ChannelsSection';

const LOCALES = ['en', 'en-GB', 'en-US', 'ar', 'cs', 'da', 'de', 'el', 'es', 'fa', 'fi', 'fr', 'he', 'hi', 'hu', 'id', 'it', 'ja', 'ko', 'ms', 'nb', 'nl', 'pl', 'pt', 'pt-BR', 'ro', 'ru', 'sv', 'th', 'tr', 'uk', 'ur', 'zh'];
const languageName = (() => {
  try {
    const names = new Intl.DisplayNames(['en'], { type: 'language' });
    return (code: string) => names.of(code) ?? code;
  } catch {
    return (code: string) => code;
  }
})();
const TIME_ZONES: string[] = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone');
  } catch {
    return [];
  }
})();

interface Form {
  name: string;
  code: string;
  frameRate: string;
  dayStart: string;
  weekStart: string;
  timeZone: string;
  dateLocale: string;
  hasAds: boolean;
  ageLogoPosition: string;
  defaultBreakListId: string;
  shortestBreak: string;
  defaultExport: string;
  allowedExports: string[];
  epgType: string;
  bxfTimesUtc: boolean;
  reconcileTolerance: string;
}

/** "00:00:00", with frames only when there are some. */
function lengthText(frames: number, r: FrameRate): string {
  const tc = formatTc(frames, r);
  return /[:;]00$/.test(tc) ? tc.slice(0, -3) : tc;
}

function toForm(c: Channel): Form {
  const r = frameRate(c.frameRate);
  return {
    name: c.name,
    code: c.code,
    frameRate: c.frameRate,
    dayStart: formatTcShort(c.dayStartFrames, r),
    weekStart: String(c.weekStart),
    timeZone: c.timeZone ?? '',
    dateLocale: c.dateLocale,
    hasAds: !!c.adsPlaylistId,
    ageLogoPosition: c.ageLogoPosition ?? '',
    defaultBreakListId: c.defaultBreakListId ?? '',
    shortestBreak: lengthText(c.shortestBreakFrames, r),
    defaultExport: c.defaultExport ?? '',
    allowedExports: c.allowedExports,
    epgType: c.epgTypes[0] ?? '',
    bxfTimesUtc: c.bxfTimesUtc,
    reconcileTolerance: String(c.reconcileTolerance),
  };
}

function Locked({ children, locked }: { children: ReactNode; locked: boolean }) {
  return (
    <span className="flex items-center gap-1">
      {children}
      {locked && <Icon name="lock" size={11} strokeWidth={2} role="img" aria-label="Locked" aria-hidden={false} />}
    </span>
  );
}

export function ChannelSettings({ channelId }: { channelId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const channels = useChannels();
  const channel = channels.data?.find((c) => c.id === channelId) ?? null;
  const usage = useQuery({ queryKey: keys.channelUsage(channelId), queryFn: () => api<ChannelUsage>('GET', `/channels/${channelId}/usage`) });
  const lists = useQuery({
    queryKey: keys.breakLists(channelId),
    queryFn: () => api<BreakList[]>('GET', `/channels/${channelId}/break-lists`),
    enabled: !!channel?.adsPlaylistId,
  });

  const [form, setForm] = useState<Form | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ message: string; problems: Problem[] } | null>(null);
  const [fileDay, setFileDay] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  useEffect(() => {
    if (!channel) return;
    const key = `${channel.id}:${channel.version}`;
    if (key !== loaded) {
      setForm(toForm(channel));
      setLoaded(key);
      setRefusal(null);
      setConflict(false);
    }
  }, [channel, loaded]);

  const initial = useMemo(() => (channel ? toForm(channel) : null), [channel]);
  const changes = form && initial ? (Object.keys(form) as (keyof Form)[]).filter((k) => JSON.stringify(form[k]) !== JSON.stringify(initial[k])).length : 0;
  const set = (patch: Partial<Form>) => form && setForm({ ...form, ...patch });

  const save = useMutation({
    mutationFn: (body: object) => api<Channel>('PUT', `/channels/${channelId}`, body),
    onSuccess: (c) => {
      qc.setQueryData<Channel[]>(keys.channels(), (old) => old?.map((x) => (x.id === c.id ? c : x)));
      qc.invalidateQueries({ queryKey: keys.channels() });
      qc.invalidateQueries({ queryKey: keys.channelUsage(channelId) });
      qc.invalidateQueries({ queryKey: keys.allTemplates() });
      qc.invalidateQueries({ queryKey: keys.templates(channelId) });
      setRefusal(null);
      toast('Channel settings saved');
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) setConflict(true);
      else setRefusal({ message: errorText(e), problems: e instanceof ApiError ? e.problems : [] });
    },
  });

  if (channels.isSuccess && !channel) {
    return <Notice tone="amber" action={<Button size="sm" onClick={() => navigate('/admin/channels')}>All channels</Button>}>This channel does not exist (any more).</Notice>;
  }
  if (!channel || !form || !initial) return <span className="py-8 text-small text-text-3">Loading…</span>;

  const rate = FRAME_RATES[form.frameRate as keyof typeof FRAME_RATES] ?? frameRate(channel.frameRate);
  const dayStartFrames = parseTc(form.dayStart, rate, { maxHours: 23 });
  const shortestBreakFrames = parseTc(form.shortestBreak, rate, { maxHours: 23 });
  const tolerance = /^\d+$/.test(form.reconcileTolerance.trim()) ? Number(form.reconcileTolerance.trim()) : null;
  const u = usage.data;
  const templates = u?.templates ?? [];
  const locked = !!u && (templates.length > 0 || u.blockTypeCount > 0);
  const newWeek = Number(form.weekStart);
  const misfits = newWeek === channel.weekStart ? [] : templates.filter((t) => checkDates(t.validFrom, t.validTo, newWeek).length > 0);
  const weekConflict = misfits.length > 0;
  const adsTemplates = templates.filter((t) => t.kind === 'ads').length;
  const adsInUse = !!u && (adsTemplates > 0 || u.adsBlockTypeCount > 0 || u.mainTemplatesWithBreaks.length > 0);
  const adsOffConflict = !form.hasAds && !!channel.adsPlaylistId && adsInUse;
  const invalid = !form.name.trim() || dayStartFrames === null || shortestBreakFrames === null || tolerance === null;
  const saveBlocked = changes === 0 || weekConflict || adsOffConflict || invalid || save.isPending;

  const cur = WEEKDAYS[channel.weekStart].long;
  const curLast = WEEKDAYS[lastWeekday(channel.weekStart)].long;
  const n = misfits.length;
  const weekText =
    n === 1
      ? `The layout of this channel runs ${cur} to ${curLast}. It does not fit a week that starts on ${WEEKDAYS[newWeek].long}, so this cannot be saved. Change its dates first.`
      : `${n === 2 ? 'Both layouts' : `All ${n} layouts`} of this channel run ${cur} to ${curLast}. They do not fit a week that starts on ${WEEKDAYS[newWeek].long}, so this cannot be saved. Change their dates first.`;

  const lockWhy = u && templates.length && u.blockTypeCount ? 'layouts and block types' : templates.length ? 'layouts' : 'block types';
  const rules: { tone: DotTone; title: string; detail: string }[] = [
    { tone: 'green', title: 'Name, code, group, locale, defaults, exports', detail: 'Can change any time' },
    locked
      ? { tone: 'neutral', title: 'Frame rate and day start', detail: `Locked: the channel has ${lockWhy}. Every stored time depends on them.` }
      : { tone: 'green', title: 'Frame rate and day start', detail: 'Can change: no layout or block type uses them yet' },
    weekConflict
      ? { tone: 'amber', title: 'First weekday', detail: 'Blocked: the layouts do not fit the new week' }
      : { tone: 'green', title: 'First weekday', detail: 'Can change when every layout starts and ends with the new week' },
    form.hasAds
      ? { tone: 'green', title: 'Ads playlist', detail: 'On. Turning it off needs main layouts without linked breaks.' }
      : adsOffConflict
        ? { tone: 'amber', title: 'Ads playlist', detail: 'Blocked: the ads playlist is in use' }
        : { tone: 'amber', title: 'Ads playlist', detail: 'Off: main-template blocks have no linked breaks' },
  ];

  const kinds = new Set(templates.map((t) => t.kind));
  const usedDetail = !templates.length
    ? 'Open Layouts to make one'
    : `${kinds.has('main') && kinds.has('ads') ? 'Main playlist and ads playlist' : kinds.has('ads') ? 'Ads playlist' : 'Main playlist'} · open in Layouts`;
  const exporter = form.defaultExport || form.allowedExports[0] || '';
  const day = fileDay ?? channel.today;

  const doSave = () =>
    save.mutate({
      version: channel.version,
      name: form.name,
      code: form.code,
      frameRate: form.frameRate,
      dayStartFrames,
      weekStart: newWeek,
      timeZone: form.timeZone.trim() || null,
      dateLocale: form.dateLocale,
      hasAds: form.hasAds,
      ageLogoPosition: form.ageLogoPosition || null,
      defaultBreakListId: form.hasAds ? form.defaultBreakListId || null : null,
      shortestBreakFrames,
      defaultExport: form.defaultExport || null,
      allowedExports: form.allowedExports,
      epgTypes: form.epgType ? [form.epgType] : [],
      bxfTimesUtc: form.bxfTimesUtc,
      reconcileTolerance: tolerance,
    });

  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="flex flex-col gap-0.5 leading-[1.3]">
          <Breadcrumb parent="Channels" to="/admin/channels" current={channel.name} />
          <span className="flex items-center gap-2">
            <h2 className="m-0 text-[20px] font-semibold tracking-[-0.01em]">{channel.name}</h2>
            <span className="mono inline-flex h-[22px] items-center rounded-badge bg-surface-2 px-[7px] text-meta text-text-2">{channel.code}</span>
          </span>
        </span>
        <span className="flex-1" />
        {changes > 0 && (
          <Badge tone="amber" round>
            {changes === 1 ? '1 change' : `${changes} changes`}
          </Badge>
        )}
        <Button variant="ghost" disabled={changes === 0} onClick={() => { setForm(initial); setRefusal(null); }}>
          Discard
        </Button>
        <Button variant="primary" disabled={saveBlocked} onClick={doSave}>
          Save
        </Button>
      </div>

      {conflict && (
        <Notice tone="amber" action={<Button size="sm" onClick={() => { setLoaded(null); setConflict(false); void channels.refetch(); }}>Reload</Button>}>
          Someone else changed this channel since you opened it. Reload to see their settings; your changes here will be lost.
        </Notice>
      )}
      {refusal && (
        <Notice tone="red">
          <span className="font-medium">{refusal.message}</span>
          {refusal.problems.length > 0 && (
            <ul className="m-0 flex flex-col gap-1 pl-4">
              {refusal.problems.map((p, i) => (
                <li key={i}>
                  {p.message}
                  {p.templateId && (
                    <>
                      {' · '}
                      <Link to={`/templates?channel=${channel.id}&template=${p.templateId}`} className="font-medium text-red-text">
                        Open
                      </Link>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Notice>
      )}

      <div className="flex flex-wrap items-start gap-4">
        <div className="grid min-w-0 flex-[999_1_560px] grid-cols-[repeat(auto-fit,minmax(330px,1fr))] items-start gap-3.5">
          <Card title="Channel" subtitle="How it is named on every screen">
            <TextField label="Name" value={form.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} error={form.name.trim() ? undefined : 'A name is required.'} />
            <TextField label="Code" mono value={form.code} maxLength={20} onChange={(e) => set({ code: e.target.value })} hint="Letters, digits, - and _. Used in export file names." />
            <SelectField label="Channel group" value="" onChange={() => {}} title="Channel groups come later">
              <option value="">None</option>
            </SelectField>
          </Card>

          <Card title="Time" subtitle="Every time of this channel counts from its broadcast day">
            <div className="grid grid-cols-2 gap-3">
              <SelectField label={<Locked locked={locked}>Frame rate</Locked>} value={form.frameRate} disabled={locked} onChange={(e) => set({ frameRate: e.target.value })}>
                {FRAME_RATE_CODES.map((c) => (
                  <option key={c} value={c}>
                    {FRAME_RATES[c].label}
                  </option>
                ))}
              </SelectField>
              <TextField
                label={<Locked locked={locked}>Broadcast day starts</Locked>}
                mono
                value={form.dayStart}
                disabled={locked}
                onChange={(e) => set({ dayStart: e.target.value })}
                error={dayStartFrames === null ? 'Type a time of day, e.g. 06:00.' : undefined}
              />
              <SelectField label="First weekday" value={form.weekStart} onChange={(e) => set({ weekStart: e.target.value })} className={weekConflict ? '[&_select]:border-amber' : undefined}>
                {WEEKDAY_CHOICES.map((d) => (
                  <option key={d} value={String(d)}>
                    {WEEKDAYS[d].long}
                  </option>
                ))}
              </SelectField>
              <TextField label="Time zone" value={form.timeZone} placeholder="None (wall-clock time)" suggestions={TIME_ZONES} onChange={(e) => set({ timeZone: e.target.value })} />
              <SelectField label="Date locale" value={form.dateLocale} onChange={(e) => set({ dateLocale: e.target.value })}>
                {(LOCALES.includes(form.dateLocale) ? LOCALES : [form.dateLocale, ...LOCALES]).map((l) => (
                  <option key={l} value={l}>
                    {languageName(l)} ({l})
                  </option>
                ))}
              </SelectField>
            </div>
            {weekConflict && (
              <Notice tone="amber">
                <span>{weekText}</span>
                <ul className="m-0 flex flex-col gap-0.5 pl-4">
                  {misfits.map((t) => (
                    <li key={t.id}>
                      {t.name} · {t.kind === 'main' ? 'main' : 'ads'} playlist · {formatDate(t.validFrom)} → {formatDate(t.validTo)} ·{' '}
                      <Link to={`/templates?channel=${channel.id}&template=${t.id}`} className="font-medium text-amber-text">
                        Open
                      </Link>
                    </li>
                  ))}
                </ul>
              </Notice>
            )}
          </Card>

          <Card title="Playlists" subtitle="Programmes in the main playlist; sold breaks in the ads playlist">
            <InsetRow title="Main playlist" detail="Every channel has one">
              <span className="text-meta text-text-3">Always</span>
            </InsetRow>
            <InsetRow title="Ads playlist" detail="Main-template blocks get linked breaks from it">
              <Switch checked={form.hasAds} onChange={(v) => set({ hasAds: v })} label="Ads playlist" />
            </InsetRow>
            {adsOffConflict && (
              <Notice tone="amber">
                The ads playlist is in use ({[adsTemplates && `${adsTemplates} ads ${adsTemplates === 1 ? 'layout' : 'layouts'}`, u?.adsBlockTypeCount && `${u.adsBlockTypeCount} block types`, u?.mainTemplatesWithBreaks.length && 'main layouts with linked breaks'].filter(Boolean).join(', ')}), so it cannot be turned off.
              </Notice>
            )}
            <SelectField label="Age logo position" value={form.ageLogoPosition} onChange={(e) => set({ ageLogoPosition: e.target.value })}>
              <option value="">None</option>
              {AGE_LOGO_POSITIONS.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.label}
                </option>
              ))}
            </SelectField>
          </Card>

          <Card title="Defaults" subtitle="Used when layouts and playlists are filled">
            <SelectField label="Rotation list for gaps" value="" disabled onChange={() => {}} title="Rotation lists come with Media">
              <option value="">{channel.defaultRotationListName ?? 'None'}</option>
            </SelectField>
            <div className="grid grid-cols-2 gap-3">
              <SelectField label="Break list" value={form.hasAds ? form.defaultBreakListId : ''} disabled={!form.hasAds} onChange={(e) => set({ defaultBreakListId: e.target.value })}>
                <option value="">None</option>
                {(lists.data ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </SelectField>
              <TextField label="Shortest break" mono value={form.shortestBreak} onChange={(e) => set({ shortestBreak: e.target.value })} error={shortestBreakFrames === null ? 'Type a length, e.g. 00:00:30.' : undefined} />
            </div>
          </Card>

          <Card title="Export and EPG" subtitle="What the playout and EPG partners receive">
            <div className="grid grid-cols-2 gap-3">
              <SelectField
                label="Default export"
                value={form.defaultExport}
                onChange={(e) => {
                  const v = e.target.value;
                  set({ defaultExport: v, allowedExports: v && !form.allowedExports.includes(v) ? [...form.allowedExports, v] : form.allowedExports });
                }}
              >
                <option value="">None</option>
                {EXPORTERS.map((x) => (
                  <option key={x.code} value={x.code}>
                    {x.label}
                  </option>
                ))}
              </SelectField>
              <SelectField label="EPG types" value={form.epgType} onChange={(e) => set({ epgType: e.target.value })}>
                <option value="">None</option>
                {EPG_TYPES.map((x) => (
                  <option key={x.code} value={x.code}>
                    {x.label}
                  </option>
                ))}
              </SelectField>
            </div>
            <Field label="Allowed exports">
              <span className="flex flex-wrap gap-1.5">
                {form.allowedExports.map((code) => (
                  <Pill
                    key={code}
                    tone="accent"
                    removeLabel={`Remove ${exporterLabel(code)}`}
                    onRemove={() => set({ allowedExports: form.allowedExports.filter((x) => x !== code), defaultExport: form.defaultExport === code ? '' : form.defaultExport })}
                  >
                    {exporterLabel(code)}
                  </Pill>
                ))}
                {EXPORTERS.some((x) => !form.allowedExports.includes(x.code)) && (
                  <Menu label="Add an export" align="start" width={200} trigger={<AddPill>Add</AddPill>}>
                    {EXPORTERS.filter((x) => !form.allowedExports.includes(x.code)).map((x) => (
                      <MenuItem key={x.code} onSelect={() => set({ allowedExports: [...form.allowedExports, x.code] })}>
                        {x.label}
                      </MenuItem>
                    ))}
                  </Menu>
                )}
              </span>
            </Field>
            <div className="flex items-center justify-between gap-3">
              <span className="flex flex-col leading-[1.3]">
                <span className="text-small">BXF times in UTC</span>
                <span className="text-meta text-text-3">Only for BXF exports</span>
              </span>
              <Switch checked={form.bxfTimesUtc} onChange={(v) => set({ bxfTimesUtc: v })} label="BXF times in UTC" />
            </div>
          </Card>

          <Card title="Checks and reconciliation" subtitle="Playlist checks that run on this channel, and as-run matching">
            <div className="flex items-center gap-2.5 rounded-item border border-dashed border-border-strong px-3 py-2.5">
              <span className="flex-1 text-small text-text-3">No playlist checks assigned</span>
              <Button size="sm" disabled title="Playlist checks come later">
                Assign…
              </Button>
            </div>
            <TextField
              label="Reconciliation timing margin"
              mono
              className="[&_input]:w-[120px]"
              value={form.reconcileTolerance}
              onChange={(e) => set({ reconcileTolerance: e.target.value })}
              error={tolerance === null ? 'A whole number, 0 or more.' : undefined}
              hint="Difference accepted when the as-run log is matched"
            />
          </Card>
        </div>

        <aside aria-label="About this channel" className="flex min-w-[260px] max-w-full flex-[1_1_280px] flex-col gap-3.5 sm:max-w-[320px]">
          <Card title="Used by">
            <Link to={`/templates?channel=${channel.id}`} className="hov -mx-2.5 flex items-center gap-2.5 rounded-item px-2.5 py-2 text-text no-underline">
              <span className="flex flex-1 flex-col leading-[1.3]">
                <span className="text-small font-medium">{templates.length ? `${templates.length} ${templates.length === 1 ? 'layout' : 'layouts'}` : 'No layouts'}</span>
                <span className="text-meta text-text-3">{usedDetail}</span>
              </span>
              <Icon name="chevronRight" size={14} className="text-text-3" />
            </Link>
          </Card>
          <Card title="What can change">
            {rules.map((r) => (
              <DotItem key={r.title} tone={r.tone} title={r.title} detail={r.detail} />
            ))}
          </Card>
          <Card title="Export file name" className="gap-1.5">
            {exporter ? (
              <>
                <span className="mono rounded-ctl bg-surface-2 px-2 py-1.5 text-small [overflow-wrap:anywhere]">
                  {exportFileName(exporter, day, dayStartFrames ?? channel.dayStartFrames, rate, form.code.trim() || channel.code)}
                </span>
                <span className="text-meta text-text-3">
                  {exporterLabel(exporter)}, for the broadcast day of {formatDate(day)}
                  {exporter === 'playout-xml' ? ', from the day start above' : ''}
                </span>
                <span className="-ml-2">
                  <DatePicker mode="day" variant="quiet" step label="Broadcast day of the file name" weekStart={channel.weekStart} today={channel.today} value={day} onChange={(v) => setFileDay(v.value)} />
                </span>
              </>
            ) : (
              <span className="text-small text-text-3">No export chosen yet.</span>
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}
