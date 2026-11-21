// Top bar (company, modules, search, user menu) and the phone tab bar — decision 0009.

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router';
import { api, currentCompany } from '@/lib/api';
import type { Company } from '@/lib/types';
import { Icon, Menu, MenuItem, MenuLabel, Popover, Segmented, cx } from '@/ui';
import { useSwitchCompany } from './company';
import { usePrefs } from './prefs';
import { useMe, useSignOut } from './session';
import { useAgentsOverview } from '@/features/agents/AgentsPage';
import { AgentPageProvider } from '@/features/agents/pageAgent';

const MODULES = [
  { to: '/', label: 'Home', end: true },
  { to: '/catalog', label: 'Media' },
  { to: '/templates', label: 'Layouts' },
  { to: '/scheduling', label: 'Scheduling' },
  { to: '/playlist', label: 'Playlist' },
  { to: '/orders', label: 'Ads' },
  { to: '/as-run', label: 'As-run' },
  { to: '/reports', label: 'Reports' },
  { to: '/agents', label: 'Agents' },
];

const PHONE = [
  { to: '/', label: 'Home', icon: 'home' as const, end: true },
  { to: '/templates', label: 'Layouts', icon: 'grid' as const },
  { to: '/scheduling', label: 'Scheduling', icon: 'calendar' as const },
  { to: '/playlist', label: 'Playlist', icon: 'list' as const },
  { to: '/orders', label: 'Ads', icon: 'file' as const },
];

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

export function AppShell({ children }: { children: ReactNode }) {
  const prefs = usePrefs();
  const me = useMe().data;
  const signOut = useSignOut();
  const switchCompany = useSwitchCompany();
  const [userOpen, setUserOpen] = useState(false);
  // what the agents prepared and waits for a person (decision 0024), on the Agents link
  const waitingForPeople = useAgentsOverview().data?.waiting ?? 0;
  const companies = useQuery({ queryKey: ['companies'], queryFn: () => api<Company[]>('GET', '/tenants') });
  const slug = currentCompany();
  const company = companies.data?.find((c) => c.slug === slug);
  const switchTo = (c: Company) => {
    if (c.slug !== slug) switchCompany(c.slug);
  };
  // no company kept in this browser, or one that is not this person's: open their first one, on the
  // same page; until then the page waits (it would ask for a company that is not there)
  const { pathname, search } = useLocation();
  const first = companies.data?.[0]?.slug;
  const waiting = !slug || (!!companies.data && !company);
  useEffect(() => {
    if (first && !company) switchCompany(first, pathname + search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first, company]);
  const userMenu = (
    <div className="flex flex-col gap-0.5">
      <div className="flex flex-col px-2 pb-2.5 pt-1.5 leading-[1.3]">
        <span className="font-medium">{me?.name}</span>
        <span className="truncate text-meta text-text-3">{me?.email}</span>
      </div>
      <NavLink to="/agents" onClick={() => setUserOpen(false)} className="hov flex h-ctl items-center gap-2.5 rounded-ctl px-2 text-text no-underline min-[721px]:hidden">
        <Icon name="agents" size={15} className="text-text-3" />
        Agents
        {waitingForPeople > 0 && <span className="mono ml-auto rounded-[9px] bg-amber-soft px-1.5 text-tiny font-semibold text-amber-text">{waitingForPeople}</span>}
      </NavLink>
      <NavLink to="/account/ai-access" onClick={() => setUserOpen(false)} className="hov flex h-ctl items-center gap-2.5 rounded-ctl px-2 text-text no-underline">
        <Icon name="key" size={15} className="text-text-3" />
        AI access
      </NavLink>
      <NavLink to="/admin" onClick={() => setUserOpen(false)} className="hov flex h-ctl items-center gap-2.5 rounded-ctl px-2 text-text no-underline">
        <Icon name="sliders" size={15} className="text-text-3" />
        Settings
      </NavLink>
      <NavLink to="/ui-kit" onClick={() => setUserOpen(false)} className="hov flex h-ctl items-center gap-2.5 rounded-ctl px-2 text-text no-underline">
        <Icon name="kit" size={15} className="text-text-3" />
        UI kit
      </NavLink>
      <div className="my-1.5 h-px bg-hairline" />
      <div className="flex flex-col gap-1.5 px-2 py-1">
        <span className="text-small text-text-2">Theme</span>
        <Segmented label="Theme" value={prefs.theme} onChange={prefs.setTheme} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
      </div>
      <div className="flex flex-col gap-1.5 px-2 pb-2 pt-1">
        <span className="text-small text-text-2">Density</span>
        <Segmented label="Density" value={prefs.density} onChange={prefs.setDensity} options={[{ value: 'calm', label: 'Calm' }, { value: 'compact', label: 'Compact' }]} />
      </div>
      <div className="my-1.5 h-px bg-hairline" />
      <button type="button" onClick={signOut} className="hov flex h-ctl cursor-pointer items-center gap-2.5 rounded-ctl border-0 bg-transparent px-2 text-left text-text">
        <Icon name="signOut" size={15} className="text-text-3" />
        Sign out
      </button>
    </div>
  );
  return (
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <header className="no-print relative flex h-[52px] items-center gap-2 border-b border-border bg-surface px-4">
        <Menu
          label="Companies"
          align="start"
          width={260}
          trigger={
            <button type="button" aria-label={`Switch company, current ${company?.name ?? slug}`} className="ctl hov flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-item border-0 bg-transparent px-2">
              <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-ctl bg-text text-meta font-semibold text-bg">{(company?.name ?? slug).slice(0, 1).toUpperCase()}</span>
              <span className="hidden font-semibold sm:inline">{company?.name ?? slug}</span>
              <Icon name="chevronsUpDown" size={14} className="text-text-3" />
            </button>
          }
        >
          <MenuLabel>Companies</MenuLabel>
          {(companies.data ?? []).map((c) => (
            <MenuItem key={c.id} onSelect={() => switchTo(c)}>
              <span className="inline-flex w-4 text-accent-text">{c.slug === slug && <Icon name="check" size={15} strokeWidth={2.25} />}</span>
              {c.name}
            </MenuItem>
          ))}
        </Menu>
        <span aria-hidden="true" className="mx-2 hidden h-5 w-px shrink-0 bg-border sm:block" />
        <nav aria-label="Main" className="hidden min-w-0 gap-1 self-stretch overflow-x-auto min-[721px]:flex">
          {MODULES.map((m) => (
            <NavLink
              key={m.to}
              to={m.to}
              end={m.end}
              className={({ isActive }) =>
                cx('inline-flex items-center whitespace-nowrap border-b-2 px-2.5 font-medium no-underline hover:text-text', isActive ? 'border-text text-text' : 'border-transparent text-text-2')
              }
            >
              {m.label}
              {m.to === '/agents' && waitingForPeople > 0 && (
                <span aria-label={`${waitingForPeople} waiting for a person`} className="mono ml-1.5 rounded-[9px] bg-amber-soft px-1.5 text-tiny font-semibold text-amber-text">
                  {waitingForPeople}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <span className="flex-1" />
        <button type="button" aria-label="Search, Ctrl K" title="Search is not built yet" className="ctl hov inline-flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-ctl border border-border bg-bg px-2.5 text-text-3">
          <Icon name="search" size={14} />
          <span className="hidden sm:inline">Search</span>
          <span className="mono ml-4 hidden text-tiny sm:inline">Ctrl K</span>
        </button>
        <Popover
          open={userOpen}
          onOpenChange={setUserOpen}
          label="Account and settings"
          align="end"
          width={248}
          padding="p-2"
          trigger={
            <button type="button" aria-label="Account, admin and display settings" className="ctl hov inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-item border-0 bg-transparent px-1.5">
              <span className="inline-flex size-7 items-center justify-center rounded-full bg-surface-3 text-tiny font-semibold">{initials(me?.name ?? '')}</span>
              <Icon name="chevronDown" size={14} className="text-text-3" />
            </button>
          }
        >
          {userMenu}
        </Popover>
      </header>
      <main className="flex min-w-0 flex-[999_1_560px] flex-col pb-16 min-[721px]:pb-0">{waiting ? null : <AgentPageProvider>{children}</AgentPageProvider>}</main>
      <nav aria-label="Main, mobile" className="no-print fixed inset-x-0 bottom-0 z-20 flex h-[60px] items-center justify-around border-t border-border bg-surface min-[721px]:hidden">
        {PHONE.map((m) => (
          <NavLink
            key={m.to}
            to={m.to}
            end={m.end}
            className={({ isActive }) => cx('flex min-w-14 flex-col items-center gap-0.5 text-tiny font-medium no-underline', isActive ? 'text-text' : 'text-text-3')}
          >
            <Icon name={m.icon} size={20} />
            {m.label}
          </NavLink>
        ))}
        <button type="button" aria-label="More" onClick={() => setUserOpen(true)} className="flex min-w-14 cursor-pointer flex-col items-center gap-0.5 border-0 bg-transparent text-tiny font-medium text-text-3">
          <Icon name="more" size={20} />
          More
        </button>
      </nav>
    </div>
  );
}
