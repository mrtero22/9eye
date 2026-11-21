// Admin — mockup the Admin mockup (private): the company's settings, every section grouped on
// the left; built sections open here, the others say "later".

import { useQuery } from '@tanstack/react-query';
import { Navigate, useParams, useSearchParams } from 'react-router';
import { api, currentCompany } from '@/lib/api';
import { keys, useChannels } from '@/lib/queries';
import type { AdminCompany } from '@/lib/types';
import { PageHeader, SectionNav } from '@/ui';
import { ActivitySection } from './ActivitySection';
import { AiAccessSection } from './AiAccessSection';
import { BreakPositionsSection } from './BreakPositionsSection';
import { ChannelSettings } from './ChannelSettings';
import { ChannelsSection } from './ChannelsSection';
import { CompaniesSection } from './CompaniesSection';
import { ConnectionsSection } from './ConnectionsSection';
import { RolesSection } from './RolesSection';
import { ADMIN_GROUPS, findSection } from './sections';
import { UsersSection } from './UsersSection';

export function AdminPage() {
  const { section = 'channels', channelId } = useParams();
  const [params] = useSearchParams();
  const channels = useChannels();
  const companies = useQuery({ queryKey: keys.companies(), queryFn: () => api<AdminCompany[]>('GET', '/admin/companies') });
  const company = companies.data?.find((c) => c.current)?.name ?? currentCompany();

  // Old links: /admin/channels?channel=<id>
  const legacy = params.get('channel');
  if (section === 'channels' && !channelId && legacy) return <Navigate to={`/admin/channels/${legacy}`} replace />;
  const info = findSection(section);
  if (!info) return <Navigate to="/admin/channels" replace />;

  const groups = ADMIN_GROUPS.map((g) => ({
    label: g.label,
    items: g.items.map((it) => ({
      key: it.key,
      label: it.label,
      to: `/admin/${it.key}`,
      later: !it.built,
      count: it.key === 'channels' ? channels.data?.length : undefined,
    })),
  }));

  let body;
  if (section === 'channels') body = channelId ? <ChannelSettings channelId={channelId} /> : <ChannelsSection />;
  else if (section === 'roles') body = <RolesSection />;
  else if (section === 'users') body = <UsersSection />;
  else if (section === 'companies') body = <CompaniesSection />;
  else if (section === 'plugins') body = <ConnectionsSection />;
  else if (section === 'break-positions') body = <BreakPositionsSection />;
  else if (section === 'ai-access') body = <AiAccessSection company={company} />;
  else if (section === 'activity') body = <ActivitySection company={company} />;
  else
    body = (
      <div className="flex flex-col gap-1.5">
        <h2 className="m-0 text-[17px] font-semibold">{info.label}</h2>
        <div className="flex flex-col gap-1.5 rounded-panel border border-dashed border-border-strong bg-surface p-6 text-text-2">
          <span>{info.label} is not built yet. It will list its items here, with the selected item's settings, the same way as Channels.</span>
          <span className="text-small text-text-3">Its options come from the Settings spec.</span>
        </div>
      </div>
    );

  return (
    <>
      <PageHeader title="Settings" description={`Settings for ${company}: channels, people, rules and connections. Changes apply to this company only.`} />
      <div className="flex flex-wrap items-start gap-6 px-4 pb-8 pt-5 sm:px-8">
        <SectionNav label="Settings sections" groups={groups} current={section} />
        <div className="flex min-w-0 flex-[999_1_640px] flex-col gap-3.5">{body}</div>
      </div>
    </>
  );
}
