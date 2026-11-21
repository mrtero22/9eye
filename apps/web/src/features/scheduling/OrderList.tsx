// Screen 1 of Scheduling (scheduling-page.md, mockup the Scheduling mockup (private) "list"): a channel's orders
// with their facts — filters, a table grouped by mode, the first issue of each order.

import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FRAME_RATES, ORDER_MODES, WEEKDAYS, addDays, formatDate, formatTcShort, type OrderMode } from '@9eye/core';
import { useStoredState } from '@/app/prefs';
import { api, errorText } from '@/lib/api';
import type { Channel, OrderSummary } from '@/lib/types';
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  ContextPicker,
  ContextText,
  DataTable,
  Dialog,
  Icon,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  Notice,
  PageHeader,
  ProgressBar,
  SearchField,
  Segmented,
  SelectField,
  Swatch,
  TextField,
  ToggleChip,
  useToast,
  type DataColumn,
} from '@/ui';
import { MODE_GROUP_HINT, MODE_HINT, MODE_LABEL, daysText, isProgrammeMode } from './model';
import { orderKeys, useChannels, useOrderList } from './queries';
import { useAgentPage } from '@/features/agents/pageAgent';

type When = 'week' | 'upcoming' | 'ended' | 'any';
type Stat = 'any' | 'confirmed' | 'draft';
const OPTIONAL = ['Mode', 'Status', 'Dates', 'This week', 'Progress', 'Needs attention'] as const;
type Optional = (typeof OPTIONAL)[number];

export function channelSettingsText(channel: Channel): string {
  const r = FRAME_RATES[channel.frameRate as keyof typeof FRAME_RATES];
  return r ? `Week starts ${WEEKDAYS[channel.weekStart].long} · day starts ${formatTcShort(channel.dayStartFrames, r)} · ${r.label}` : '';
}

/** "This week" and "Progress" of one order, as the list shows them. */
function weekFacts(o: OrderSummary, weekStart: number) {
  if (isProgrammeMode(o.mode)) {
    const f = o.week.firsts;
    const chapters = f.map((x) => x.chapter).filter((x): x is number => x !== null);
    const slot = f.length ? `${daysText(f.map((x) => x.date), weekStart)} · ${[...new Set(f.map((x) => x.clock))].join(', ')}` : 'Nothing this week';
    const note = f.length
      ? `${chapters.length ? `Ep. ${chapters.length > 1 ? `${Math.min(...chapters)}–${Math.max(...chapters)}` : chapters[0]} · ` : ''}${f.length} first, ${o.week.repeats ? `${o.week.repeats} repeats` : 'no repeats'}`
      : '';
    return { slot, note };
  }
  const p = o.week.passes;
  if (!p.length) return { slot: 'Nothing this week', note: '' };
  const lo = Math.min(...p.map((x) => x.passes));
  const hi = Math.max(...p.map((x) => x.passes));
  const days = [...new Set(p.map((x) => x.date))];
  const perDay = Math.max(...days.map((d) => p.filter((x) => x.date === d).length));
  const blocks = perDay >= o.week.blocksPerDay ? (o.week.blocksPerDay === 24 ? 'every hour' : 'every block') : `${perDay} blocks a day`;
  return { slot: `${lo === hi ? lo : `${lo}–${hi}`} plays a block`, note: `${days.length === 7 ? 'Every day' : daysText(days, weekStart)}, ${blocks}` };
}

export function OrderList() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const channels = useChannels();
  const list = channels.data ?? [];
  const wanted = params.get('channel');
  const channelId = wanted && (!channels.data || list.some((c) => c.id === wanted)) ? wanted : (list.find((c) => c.templateCount > 0)?.id ?? list[0]?.id ?? null);
  const orders = useOrderList(channelId);
  useAgentPage({ name: 'Scheduling › Plans', sees: `the plans of ${list.find((c) => c.id === channelId)?.name ?? 'a channel'}` });
  const channel = orders.data?.channel ?? list.find((c) => c.id === channelId) ?? null;

  const [q, setQ] = useState('');
  const [mode, setMode] = useState<OrderMode | 'all'>('all');
  const [stat, setStat] = useState<Stat>('any');
  const [when, setWhen] = useState<When>('week');
  const [attn, setAttn] = useState(false);
  const [sort, setSort] = useState<{ key: 'name' | 'dates'; dir: 1 | -1 }>({ key: 'name', dir: 1 });
  const [hidden, setHidden] = useStoredState<Record<string, boolean>>('9eye.scheduling.hidden', {});
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [dup, setDup] = useState<OrderSummary | null>(null);
  const [del, setDel] = useState<OrderSummary | null>(null);

  const all = orders.data?.orders ?? [];
  const ws = orders.data?.weekFrom ?? null;
  const we = ws ? addDays(ws, 6) : null;
  const today = channel?.today ?? '';
  const whenOf = (o: OrderSummary): When => (!ws || !we ? 'any' : o.startDate > we ? 'upcoming' : o.endDate < ws ? 'ended' : 'week');
  const query = q.trim().toLowerCase();
  const pass = (o: OrderSummary, ignoreMode = false) =>
    (ignoreMode || mode === 'all' || o.mode === mode) &&
    (stat === 'any' || o.status === stat) &&
    (when === 'any' || whenOf(o) === when) &&
    (!attn || !!o.issue) &&
    (!query || o.name.toLowerCase().includes(query));
  const shown = useMemo(
    () =>
      all.filter((o) => pass(o)).sort((a, b) => (sort.key === 'dates' ? (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0) : a.name.toLowerCase().localeCompare(b.name.toLowerCase())) * sort.dir),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, mode, stat, when, attn, query, sort],
  );
  const counts = (m: OrderMode | 'all') => all.filter((o) => pass(o, true) && (m === 'all' || o.mode === m)).length;
  const whenCount = (w: When) => all.filter((o) => w === 'any' || whenOf(o) === w).length;
  const attnCount = all.filter((o) => o.issue && (when === 'any' || whenOf(o) === when)).length;
  const show = (c: Optional) => !hidden[c];

  const remove = useMutation({
    mutationFn: (id: string) => api('DELETE', `/orders/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: orderKeys.all() });
      toast('Plan deleted');
      setDel(null);
    },
  });

  const sortHead = (key: 'name' | 'dates') => ({
    sort: sort.key === key ? (sort.dir > 0 ? ('ascending' as const) : ('descending' as const)) : ('none' as const),
    onSort: () => setSort({ key, dir: sort.key === key ? ((-sort.dir) as 1 | -1) : 1 }),
  });
  const columns: DataColumn[] = [
    { label: 'Plan', width: 'minmax(250px, 2fr)', ...sortHead('name') },
    ...(show('Mode') ? [{ label: 'Mode', width: '84px' }] : []),
    ...(show('Status') ? [{ label: 'Status', width: '100px' }] : []),
    ...(show('Dates') ? [{ label: 'Dates', width: '200px', ...sortHead('dates') }] : []),
    ...(show('This week') ? [{ label: 'This week', width: 'minmax(190px, 1.3fr)' }] : []),
    ...(show('Progress') ? [{ label: 'Progress', width: '140px' }] : []),
    ...(show('Needs attention') ? [{ label: 'Needs attention', width: 'minmax(190px, 1.3fr)' }] : []),
    { label: '', width: '32px' },
  ];
  const open = (o: OrderSummary, extra = '') => navigate(`/scheduling/${o.id}${extra}`);
  const groups = ORDER_MODES.map((m) => {
    const rows = shown.filter((o) => o.mode === m).map((o) => {
      const facts = weekFacts(o, channel?.weekStart ?? 6);
      const series = o.mode === 'series';
      const endsSoon = o.endDate >= today && o.endDate <= addDays(today, 14);
      const cells = [
        <span key="n" className="flex min-w-0 items-center gap-2.5">
          <Swatch color={o.color} />
          <span className="text-body font-medium leading-[1.35] [overflow-wrap:anywhere]">{o.name}</span>
        </span>,
        ...(show('Mode') ? [<span key="m" className="text-text-2">{MODE_LABEL[o.mode]}</span>] : []),
        ...(show('Status') ? [<Badge key="s" tone={o.status === 'confirmed' ? 'green' : 'neutral'}>{o.status === 'confirmed' ? 'Confirmed' : 'Draft'}</Badge>] : []),
        ...(show('Dates')
          ? [
              <span key="d" className="flex flex-col leading-[1.35]">
                <span className="mono text-[12.5px]">
                  {formatDate(o.startDate)} → {formatDate(o.endDate)}
                </span>
                <span className="text-meta text-text-3">{endsSoon ? 'Ends soon' : ''}</span>
              </span>,
            ]
          : []),
        ...(show('This week')
          ? [
              <span key="w" className="flex min-w-0 flex-col leading-[1.35]">
                <span>{facts.slot}</span>
                <span className="text-meta text-text-3">{facts.note}</span>
              </span>,
            ]
          : []),
        ...(show('Progress')
          ? [
              <span key="p" className="flex flex-col gap-1">
                {series && <ProgressBar done={o.itemCount ? (o.aired / o.itemCount) * 100 : 0} now={o.itemCount ? (o.week.firsts.length / o.itemCount) * 100 : 0} color={o.color} />}
                <span className="text-meta text-text-2">{series ? `${o.aired} of ${o.itemCount} aired` : `${o.itemCount} ${o.itemCount === 1 ? 'item' : 'items'}`}</span>
              </span>,
            ]
          : []),
        ...(show('Needs attention')
          ? [
              <span key="i" className="flex min-w-0 items-start gap-1.5 text-[12.5px] text-amber-text">
                {o.issue && (
                  <>
                    <Icon name="alert" size={13} strokeWidth={2} className="mt-[3px] shrink-0" />
                    <span>{o.issue.short}</span>
                  </>
                )}
              </span>,
            ]
          : []),
      ];
      return {
        key: o.id,
        cells,
        onOpen: () => open(o),
        openLabel: `Open ${o.name}`,
        actions: (
          <Menu label={`Actions for ${o.name}`} width={200} trigger={<IconButton icon="more" size="sm" tone="quiet" label={`Actions for ${o.name}`} />}>
            <MenuItem onSelect={() => open(o)}>Open</MenuItem>
            <MenuItem onSelect={() => setDup(o)}>Duplicate…</MenuItem>
            <MenuItem onSelect={() => open(o, '?do=split')}>Split…</MenuItem>
            <MenuItem onSelect={() => open(o, '?view=report')}>Report</MenuItem>
            <MenuSeparator />
            <MenuItem danger onSelect={() => setDel(o)}>
              Delete…
            </MenuItem>
          </Menu>
        ),
      };
    });
    return { key: m, label: MODE_LABEL[m], hint: MODE_GROUP_HINT[m], count: rows.length, rows };
  }).filter((g) => g.rows.length);

  const exportList = () => {
    const head = ['Plan', 'Mode', 'Status', 'Start', 'End', 'This week', 'Progress', 'Needs attention'];
    const rows = shown.map((o) => {
      const f = weekFacts(o, channel?.weekStart ?? 6);
      return [o.name, MODE_LABEL[o.mode], o.status === 'confirmed' ? 'Confirmed' : 'Draft', o.startDate, o.endDate, `${f.slot} ${f.note}`.trim(), o.mode === 'series' ? `${o.aired} of ${o.itemCount} aired` : `${o.itemCount} items`, o.issue?.short ?? ''];
    });
    const csv = [head, ...rows].map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `orders-${channel?.code ?? 'channel'}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const runningCount = all.filter((o) => whenOf(o) === 'week').length;
  return (
    <>
      <PageHeader
        title="Scheduling"
        context={
          <>
            <ContextPicker
              label="Channel"
              searchLabel="channels"
              value={channelId ?? ''}
              items={list.map((c) => ({ id: c.id, name: c.name, meta: `${WEEKDAYS[c.weekStart].short} · ${formatTcShort(c.dayStartFrames, FRAME_RATES[c.frameRate as keyof typeof FRAME_RATES] ?? FRAME_RATES['25'])}` }))}
              onPick={(id) => setParams({ channel: id })}
            />
            {channel && <ContextText>{channelSettingsText(channel)}</ContextText>}
          </>
        }
        actions={
          <>
            <Menu label="List options" width={220} trigger={<IconButton icon="more" label="List options" />}>
              <MenuItem onSelect={exportList}>Export the list…</MenuItem>
              <MenuItem onSelect={() => window.print()}>Print</MenuItem>
              <MenuItem onSelect={() => setColumnsOpen(true)}>Columns…</MenuItem>
            </Menu>
            <Button variant="primary" icon="plus" disabled={!channelId} onClick={() => navigate(`/scheduling/new?channel=${channelId}`)}>
              New plan
            </Button>
          </>
        }
      />
      <div className="flex flex-col gap-4 px-4 pb-8 pt-6 sm:px-8">
        <div className="no-print flex flex-wrap items-center gap-x-3.5 gap-y-2.5">
          <span className="w-[260px] max-w-full">
            <SearchField value={q} onChange={setQ} placeholder={`Search ${all.length} plans`} label="Search plans" />
          </span>
          <span role="group" aria-label="Mode" className="inline-flex flex-wrap gap-1">
            {(['all', ...ORDER_MODES] as const).map((m) => (
              <ToggleChip key={m} tone="strong" on={mode === m} count={counts(m)} hint={m === 'all' ? 'All modes' : MODE_HINT[m]} onClick={() => setMode(m)}>
                {m === 'all' ? 'All' : MODE_LABEL[m]}
              </ToggleChip>
            ))}
          </span>
          <Segmented
            label="Status"
            size="sm"
            value={stat}
            onChange={setStat}
            options={[
              { value: 'any', label: 'All' },
              { value: 'confirmed', label: 'Confirmed' },
              { value: 'draft', label: 'Draft' },
            ]}
          />
          <SelectField inline label="Dates" value={when} onChange={(e) => setWhen(e.target.value as When)}>
            <option value="week">Running this week ({whenCount('week')})</option>
            <option value="upcoming">Starting later ({whenCount('upcoming')})</option>
            <option value="ended">Ended ({whenCount('ended')})</option>
            <option value="any">Any dates ({whenCount('any')})</option>
          </SelectField>
          <ToggleChip tone="amber" on={attn} count={attnCount} onClick={() => setAttn(!attn)}>
            Needs attention
          </ToggleChip>
        </div>
        {orders.error && <Notice tone="red">{errorText(orders.error)}</Notice>}
        <DataTable
          label="Plans"
          columns={columns}
          groups={groups}
          empty={orders.isLoading ? 'Loading…' : all.length ? 'No plans match these filters.' : 'No plans on this channel yet. New plan starts one.'}
          footer={orders.data ? `${shown.length} of ${when === 'any' ? all.length : whenCount(when)} plans ${when === 'week' ? 'running this week' : when === 'upcoming' ? 'starting later' : when === 'ended' ? 'ended' : ''} · ${all.length} plans on ${channel?.name ?? ''} in all`.replace(/\s+·/, ' ·') : undefined}
        />
        {when === 'week' && runningCount === 0 && all.length > 0 && <span className="text-small text-text-3">No plan runs this week; pick other dates above.</span>}
      </div>

      <Dialog
        open={columnsOpen}
        onOpenChange={setColumnsOpen}
        title="Columns"
        description="Plan and the actions are always shown."
        footer={
          <Button variant="primary" onClick={() => setColumnsOpen(false)}>
            Done
          </Button>
        }
      >
        <div className="flex flex-col gap-2">
          {OPTIONAL.map((c) => (
            <Checkbox key={c} checked={show(c)} onChange={(v) => setHidden({ ...hidden, [c]: !v })}>
              {c}
            </Checkbox>
          ))}
        </div>
      </Dialog>
      {dup && <DuplicateDialog order={dup} onClose={() => setDup(null)} onDone={(id) => navigate(`/scheduling/${id}`)} />}
      <ConfirmDialog
        open={!!del}
        onOpenChange={(o) => !o && setDel(null)}
        title={`Delete ${del?.name ?? ''}?`}
        description="The plan and all its airings are deleted. Drafts and confirmed plans alike; the playlist keeps what it already placed."
        confirmLabel="Delete plan"
        danger
        onConfirm={() => del && remove.mutate(del.id)}
      />
    </>
  );
}

export function DuplicateDialog({ order, onClose, onDone }: { order: { id: string; name: string }; onClose: () => void; onDone: (id: string) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(`Copy of ${order.name}`.slice(0, 200));
  const m = useMutation({
    mutationFn: () => api<{ id: string }>('POST', `/orders/${order.id}/duplicate`, { name }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: orderKeys.all() });
      toast('Plan duplicated');
      onClose();
      onDone(r.id);
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Duplicate plan"
      description="A new plan with the same settings, items and airings. The copy is a draft until you confirm it."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!name.trim() || m.isPending} onClick={() => m.mutate()}>
            Duplicate
          </Button>
        </>
      }
    >
      <TextField label="Name" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      {m.error && <Notice tone="red">{errorText(m.error)}</Notice>}
    </Dialog>
  );
}
