// Admin → Companies: each company has its own channels, data and settings (decisions 0001, 0007).

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorText } from '@/lib/api';
import { keys } from '@/lib/queries';
import type { AdminCompany } from '@/lib/types';
import { useSwitchCompany } from '@/app/company';
import { Button, Dialog, Monogram, Notice, SectionHead, TextField, useToast } from '@/ui';

export function CompaniesSection() {
  const companies = useQuery({ queryKey: keys.companies(), queryFn: () => api<AdminCompany[]>('GET', '/admin/companies') });
  const switchCompany = useSwitchCompany();
  const [adding, setAdding] = useState(false);
  return (
    <>
      <SectionHead title="Companies" description="Each company has its own channels, data and settings">
        <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
          Add company
        </Button>
      </SectionHead>
      {companies.error && <Notice tone="red">{errorText(companies.error)}</Notice>}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-4">
        {(companies.data ?? []).map((c) => {
          const live = c.channelCount > 0;
          return (
            <div key={c.id} className="flex flex-col gap-4 rounded-card border border-border bg-surface p-5">
              <div className="flex items-center gap-3">
                <Monogram name={c.name} strong={live} />
                <span className="flex min-w-0 flex-1 flex-col leading-[1.35]">
                  <span className="font-semibold">{c.name}</span>
                  <span className="text-small text-text-3">
                    {live ? `Live · ${c.channelCount} ${c.channelCount === 1 ? 'channel' : 'channels'}` : 'Not set up'}
                    {c.current ? ' · this company' : ''}
                  </span>
                </span>
              </div>
              <span className="text-small text-text-2">
                {live
                  ? `${c.templateCount} ${c.templateCount === 1 ? 'layout' : 'layouts'}${c.exports.length ? ` · exports to ${c.exports.join(', ')}` : ''}`
                  : 'Add channels, choose modules and connect a playout to start.'}
              </span>
              <Button className="self-start" onClick={() => switchCompany(c.slug, '/admin/channels')}>
                {live ? 'Open settings' : 'Set up company'}
              </Button>
            </div>
          );
        })}
      </div>
      <AddCompanyDialog open={adding} onOpenChange={setAdding} />
    </>
  );
}

function AddCompanyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [error, setError] = useState<string | null>(null);
  const auto = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  const m = useMutation({
    mutationFn: () => api('POST', '/admin/companies', { name, slug: slug || auto }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.companies() });
      qc.invalidateQueries({ queryKey: ['companies'] });
      toast(`${name} added`);
      onOpenChange(false);
      setName('');
      setSlug('');
      setError(null);
    },
    onError: (e) => setError(errorText(e)),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add company"
      description="A new company starts with the built-in roles and no channels."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!name.trim() || m.isPending} onClick={() => m.mutate()}>
            Add
          </Button>
        </>
      }
    >
      <TextField label="Name" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      <TextField label="Short name" mono value={slug || auto} onChange={(e) => setSlug(e.target.value)} hint="Lower-case letters, digits and -; used in addresses" />
      {error && <Notice tone="amber">{error}</Notice>}
    </Dialog>
  );
}
