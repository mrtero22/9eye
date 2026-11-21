// Orders (design/orders-page.md §1): the company's contracts — each one campaign of a client — and,
// on the Clients tab, the advertisers and agencies. A contract opens its own page with its orders.

import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorText } from '@/lib/api';
import { keys, useChannels } from '@/lib/queries';
import type { Client, ContractListItem } from '@/lib/types';
import { Button, ConfirmDialog, DataTable, EmptyState, IconButton, Menu, MenuItem, Notice, PageHeader, SearchField, Segmented, SelectField, TabBar, spanText, useToast } from '@/ui';
import { ClientsTab } from './ClientsTab';
import { NewContractDialog } from './ContractDialog';
import { contractState, fmtCount, stateNote, type ContractState } from './model';
import { useAgentPage } from '@/features/agents/pageAgent';

type Filter = ContractState | 'all';

export function OrdersPage() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const tab = pathname.startsWith('/orders/clients') ? 'clients' : 'contracts';
  const channels = useChannels();
  const clients = useQuery({ queryKey: keys.clients(), queryFn: () => api<Client[]>('GET', '/commercials/clients') });
  const contracts = useQuery({ queryKey: keys.contracts(), queryFn: () => api<ContractListItem[]>('GET', '/commercials/contracts') });
  const [creating, setCreating] = useState(false);
  const [openClient, setOpenClient] = useState<string | null>(null);
  useAgentPage({ name: tab === 'contracts' ? 'Ads › Deals' : 'Ads › Clients', sees: tab === 'contracts' ? 'the list of deals and their campaigns' : 'the list of clients' });

  return (
    <>
      <PageHeader
        title="Ads"
        description="Clients' deals and their campaigns: which spots go into which ad breaks."
        actions={
          tab === 'contracts' ? (
            <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
              New deal
            </Button>
          ) : (
            <Button variant="primary" icon="plus" onClick={() => setOpenClient('new')}>
              New client
            </Button>
          )
        }
      />
      <div className="flex flex-col gap-4 px-4 pb-8 pt-5 sm:px-8">
        <TabBar
          label="Ads"
          value={tab}
          tabs={[
            { value: 'contracts', label: 'Deals' },
            { value: 'clients', label: 'Clients' },
          ]}
          onChange={(v) => navigate(v === 'clients' ? '/orders/clients' : '/orders')}
        />
        {(clients.error || contracts.error) && <Notice tone="red">{errorText(clients.error ?? contracts.error)}</Notice>}
        {tab === 'contracts' ? (
          <ContractsTab contracts={contracts.data ?? []} loaded={contracts.isSuccess} today={channels.data?.[0]?.today ?? ''} channels={channels.data ?? []} onNew={() => setCreating(true)} />
        ) : (
          <ClientsTab clients={clients.data ?? []} open={openClient} onOpen={setOpenClient} />
        )}
      </div>
      <NewContractDialog open={creating} onOpenChange={setCreating} clients={clients.data ?? []} channels={channels.data ?? []} />
    </>
  );
}

function ContractsTab({ contracts, loaded, today, channels, onNew }: { contracts: ContractListItem[]; loaded: boolean; today: string; channels: { id: string; name: string }[]; onNew: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('running');
  const [channelId, setChannelId] = useState('');
  const [deleting, setDeleting] = useState<ContractListItem | null>(null);
  const counts = useMemo(() => {
    const n = { running: 0, upcoming: 0, ended: 0, all: contracts.length };
    for (const c of contracts) n[contractState(c, today)]++;
    return n;
  }, [contracts, today]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return contracts.filter(
      (c) =>
        (filter === 'all' || contractState(c, today) === filter) &&
        (!channelId || c.channelIds.includes(channelId)) &&
        (!s || c.name.toLowerCase().includes(s) || c.clientName.toLowerCase().includes(s)),
    );
  }, [contracts, filter, channelId, q, today]);
  const remove = useMutation({
    mutationFn: (c: ContractListItem) => api('DELETE', `/commercials/contracts/${c.id}`),
    onSuccess: (_r, c) => {
      qc.invalidateQueries({ queryKey: keys.contracts() });
      qc.invalidateQueries({ queryKey: keys.clients() });
      toast(`${c.name} deleted`);
    },
    onError: (e) => toast(errorText(e), 'red'),
  });

  if (loaded && contracts.length === 0) {
    return <EmptyState action={<Button icon="plus" onClick={onNew}>New deal</Button>}>No deals yet. A deal is one campaign of a client: its channels, dates and currency.</EmptyState>;
  }
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-[300px] max-w-full">
          <SearchField label="Find a deal" placeholder="Find a deal or client" value={q} onChange={setQ} />
        </div>
        <Segmented<Filter>
          label="State"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'running', label: `Running ${counts.running}` },
            { value: 'upcoming', label: `Upcoming ${counts.upcoming}` },
            { value: 'ended', label: `Ended ${counts.ended}` },
            { value: 'all', label: `All ${counts.all}` },
          ]}
        />
        <SelectField inline label="Channel" value={channelId} onChange={(e) => setChannelId(e.target.value)}>
          <option value="">All</option>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
      </div>
      <DataTable
        label="Deals"
        minWidth={940}
        columns={[
          { label: 'Deal', width: 'minmax(200px, 1.4fr)' },
          { label: 'Client', width: 'minmax(150px, 1fr)' },
          { label: 'Dates', width: 'minmax(210px, 1.2fr)' },
          { label: 'Channels', width: '84px' },
          { label: 'Campaigns', width: '72px' },
          { label: 'Spots booked', width: '110px' },
          { label: '', width: '44px' },
        ]}
        groups={shown.length === 0 ? [] : [
          {
            key: 'all',
            label: '',
            rows: shown.map((c) => {
              const note = stateNote(c, today);
              return {
                key: c.id,
                onOpen: () => navigate(`/orders/contracts/${c.id}`),
                openLabel: `Open ${c.name}`,
                cells: [
                  <span key="n" className="font-medium">
                    {c.name}
                  </span>,
                  <span key="c" className="text-text-2">
                    {c.clientName}
                  </span>,
                  <span key="d" className="flex flex-col leading-[1.3]">
                    <span>{spanText(c.startDate, c.endDate)}</span>
                    <span className={note.soon ? 'text-small text-amber-text' : 'text-small text-text-3'}>{note.text}</span>
                  </span>,
                  <span key="ch" className="mono">
                    {c.channelIds.length}
                  </span>,
                  <span key="o" className="mono">
                    {c.orders}
                  </span>,
                  <span key="s" className="mono">
                    {fmtCount(c.spotsBooked)}
                  </span>,
                ],
                actions: (
                  <Menu label={`Actions for ${c.name}`} width={200} trigger={<IconButton icon="more" size="sm" label={`Actions for ${c.name}`} />}>
                    <MenuItem onSelect={() => navigate(`/orders/contracts/${c.id}`)}>Open</MenuItem>
                    <MenuItem danger disabled={c.orders > 0} note={c.orders ? 'Delete its campaigns first' : undefined} onSelect={() => setDeleting(c)}>
                      Delete deal
                    </MenuItem>
                  </Menu>
                ),
              };
            }),
          },
        ]}
        empty={<span className="text-text-3">No deals match.</span>}
        footer={`${shown.length} ${shown.length === 1 ? 'deal' : 'deals'} · ${fmtCount(shown.reduce((n, c) => n + c.spotsBooked, 0))} spots booked`}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete deal"
        description={deleting ? `${deleting.name} is deleted. It has no campaigns.` : ''}
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (deleting) remove.mutate(deleting);
          setDeleting(null);
        }}
      />
    </>
  );
}
