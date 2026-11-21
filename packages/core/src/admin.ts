// Admin vocabulary shared by the API and the web app: modules × actions for roles (decision 0007),
// built-in roles, playout exporters and their file names, connections.

import { framesToParts, type FrameRate } from './timecode';

export const MODULES = [
  { key: 'catalog', label: 'Media', description: 'Titles, episodes, files' },
  { key: 'templates', label: 'Layouts', description: 'Layouts, block types, break lists' },
  { key: 'playlist', label: 'Playlist', description: 'Daily playlists, import, approve' },
  { key: 'orders', label: 'Plans and campaigns', description: 'Programme plans and ad campaigns' },
  { key: 'asrun', label: 'As-run', description: 'Air logs and certificates' },
  { key: 'reports', label: 'Reports', description: 'Reports and exports' },
  { key: 'admin', label: 'Settings', description: 'Users, roles, channels, integrations' },
] as const;

export const ACTIONS = [
  { key: 'view', label: 'View' },
  { key: 'edit', label: 'Edit' },
  { key: 'approve', label: 'Approve' },
  { key: 'export', label: 'Export' },
] as const;

export type ModuleKey = (typeof MODULES)[number]['key'];
export type ActionKey = (typeof ACTIONS)[number]['key'];

/** Actions a module does not have. */
export const NOT_APPLICABLE: Partial<Record<ModuleKey, ActionKey[]>> = { admin: ['approve', 'export'], catalog: ['approve'] };

export function grantApplies(module: string, action: string): boolean {
  return (
    MODULES.some((m) => m.key === module) &&
    ACTIONS.some((a) => a.key === action) &&
    !(NOT_APPLICABLE[module as ModuleKey] ?? []).includes(action as ActionKey)
  );
}

export const ALL_GRANTS: { module: ModuleKey; action: ActionKey }[] = MODULES.flatMap((m) =>
  ACTIONS.filter((a) => grantApplies(m.key, a.key)).map((a) => ({ module: m.key, action: a.key })),
);

const g = (spec: Partial<Record<ModuleKey, ActionKey[]>>) =>
  Object.entries(spec).flatMap(([module, actions]) => (actions ?? []).map((action) => ({ module: module as ModuleKey, action })));
const every: ActionKey[] = ['view', 'edit', 'approve', 'export'];

/** Roles every company starts with. The company admin can do everything and cannot be changed. */
export const SYSTEM_ROLES = [
  { key: 'company-admin', name: 'Company admin', description: 'Users, channels, integrations', fixed: true, grants: ALL_GRANTS },
  {
    key: 'traffic',
    name: 'Traffic operator',
    description: 'Plans, playlists, export',
    fixed: false,
    grants: g({ catalog: ['view'], templates: ['view'], playlist: every, orders: every, asrun: ['view', 'export'], reports: ['view', 'export'] }),
  },
  {
    key: 'scheduler',
    name: 'Program scheduler',
    description: 'Media, layouts, programs',
    fixed: false,
    grants: g({ catalog: ['view', 'edit'], templates: ['view', 'edit', 'approve'], playlist: ['view', 'edit'], orders: ['view'], asrun: ['view'], reports: ['view'] }),
  },
  {
    key: 'sales',
    name: 'Sales',
    description: 'Plans and as-run, read and export',
    fixed: false,
    grants: g({ catalog: ['view'], orders: ['view', 'export'], asrun: ['view', 'export'], reports: ['view', 'export'] }),
  },
  {
    key: 'viewer',
    name: 'Viewer',
    description: 'Read-only everywhere',
    fixed: false,
    grants: g({ catalog: ['view'], templates: ['view'], playlist: ['view'], orders: ['view'], asrun: ['view'], reports: ['view'] }),
  },
] as const;

// ---------------------------------------------------------------- playout exports

export interface Exporter {
  code: string;
  label: string;
  ext: string;
}

/** Playout exports with a known file name. More come as plugins (decision 0005). */
export const EXPORTERS: Exporter[] = [
  { code: 'playout-xml', label: 'Playout XML', ext: 'xml' },
  { code: 'bxf', label: 'BXF', ext: 'xml' },
  { code: 'bxf-amagi', label: 'BXF Amagi', ext: 'xml' },
  { code: 'csv', label: 'CSV', ext: 'csv' },
  { code: 'qms', label: 'QMS', ext: 'xml' },
  { code: 'nexio', label: 'Nexio', ext: 'txt' },
  { code: 'adc', label: 'ADC', ext: 'bxf' },
];

export const EPG_TYPES = [{ code: 'xmltv', label: 'XMLTV' }];

export const exporterLabel = (code: string | null | undefined) => EXPORTERS.find((e) => e.code === code)?.label ?? code ?? '';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The file name an export gets for one broadcast day. Playout XML names the
 * file after the playlist start: the date plus the channel's day start.
 */
export function exportFileName(exporter: string, isoDate: string, dayStartFrames: number, rate: FrameRate, channelCode: string): string {
  const [y, m, d] = isoDate.split('-');
  const ymd = `${y}${m}${d}`;
  const t = framesToParts(dayStartFrames, rate);
  switch (exporter) {
    case 'playout-xml':
      return `${y}_${m}_${d}_${pad(t.h)}_${pad(t.m)}_${pad(t.s)}.xml`;
    case 'bxf':
      return `BXF${ymd}_${channelCode}.xml`;
    case 'qms':
      return `${y}_${m}_${d}_${channelCode}.xml`;
    case 'nexio':
      return `${channelCode}${ymd}.txt`;
    case 'adc':
      return `${ymd}${channelCode}.bxf`;
    default:
      return `${ymd}_${channelCode}.${EXPORTERS.find((e) => e.code === exporter)?.ext ?? 'xml'}`;
  }
}

// ---------------------------------------------------------------- channel options

export const AGE_LOGO_POSITIONS = [
  { code: 'top-left', label: 'Top left' },
  { code: 'top-right', label: 'Top right' },
];

// ---------------------------------------------------------------- connections

export const CONNECTION_KINDS = [
  { key: 'mam', label: 'MAM', adapters: [{ code: 'compact-mam', label: 'Compact MAM' }] },
  { key: 'playout', label: 'Playout export', adapters: EXPORTERS.map((e) => ({ code: e.code, label: e.label })) },
  { key: 'asrun', label: 'As-run logs', adapters: [{ code: 'ftp', label: 'FTP' }, { code: 'upload', label: 'Upload' }] },
  { key: 'bookings', label: 'Bookings', adapters: [{ code: 'web-api', label: 'Web bookings API' }] },
] as const;

export function connectionLabel(kind: string, adapter: string): string {
  const k = CONNECTION_KINDS.find((x) => x.key === kind);
  const a = (k?.adapters as readonly { code: string; label: string }[] | undefined)?.find((x) => x.code === adapter);
  return `${k?.label ?? kind} · ${a?.label ?? adapter}`;
}
