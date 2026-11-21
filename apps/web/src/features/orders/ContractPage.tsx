// One contract (design/orders-page.md §2): its commercial orders, one per channel, and its details.
// New order makes one order per chosen channel, on the channel's main template, named as Aurora Media names
// them; a channel not in the contract yet is added to it.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, errorText } from '@/lib/api';
import { keys, useChannels } from '@/lib/queries';
import type { Channel, Client, Contract } from '@/lib/types';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ChipsField,
  ConfirmDialog,
  DataTable,
  DatePicker,
  DetailList,
  Dialog,
  IconButton,
  Menu,
  MenuItem,
  Notice,
  NumberField,
  PageHeader,
  SelectField,
  StartEndPicker,
  TabBar,
  TextArea,
  TextField,
  dayText,
  spanText,
  useToast,
} from '@/ui';
import { CURRENCIES, STATE_LABEL, contractState, fmtCount, orderName, stateNote } from './model';
import { useAgentPage } from '@/features/agents/pageAgent';

export function ContractPage() {
  const { contractId = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const channels = useChannels();
  const clients = useQuery({ queryKey: keys.clients(), queryFn: () => api<Client[]>('GET', '/commercials/clients') });
  const contract = useQuery({ queryKey: keys.contract(contractId), queryFn: () => api<Contract>('GET', `/commercials/contracts/${contractId}`) });
  const [tab, setTab] = useState<'orders' | 'details'>('orders');
  const [ordering, setOrdering] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const today = channels.data?.[0]?.today ?? '';
  const d = contract.data;
  useAgentPage(d ? { name: 'Ads › Deal', sees: `deal "${d.name}" of ${d.clientName} (${d.startDate} → ${d.endDate}, id ${d.id})` } : null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: keys.contracts() });
    qc.invalidateQueries({ queryKey: keys.clients() });
  };
  const remove = useMutation({
    mutationFn: () => api('DELETE', `/commercials/contracts/${contractId}`),
    onSuccess: () => {
      refresh();
      toast(`${contract.data?.name} deleted`);
      navigate('/orders');
    },
    onError: (e) => toast(errorText(e), 'red'),
  });
  const removeOrder = useMutation({
    mutationFn: (id: string) => api('DELETE', `/commercials/orders/${id}`),
    onSuccess: () => {
      refresh();
      toast('Campaign deleted');
    },
    onError: (e) => toast(errorText(e), 'red'),
  });

  if (contract.error) {
    return (
      <>
        <PageHeader back={{ label: 'Ads', to: '/orders' }} title="Deal" />
        <div className="px-4 pt-5 sm:px-8">
          <Notice tone="red">{errorText(contract.error)}</Notice>
        </div>
      </>
    );
  }
  const c = contract.data;
  if (!c) return <PageHeader back={{ label: 'Ads', to: '/orders' }} title="Deal" />;
  const state = today ? contractState(c, today) : 'running';
  const note = today ? stateNote(c, today) : null;
  const chName = (id: string) => channels.data?.find((x) => x.id === id)?.name ?? 'Unknown channel';

  return (
    <>
      <PageHeader
        back={{ label: 'Ads', to: '/orders' }}
        title={c.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={state === 'running' ? 'green' : state === 'upcoming' ? 'accent' : 'neutral'}>
              {STATE_LABEL[state]}
              {note && state !== 'ended' ? ` · ${note.text.toLowerCase()}` : ''}
            </Badge>
            <span>
              {c.clientName} · {spanText(c.startDate, c.endDate)} · {c.channelIds.length} {c.channelIds.length === 1 ? 'channel' : 'channels'} · {c.currency}
            </span>
          </span>
        }
        actions={
          <>
            <Menu label="More actions for this deal" width={220} trigger={<IconButton icon="more" label="More actions for this deal" />}>
              <MenuItem danger disabled={c.orders > 0} note={c.orders ? 'Delete its campaigns first' : undefined} onSelect={() => setDeleting(true)}>
                Delete deal
              </MenuItem>
            </Menu>
            <Button variant="primary" icon="plus" onClick={() => setOrdering(true)}>
              New campaign
            </Button>
          </>
        }
      />
      <div className="flex flex-col gap-4 px-4 pb-8 pt-5 sm:px-8">
        <TabBar
          label="Deal"
          value={tab}
          tabs={[
            { value: 'orders', label: `Campaigns ${c.orders}` },
            { value: 'details', label: 'Details' },
          ]}
          onChange={setTab}
        />
        {tab === 'orders' ? (
          <DataTable
            label={`Orders of ${c.name}`}
            minWidth={900}
            columns={[
              { label: 'Campaign', width: 'minmax(300px, 2fr)' },
              { label: 'Channel', width: 'minmax(140px, 1fr)' },
              { label: 'Dates', width: '190px' },
              { label: 'Spots', width: '64px' },
              { label: 'Booked', width: '84px' },
              { label: 'State', width: '100px' },
              { label: '', width: '44px' },
            ]}
            groups={c.ordersList.length === 0 ? [] : [
              {
                key: 'all',
                label: '',
                rows: c.ordersList.map((o) => ({
                  key: o.id,
                  onOpen: () => navigate(`/orders/${o.id}`),
                  openLabel: `Open ${o.name}`,
                  cells: [
                    <span key="n" className="font-medium [overflow-wrap:anywhere]">
                      {o.name}
                    </span>,
                    <span key="c" className="text-text-2">
                      {o.channelName}
                    </span>,
                    <span key="d">{spanText(o.startDate, o.endDate)}</span>,
                    <span key="s" className="mono">
                      {o.spots}
                    </span>,
                    <span key="b" className="mono">
                      {fmtCount(o.spotsBooked)}
                    </span>,
                    <Badge key="st" tone={o.status === 'confirmed' ? 'green' : 'neutral'}>
                      {o.status === 'confirmed' ? 'Confirmed' : 'Draft'}
                    </Badge>,
                  ],
                  actions: (
                    <Menu label={`Actions for ${o.name}`} width={220} trigger={<IconButton icon="more" size="sm" label={`Actions for ${o.name}`} />}>
                      <MenuItem danger disabled={o.spotsBooked > 0} note={o.spotsBooked ? 'Remove its booked spots first' : undefined} onSelect={() => removeOrder.mutate(o.id)}>
                        Delete campaign
                      </MenuItem>
                    </Menu>
                  ),
                })),
              },
            ]}
            empty={
              <span className="flex flex-col items-start gap-2 text-text-3">
                No campaigns yet: one campaign per channel books the spots of that channel.
                <Button size="sm" icon="plus" onClick={() => setOrdering(true)}>
                  New campaign
                </Button>
              </span>
            }
            footer={`${c.orders} ${c.orders === 1 ? 'campaign' : 'campaigns'} · ${fmtCount(c.spotsBooked)} spots booked · open a campaign to book its spots`}
          />
        ) : (
          <DetailsTab contract={c} clients={clients.data ?? []} channels={channels.data ?? []} chName={chName} onSaved={refresh} />
        )}
      </div>
      <NewOrderDialog open={ordering} onOpenChange={setOrdering} contract={c} channels={channels.data ?? []} today={today} onMade={refresh} />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete deal"
        description={`${c.name} is deleted. It has no campaigns.`}
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          setDeleting(false);
          remove.mutate();
        }}
      />
    </>
  );
}

function NewOrderDialog({ open, onOpenChange, contract, channels, today, onMade }: { open: boolean; onOpenChange: (o: boolean) => void; contract: Contract; channels: Channel[]; today: string; onMade: () => void }) {
  const toast = useToast();
  const withOrder = useMemo(() => new Set(contract.ordersList.map((o) => o.channelId)), [contract]);
  const firstDay = today && today > contract.startDate ? (today > contract.endDate ? contract.endDate : today) : contract.startDate;
  const [picked, setPicked] = useState<string[]>([]);
  const [start, setStart] = useState(firstDay);
  const [error, setError] = useState<ApiError | null>(null);
  useEffect(() => {
    if (!open) return;
    // the contract's channels without an order yet
    setPicked(contract.channelIds.filter((id) => !withOrder.has(id)));
    setStart(firstDay);
    setError(null);
  }, [open, contract, withOrder, firstDay]);
  const make = useMutation({
    mutationFn: () => api<{ ids: string[] }>('POST', `/commercials/contracts/${contract.id}/orders`, { channelIds: picked, startDate: start }),
    onSuccess: ({ ids }) => {
      onMade();
      toast(ids.length === 1 ? 'Campaign made' : `${ids.length} campaigns made`);
      onOpenChange(false);
    },
    onError: (e) => setError(e instanceof ApiError ? e : new ApiError(0, errorText(e), [])),
  });
  const order = [...contract.channelIds.map((id) => channels.find((c) => c.id === id)).filter((c): c is Channel => !!c), ...channels.filter((c) => !contract.channelIds.includes(c.id))];
  const names = picked.map((id) => orderName(channels.find((c) => c.id === id)?.name ?? '', contract.name, start));
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New campaign"
      description={`One campaign per channel, on the channel's main layout, from the start you choose to the deal's end (${dayText(contract.endDate)}).`}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!picked.length || make.isPending} onClick={() => make.mutate()}>
            {picked.length > 1 ? `Make ${picked.length} campaigns` : 'Make campaign'}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[240px] shrink-0 flex-col gap-2 overflow-y-auto rounded-item border border-border p-3">
        {order.map((ch) => {
          const inContract = contract.channelIds.includes(ch.id);
          return (
            <span key={ch.id} className="flex items-center justify-between gap-3">
              <Checkbox checked={picked.includes(ch.id)} onChange={(on) => setPicked((p) => (on ? [...p, ch.id] : p.filter((x) => x !== ch.id)))}>
                {ch.name}
              </Checkbox>
              <span className="text-small text-text-3">{withOrder.has(ch.id) ? 'Has a campaign' : inContract ? 'In the deal' : picked.includes(ch.id) ? 'Joins the deal' : ''}</span>
            </span>
          );
        })}
      </div>
      <DatePicker
        mode="day"
        label="Start"
        value={start}
        weekStart={channels[0]?.weekStart ?? 6}
        today={today || contract.startDate}
        min={contract.startDate}
        max={contract.endDate}
        onChange={({ value }) => setStart(value)}
      />
      {names.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-meta text-text-2">{names.length === 1 ? 'Its name' : 'Their names'} (you can rename them later)</span>
          {names.slice(0, 3).map((n) => (
            <span key={n} className="mono text-small text-text-3">
              {n}
            </span>
          ))}
          {names.length > 3 && <span className="text-small text-text-3">and {names.length - 3} more, named the same way</span>}
        </div>
      )}
      {error && (
        <Notice tone="red">
          <span className="font-medium">{error.message}</span>
          {error.problems.length > 1 && (
            <ul className="m-0 flex flex-col gap-1 pl-4">
              {error.problems.map((p, i) => (
                <li key={i}>{p.message}</li>
              ))}
            </ul>
          )}
        </Notice>
      )}
    </Dialog>
  );
}

interface DetailsForm {
  clientId: string;
  name: string;
  startDate: string;
  endDate: string;
  currency: string;
  totalAgreed: number;
  notes: string;
  channelIds: string[];
}
const detailsOf = (c: Contract): DetailsForm => ({
  clientId: c.clientId, name: c.name, startDate: c.startDate, endDate: c.endDate, currency: c.currency, totalAgreed: c.totalAgreed, notes: c.notes, channelIds: c.channelIds,
});

function DetailsTab({ contract, clients, channels, chName, onSaved }: { contract: Contract; clients: Client[]; channels: Channel[]; chName: (id: string) => string; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState<DetailsForm>(detailsOf(contract));
  const [error, setError] = useState<ApiError | null>(null);
  useEffect(() => setForm(detailsOf(contract)), [contract]);
  const base = detailsOf(contract);
  const changes = (Object.keys(form) as (keyof DetailsForm)[]).filter((k) => JSON.stringify(form[k]) !== JSON.stringify(base[k])).length;
  const set = (patch: Partial<DetailsForm>) => setForm((f) => ({ ...f, ...patch }));
  const save = useMutation({
    mutationFn: () => api('PUT', `/commercials/contracts/${contract.id}`, { ...form, version: contract.version }),
    onSuccess: () => {
      onSaved();
      setError(null);
      toast(`${form.name.trim()} saved`);
    },
    onError: (e) => setError(e instanceof ApiError ? e : new ApiError(0, errorText(e), [])),
  });
  const currencies = CURRENCIES.includes(form.currency) ? CURRENCIES : [form.currency, ...CURRENCIES];
  return (
    <div className="flex flex-wrap items-start gap-4">
      <Card label="Deal details" className="min-w-0 flex-[999_1_480px] max-w-[760px]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">Details</span>
          <span className="flex-1" />
          {changes > 0 && (
            <Badge tone="amber" round>
              {changes === 1 ? '1 change' : `${changes} changes`}
            </Badge>
          )}
          <Button variant="ghost" disabled={!changes} onClick={() => { setForm(base); setError(null); }}>
            Discard
          </Button>
          <Button variant="primary" disabled={!changes || !form.name.trim() || save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <TextField label="Name" value={form.name} maxLength={500} onChange={(e) => set({ name: e.target.value })} />
          <SelectField label="Client" value={form.clientId} onChange={(e) => set({ clientId: e.target.value })}>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectField>
          <StartEndPicker label="Dates" weekStart={channels[0]?.weekStart ?? 6} today={channels[0]?.today ?? form.startDate} start={form.startDate} end={form.endDate} onChange={({ start, end }) => set({ startDate: start, endDate: end })} />
          <div className="grid grid-cols-2 gap-3">
            <SelectField label="Currency" value={form.currency} onChange={(e) => set({ currency: e.target.value })}>
              {currencies.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </SelectField>
            <NumberField label="Deal value" value={form.totalAgreed} decimals={2} max={999999999999} onChange={(v) => set({ totalAgreed: v ?? 0 })} />
          </div>
        </div>
        <ChipsField
          label="Channels"
          values={form.channelIds}
          options={channels.map((c) => ({ value: c.id, label: c.name }))}
          hint="A channel that one of the deal's campaigns uses cannot leave it."
          onChange={(channelIds) => set({ channelIds })}
        />
        <TextArea label="Notes" rows={3} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
        {error && (
          <Notice tone="red">
            <span className="font-medium">{error.message}</span>
            {error.problems.length > 1 && (
              <ul className="m-0 flex flex-col gap-1 pl-4">
                {error.problems.map((p, i) => (
                  <li key={i}>{p.message}</li>
                ))}
              </ul>
            )}
          </Notice>
        )}
      </Card>
      <Card label="Totals" title="Totals" className="min-w-[240px] flex-[1_1_260px] max-w-[360px]">
        <DetailList
          items={[
            { label: 'Spots booked', value: fmtCount(contract.spotsBooked), mono: true },
            { label: 'Campaigns', value: String(contract.orders), mono: true },
            { label: 'Channels', value: String(contract.channelIds.length), mono: true },
            { label: 'In playlists', value: 'Counted once ads are placed into playlists' },
            { label: 'Aired', value: 'Comes with as-run matching' },
          ]}
        />
      </Card>
    </div>
  );
}
