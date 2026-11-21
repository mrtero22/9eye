// Admin → Channels: every channel of the company; a row opens its settings.

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FRAME_RATES, FRAME_RATE_CODES, WEEKDAYS, formatTcShort, frameRate, parseTc } from '@9eye/core';
import { api, errorText } from '@/lib/api';
import { keys, useChannels } from '@/lib/queries';
import type { Channel } from '@/lib/types';
import { Badge, Button, Dialog, Icon, Notice, SearchField, SectionHead, SelectField, SwitchRow, Table, TableRow, TextField, useToast } from '@/ui';

export const WEEKDAY_CHOICES = [1, 2, 3, 4, 5, 6, 0];

export const frameRateShort = (code: string) => (code.endsWith('df') ? `${code.slice(0, -2)} DF` : `${code} fps`);

const COLUMNS = 'minmax(220px, 1.4fr) 120px 96px 104px 80px minmax(180px, 1fr) 28px';

export function ChannelsSection() {
  const channels = useChannels();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    const all = channels.data ?? [];
    return n ? all.filter((c) => c.name.toLowerCase().includes(n) || c.code.toLowerCase().includes(n)) : all;
  }, [channels.data, q]);
  return (
    <>
      <SectionHead title="Channels" description={`${channels.data?.length ?? 0} channels · each one's time, playlists, defaults and exports`}>
        <div className="w-60 max-w-full">
          <SearchField value={q} onChange={setQ} placeholder="Search channels" label="Search channels" />
        </div>
        <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
          New channel
        </Button>
      </SectionHead>
      {channels.error && <Notice tone="red">{errorText(channels.error)}</Notice>}
      <Table columns={COLUMNS} head={['Channel', 'Playlists', 'Day starts', 'Week starts', 'Frame rate', 'Default rotation list', '']}>
        {list.map((c) => (
          <TableRow key={c.id} to={`/admin/channels/${c.id}`} label={`${c.name} settings`}>
            <span className="flex min-w-0 flex-col leading-[1.3]">
              <span className="font-medium">{c.name}</span>
              <span className="mono text-[11.5px] text-text-3">{c.code}</span>
            </span>
            <span className="flex gap-1">
              <Badge>Main</Badge>
              {c.adsPlaylistId && <Badge tone="accent">Ads</Badge>}
            </span>
            <span className="mono">{formatTcShort(c.dayStartFrames, frameRate(c.frameRate))}</span>
            <span>{WEEKDAYS[c.weekStart].long}</span>
            <span className="mono text-text-2">{frameRateShort(c.frameRate)}</span>
            <span className={c.defaultRotationListName ? 'truncate text-text-2' : 'text-text-3'}>{c.defaultRotationListName ?? 'None'}</span>
            <Icon name="chevronRight" size={14} className="text-text-3" />
          </TableRow>
        ))}
        {!list.length && channels.isSuccess && <TableRow>{'No channels match.'}</TableRow>}
      </Table>
      <NewChannelDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

function NewChannelDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [rate, setRate] = useState('25');
  const [dayStart, setDayStart] = useState('06:00');
  const [weekStart, setWeekStart] = useState('1');
  const [ads, setAds] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const r = FRAME_RATES[rate as keyof typeof FRAME_RATES];
  const start = parseTc(dayStart, r, { maxHours: 23 });
  const m = useMutation({
    mutationFn: () => api<Channel>('POST', '/channels', { name, code, frameRate: rate, dayStartFrames: start, weekStart: Number(weekStart), hasAds: ads }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: keys.channels() });
      toast(`${c.name} created`);
      onOpenChange(false);
      setName('');
      setCode('');
      navigate(`/admin/channels/${c.id}`);
    },
    onError: (e) => setError(errorText(e)),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New channel"
      description="Time settings are chosen now: they lock once the channel has layouts or block types."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!name.trim() || !code.trim() || start === null || m.isPending} onClick={() => m.mutate()}>
            Create
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Name" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        <TextField label="Code" mono value={code} onChange={(e) => setCode(e.target.value)} hint="Letters, digits, - and _" />
        <SelectField label="Frame rate" value={rate} onChange={(e) => setRate(e.target.value)}>
          {FRAME_RATE_CODES.map((c) => (
            <option key={c} value={c}>
              {FRAME_RATES[c].label}
            </option>
          ))}
        </SelectField>
        <TextField label="Broadcast day starts" mono value={dayStart} onChange={(e) => setDayStart(e.target.value)} error={start === null ? 'Type a time of day.' : undefined} />
        <SelectField label="First weekday" value={weekStart} onChange={(e) => setWeekStart(e.target.value)}>
          {WEEKDAY_CHOICES.map((d) => (
            <option key={d} value={String(d)}>
              {WEEKDAYS[d].long}
            </option>
          ))}
        </SelectField>
      </div>
      <SwitchRow title="Ads playlist" description="Main-template blocks get linked breaks from it" checked={ads} onChange={setAds} />
      {error && <Notice tone="amber">{error}</Notice>}
    </Dialog>
  );
}
