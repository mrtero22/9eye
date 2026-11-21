// Settings › Activity (decision 0023; mockup docs/design/mockups/AiAccess.dc.html, page doc
// docs/design/ai-access-page.md): every change in the company, from the app or an AI app, newest
// first, and what AI apps read; a row opens its details.

import { useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { formatDate } from '@9eye/core';
import { api, errorText } from '@/lib/api';
import { keys, useChannels } from '@/lib/queries';
import type { ActivityEvent, AdminUser } from '@/lib/types';
import { Badge, Button, DataTable, DetailList, EmptyState, Notice, SectionHead, Segmented, SelectField, SidePanel, StatusDot, type DataGroup } from '@/ui';
import { activityItem, activityWords, inputLines, isRead } from './activityWords';

const PAGE = 50;
type From = 'all' | 'web' | 'mcp';

const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function dayLabel(day: string): string {
  const today = localDay(new Date().toISOString());
  const yesterday = localDay(new Date(Date.now() - 86_400_000).toISOString());
  const name = `${WEEKDAYS[new Date(`${day}T12:00:00`).getDay()]} ${formatDate(day)}`;
  return day === today ? `Today · ${name}` : day === yesterday ? `Yesterday · ${name}` : name;
}

export function ActivitySection({ company }: { company: string }) {
  const [from, setFrom] = useState<From>('all');
  const [person, setPerson] = useState('');
  const [open, setOpen] = useState<ActivityEvent | null>(null);
  const channels = useChannels();
  const users = useQuery({ queryKey: keys.users(), queryFn: () => api<AdminUser[]>('GET', '/admin/users') });
  const filters = new URLSearchParams({ limit: String(PAGE), ...(from !== 'all' ? { via: from } : {}), ...(person ? { person } : {}) }).toString();
  const events = useInfiniteQuery({
    queryKey: keys.activity(filters),
    initialPageParam: '',
    queryFn: ({ pageParam }) => api<ActivityEvent[]>('GET', `/admin/activity?${filters}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1].at : undefined),
  });
  const list = useMemo(() => events.data?.pages.flat() ?? [], [events.data]);
  const channelName = useMemo(() => new Map((channels.data ?? []).map((c) => [c.id, c.name])), [channels.data]);
  const undone = useMemo(() => new Set(list.filter((e) => e.action === 'tool undo_change' && e.ok && e.targetId).map((e) => e.targetId!)), [list]);

  const result = (e: ActivityEvent) =>
    !e.ok ? <StatusDot tone="red">Refused</StatusDot> : isRead(e.action, e.input) ? <StatusDot tone="neutral">Read</StatusDot> : <StatusDot tone="green">Done</StatusDot>;
  const who = (e: ActivityEvent) => (
    <span className="flex min-w-0 flex-col leading-[1.3]">
      <span className="font-medium">{e.person?.name ?? 'Someone who left'}</span>
      <span className="truncate text-meta text-text-3">{e.via === 'mcp' ? `AI · ${e.tokenName ?? 'a token'}` : 'App'}</span>
    </span>
  );

  const groups: DataGroup[] = [];
  for (const e of list) {
    const day = localDay(e.at);
    let g = groups[groups.length - 1];
    if (!g || g.key !== day) groups.push((g = { key: day, label: dayLabel(day), rows: [] }));
    const read = isRead(e.action, e.input);
    g.rows.push({
      key: e.id,
      onOpen: () => setOpen(e),
      openLabel: `Details of ${activityWords(e.action, e.input)}`,
      cells: [
        <span key="t" className="mono text-text-3">{clock(e.at)}</span>,
        <span key="w">{who(e)}</span>,
        <span key="a" className={`flex min-w-0 items-center gap-1.5 ${read ? 'text-text-2' : ''}`}>
          <span className="truncate">{activityWords(e.action, e.input)}</span>
          {undone.has(e.id) && <Badge>Undone</Badge>}
        </span>,
        <span key="i" className="truncate text-text-2">{activityItem(e.input, e.channelIds.map((id) => channelName.get(id) ?? 'a channel'))}</span>,
        <span key="r">{result(e)}</span>,
      ],
    });
  }

  return (
    <>
      <SectionHead title="Activity" description={`Every change in ${company}, from the app or an AI app, newest first. What AI apps read is listed too.`} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1 text-meta text-text-2">
          <span>From</span>
          <Segmented label="From" value={from} onChange={setFrom} options={[{ value: 'all', label: 'All' }, { value: 'web', label: 'App' }, { value: 'mcp', label: 'AI apps' }]} />
        </div>
        <SelectField label="Person" value={person} onChange={(e) => setPerson(e.target.value)} className="w-48">
          <option value="">Everyone</option>
          {(users.data ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </SelectField>
      </div>
      {events.error && <Notice tone="red">{errorText(events.error)}</Notice>}
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-[999_1_560px]">
          {list.length > 0 ? (
            <DataTable
              label="Activity"
              minWidth={680}
              columns={[
                { label: 'Time', width: '52px' },
                { label: 'Who', width: 'minmax(130px, 1fr)' },
                { label: 'What', width: 'minmax(170px, 1.3fr)' },
                { label: 'Item', width: 'minmax(120px, 1fr)' },
                { label: 'Result', width: '84px' },
              ]}
              groups={groups}
              footer={
                events.hasNextPage ? (
                  <div className="flex justify-center">
                    <Button onClick={() => void events.fetchNextPage()} disabled={events.isFetchingNextPage}>
                      Load older
                    </Button>
                  </div>
                ) : undefined
              }
            />
          ) : (
            events.isSuccess && <EmptyState>Nothing yet.</EmptyState>
          )}
        </div>
        {open && (
          <SidePanel title={activityWords(open.action, open.input)} onClose={() => setOpen(null)}>
            <div className="flex flex-col gap-3 p-4">
              <DetailList
                items={[
                  { label: 'When', value: `${dayLabel(localDay(open.at))} at ${clock(open.at)}` },
                  { label: 'Who', value: open.person ? `${open.person.name} (${open.person.email})` : 'Someone who left' },
                  { label: 'From', value: open.via === 'mcp' ? `AI app · ${open.tokenName ?? 'a token'}` : 'The app' },
                  { label: 'Item', value: activityItem(open.input, open.channelIds.map((id) => channelName.get(id) ?? 'a channel')) },
                  { label: 'Result', value: open.ok ? (undone.has(open.id) ? 'Done, then undone' : isRead(open.action, open.input) ? 'Read: nothing changed' : 'Done') : 'Refused', tone: open.ok ? undefined : 'red' },
                  open.hasUndo && { label: 'Change id', value: open.id, mono: true },
                ]}
              />
              {open.message && <Notice tone="red">{open.message}</Notice>}
              <div className="flex flex-col gap-1.5">
                <span className="text-meta font-medium text-text-2">What was sent</span>
                {inputLines(open.input).length ? (
                  <div className="flex flex-col rounded-item bg-surface-2 px-2.5 py-1.5">
                    {inputLines(open.input).map((l) => (
                      <div key={l.k} className="flex gap-2.5 py-0.5 text-meta">
                        <span className="mono w-[84px] shrink-0 text-text-3">{l.k}</span>
                        <span className="mono min-w-0 break-all">{l.v}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="text-meta text-text-3">Nothing.</span>
                )}
              </div>
              {open.hasUndo && !undone.has(open.id) && (
                <Notice tone="accent">An AI app can put this back with undo_change and this change id, while nobody changes it since.</Notice>
              )}
            </div>
          </SidePanel>
        )}
      </div>
    </>
  );
}
