// Playlist page — docs/design/weeks-page.md. Two tabs: Weeks (the month as a table of the channel's
// weeks: create, rename, delete) and Day (one day playlist, DayTab.tsx).

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { FRAME_RATES, WEEKDAYS, addDays, formatTcShort, weekNumber, weekOrder, weekStartsOfMonth, type PlaylistKindName } from '@9eye/core';
import { errorText } from '@/lib/api';
import {
  Button,
  ContextLink,
  ContextPicker,
  ContextText,
  EditorLayout,
  EmptyState,
  IconButton,
  ListItem,
  Menu,
  MenuItem,
  MenuSeparator,
  Notice,
  PageHeader,
  Segmented,
  StatusBar,
  TabBar,
  WeekLegend,
  WeekTable,
  dayText,
  spanText,
  type WeekTableRow,
} from '@/ui';
import { DayTab } from './DayTab';
import { CreateWeeksDialog, DeleteWeekDialog, RenameWeekDialog } from './dialogs';
import { MONTH_NAMES, STATE_LABEL, plural, type Week } from './model';
import { useChannels, useWeeks } from './queries';
import { dayKey, useAgentPage } from '@/features/agents/pageAgent';

type Tab = 'weeks' | 'day';
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const shortDay = (iso: string) => dayText(iso).replace(/ \d{4}$/, '');

export function PlaylistPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const channels = useChannels();
  const channelList = channels.data ?? [];
  // A channel in the address that no longer exists falls back to the default.
  const wanted = params.get('channel');
  const channelId = wanted && (!channels.data || channelList.some((c) => c.id === wanted)) ? wanted : ((channelList.find((c) => c.templateCount > 0) ?? channelList[0])?.id ?? null);
  const channel = channelList.find((c) => c.id === channelId) ?? null;
  const kind: PlaylistKindName = params.get('playlist') === 'ads' && channel?.adsPlaylistId ? 'ads' : 'main';
  const tab: Tab = params.get('tab') === 'day' ? 'day' : 'weeks';
  const wantedMonth = params.get('month');
  const month = wantedMonth && MONTH.test(wantedMonth) ? wantedMonth : (channel?.today.slice(0, 7) ?? null);
  const year = month ? Number(month.slice(0, 4)) : new Date().getFullYear();
  const monthNo = month ? Number(month.slice(5, 7)) : 1;
  const wantedDay = params.get('date');
  const day = wantedDay && DAY.test(wantedDay) ? wantedDay : (channel?.today ?? null);
  // what the agent panel sees (decision 0024, phase B); a change of this day can be previewed here
  useAgentPage(
    channel
      ? {
          name: tab === 'day' ? 'Playlist › Day' : 'Playlist › Weeks',
          sees: `${channel.name} (code ${channel.code}) · ${kind === 'ads' ? 'ads' : 'main'} playlist · ${tab === 'day' && day ? `the broadcast day ${day}` : `the weeks of ${month}`}`,
          previewKey: tab === 'day' && day ? dayKey(channel.id, kind, day) : undefined,
        }
      : null,
  );

  /** Set by the Day tab while it has unsaved changes: it asks before the page goes elsewhere. */
  const guardRef = useRef<((go: () => void) => void) | null>(null);
  const patch = (changes: Record<string, string | null>) => (guardRef.current ? guardRef.current(() => applyPatch(changes)) : applyPatch(changes));
  const applyPatch = (changes: Record<string, string | null>) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(changes)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      return next;
    });

  const weeks = useWeeks(channelId, kind, year);
  const byFirst = useMemo(() => new Map((weeks.data ?? []).map((w) => [w.firstDate, w])), [weeks.data]);

  const [createFrom, setCreateFrom] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Week | null>(null);
  const [deleting, setDeleting] = useState<Week | null>(null);

  const starts = channel && month ? weekStartsOfMonth(year, monthNo, channel.weekStart) : [];
  const made = starts.filter((s) => byFirst.has(s)).length;
  /** The week Create weeks starts with: the month's first week without one, else the week after the month's last. */
  const nextMissing = starts.find((s) => !byFirst.has(s)) ?? (starts.length ? addDays(starts[starts.length - 1], 7) : null);

  // ------------------------------------------------------------ header
  const rate = channel ? FRAME_RATES[channel.frameRate as keyof typeof FRAME_RATES] : undefined;
  const settings = channel && rate ? `Week starts ${WEEKDAYS[channel.weekStart].long} · day starts ${formatTcShort(channel.dayStartFrames, rate)} · ${rate.label}` : '';
  const header = (extra: ReactNode) => (
    <PageHeader
      title="Playlist"
      context={
        <>
          <ContextPicker
            label="Channel"
            searchLabel="channels"
            value={channelId ?? ''}
            items={channelList.map((c) => ({ id: c.id, name: c.name }))}
            onPick={(id) => patch({ channel: id, playlist: null, month: null, date: null })}
          />
          {settings && <ContextText>{settings}</ContextText>}
          {channel && <ContextLink to={`/admin/channels/${channel.id}`}>Change in channel settings</ContextLink>}
        </>
      }
      actions={
        <>
          {channel?.adsPlaylistId && (
            <Segmented
              label="Playlist"
              value={kind}
              onChange={(v) => patch({ playlist: v === 'ads' ? 'ads' : null })}
              options={[
                { value: 'main', label: 'Main playlist' },
                { value: 'ads', label: 'Ads playlist' },
              ]}
            />
          )}
          {extra}
        </>
      }
    />
  );
  const weeksActions = (
    <>
      <Menu label="More actions" trigger={<IconButton icon="more" label="More actions" />}>
        <MenuItem disabled={!channel} onSelect={() => navigate(`/templates?channel=${channel?.id}`)}>
          Open layouts
        </MenuItem>
        <MenuItem disabled title="EPG exports are not built yet">
          Download EPG…
        </MenuItem>
      </Menu>
      <Button variant="primary" disabled={!channel || !nextMissing} onClick={() => setCreateFrom(nextMissing)}>
        Create weeks
      </Button>
    </>
  );

  const tabs = (
    <div className="flex px-4 pt-4 sm:px-8">
      <TabBar
        label="Playlist views"
        value={tab}
        onChange={(v) => patch({ tab: v === 'day' ? 'day' : null })}
        tabs={[
          { value: 'weeks', label: 'Weeks' },
          { value: 'day', label: 'Day' },
        ]}
      />
    </div>
  );

  if (!channel || !month) {
    return (
      <>
        {header(null)}
        <div className="max-w-xl px-4 pt-6 sm:px-8">
          {channels.isError ? <Notice tone="red">{errorText(channels.error)}</Notice> : <EmptyState>{channels.isLoading ? 'Loading…' : 'This company has no channel yet. Add one in Settings.'}</EmptyState>}
        </div>
      </>
    );
  }

  if (tab === 'day') {
    return <DayTab channel={channel} kind={kind} date={day ?? channel.today} patch={patch} header={header} tabs={tabs} guardRef={guardRef} />;
  }

  // ------------------------------------------------------------ left: the year's months
  const left = (
    <>
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="flex items-center gap-0.5">
          <IconButton icon="chevronLeft" size="sm" label="Previous year" onClick={() => patch({ month: `${year - 1}-${month.slice(5)}` })} />
          <span className="mono px-1 font-semibold">{year}</span>
          <IconButton icon="chevronRight" size="sm" label="Next year" onClick={() => patch({ month: `${year + 1}-${month.slice(5)}` })} />
        </span>
        <Button size="xs" onClick={() => patch({ month: null })}>
          Today
        </Button>
      </div>
      <div role="group" aria-label={`Months of ${year}`} className="flex flex-col gap-0.5">
        {MONTH_NAMES.map((name, i) => {
          const s = weekStartsOfMonth(year, i + 1, channel.weekStart);
          const have = s.filter((d) => byFirst.has(d)).length;
          const value = `${year}-${String(i + 1).padStart(2, '0')}`;
          return (
            <ListItem
              key={name}
              title={name}
              selected={value === month}
              badge={weeks.data ? { label: `${have} of ${s.length}`, tone: have === s.length ? 'green' : 'neutral' } : undefined}
              onClick={() => patch({ month: value })}
            />
          );
        })}
      </div>
      <div className="border-t border-border px-3 pt-3.5">
        <WeekLegend />
      </div>
    </>
  );

  // ------------------------------------------------------------ middle: the month's weeks
  const rows: WeekTableRow[] = starts.map((first) => {
    const w = byFirst.get(first);
    const number = weekNumber(first);
    if (!w) {
      return {
        key: first,
        title: `Week ${number}`,
        subtitle: 'No week yet',
        action: (
          <Button size="xs" aria-label={`Create week ${number}`} onClick={() => setCreateFrom(first)}>
            Create
          </Button>
        ),
        days: Array.from({ length: 7 }, (_, i) => {
          const date = addDays(first, i);
          return { key: date, date: shortDay(date), tone: 'none' as const, today: date === channel.today, ariaLabel: `${dayText(date, true)}, not created` };
        }),
      };
    }
    return {
      key: first,
      title: `Week ${w.number}`,
      subtitle: w.name,
      days: w.days.map((d) => ({
        key: d.date,
        date: shortDay(d.date),
        label: STATE_LABEL[d.state],
        meta: d.id ? plural(d.blocks, 'block') : undefined,
        tone: d.state === 'not-active' ? ('off' as const) : d.state,
        today: d.date === channel.today,
        ariaLabel: `${dayText(d.date, true)}, ${STATE_LABEL[d.state].toLowerCase()}${d.id ? `, ${plural(d.blocks, 'block')}` : ''}`,
        onClick: d.id ? () => patch({ tab: 'day', date: d.date }) : undefined,
      })),
      menu: (
        <Menu label={`Actions for week ${w.number}`} trigger={<IconButton icon="more" label={`Actions for week ${w.number}`} />}>
          <MenuItem disabled title="The week's own grid is the next part to be built">
            Open week
          </MenuItem>
          <MenuItem onSelect={() => setRenaming(w)}>Rename…</MenuItem>
          <MenuItem disabled title="Comes with the week's own grid">
            Copy week to other channels…
          </MenuItem>
          <MenuSeparator />
          <MenuItem danger onSelect={() => setDeleting(w)}>
            Delete week…
          </MenuItem>
        </Menu>
      ),
    };
  });

  const main = (
    <>
      <StatusBar>
        <span className="font-semibold">
          {MONTH_NAMES[monthNo - 1]} {year}
        </span>
        <span className="text-text-2">
          {made} of {plural(starts.length, 'week')} created · {kind === 'main' ? 'main playlist' : 'ads playlist'}
        </span>
        <span className="flex-1" />
        <span className="text-text-2">Today is {dayText(channel.today, true)}</span>
      </StatusBar>
      {weeks.isError ? (
        <Notice tone="red">{errorText(weeks.error)}</Notice>
      ) : (
        <WeekTable
          label={`Weeks of ${MONTH_NAMES[monthNo - 1]} ${year}`}
          heads={weekOrder(channel.weekStart).map((d) => WEEKDAYS[d].short)}
          rows={weeks.data ? rows : []}
          empty="Loading…"
        />
      )}
      <span className="text-small text-text-3">
        A week belongs to the month its first day is in ({spanText(starts[0] ?? `${month}-01`, addDays(starts[starts.length - 1] ?? `${month}-01`, 6))}). Click a day to open its playlist.
      </span>
    </>
  );

  return (
    <>
      {header(weeksActions)}
      {tabs}
      <EditorLayout leftLabel="Months" left={left} main={main} />
      <CreateWeeksDialog open={!!createFrom} onOpenChange={(o) => !o && setCreateFrom(null)} channel={channel} initialWeek={createFrom ?? nextMissing ?? channel.today} />
      <RenameWeekDialog week={renaming} onOpenChange={(o) => !o && setRenaming(null)} />
      <DeleteWeekDialog week={deleting} onOpenChange={(o) => !o && setDeleting(null)} />
    </>
  );
}
